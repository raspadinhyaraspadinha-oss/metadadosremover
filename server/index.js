import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import Busboy from "busboy";
import rateLimit from "express-rate-limit";
import archiver from "archiver";
import mime from "mime-types";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { createBatch, createJob, getBatchSnapshot, getJob, loadStore, updateBatch, updateJob } from "./store.js";
import { enqueueJob, retryJob } from "./processor.js";
import { safeFilename, getExtension, isSupportedExtension } from "./utils.js";
import { startCleanupLoop } from "./cleanup.js";

const app = express();
const clientDistPath = path.join(process.cwd(), "dist", "client");

app.set("trust proxy", 1);
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(
  rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false
  })
);

const parseOptions = (rawOptions) => {
  const defaults = {
    preserveQuality: true,
    removeEmbeddedThumbnails: true,
    normalizeOrientation: false,
    keepOriginalExtension: true,
    renameFiles: false,
    renamePrefix: "clean"
  };
  if (!rawOptions) return defaults;
  try {
    const parsed = JSON.parse(rawOptions);
    return {
      ...defaults,
      ...parsed,
      renamePrefix: safeFilename(parsed.renamePrefix || defaults.renamePrefix, "clean")
    };
  } catch {
    return defaults;
  }
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post("/api/batch", (req, res) => {
  const batchId = uuidv4();
  let options = parseOptions(req.headers["x-clean-options"]);
  createBatch({ id: batchId, options });

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      files: config.maxFilesPerBatch,
      fileSize: config.maxFileSizeBytes,
      parts: config.maxFilesPerBatch + 20
    }
  });

  let totalBytes = 0;
  let hasFile = false;
  const pendingWrites = [];
  const jobs = [];
  let hasFailure = false;
  let failMessage = "";

  const fail = (message, statusCode = 400) => {
    if (hasFailure) return;
    hasFailure = true;
    failMessage = message;
    updateBatch(batchId, { status: "error" });
    if (!res.headersSent) {
      res.status(statusCode).json({ error: message });
    }
  };

  busboy.on("field", (name, value) => {
    if (name === "options") {
      options = parseOptions(value);
      updateBatch(batchId, { options });
    }
  });

  busboy.on("file", (_fieldName, file, info) => {
    if (hasFailure) {
      file.resume();
      return;
    }
    hasFile = true;
    const originalName = safeFilename(info.filename || "arquivo");

    if (!isSupportedExtension(originalName)) {
      file.resume();
      fail(`Formato não suportado: ${originalName}`, 415);
      return;
    }

    const jobId = uuidv4();
    const inputFilename = `${jobId}${getExtension(originalName)}`;
    const inputPath = path.join(config.uploadDir, inputFilename);

    const job = createJob({
      id: jobId,
      batch_id: batchId,
      original_name: originalName,
      input_path: inputPath,
      output_path: null,
      output_name: null,
      mimetype: info.mimeType || mime.lookup(originalName) || "application/octet-stream",
      status: "uploading",
      progress: 5,
      error: null
    });
    jobs.push(job);

    const writeStream = fs.createWriteStream(inputPath);
    const writeDone = new Promise((resolve, reject) => {
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
    pendingWrites.push(writeDone);

    file.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > config.maxBatchSizeBytes) {
        file.unpipe(writeStream);
        writeStream.end();
        fail(`Lote excedeu o limite de ${Math.round(config.maxBatchSizeBytes / 1024 / 1024)} MB.`, 413);
      }
    });

    file.on("limit", () => {
      fail(
        `Arquivo "${originalName}" excedeu o limite de ${Math.round(config.maxFileSizeBytes / 1024 / 1024)} MB.`,
        413
      );
    });

    file.pipe(writeStream);
  });

  busboy.on("error", (error) => {
    fail(`Falha no upload: ${error.message}`, 500);
  });
  busboy.on("filesLimit", () => {
    fail(`Quantidade máxima de arquivos por lote: ${config.maxFilesPerBatch}.`, 413);
  });
  busboy.on("partsLimit", () => {
    fail("Upload excedeu o limite de partes permitido.", 413);
  });

  busboy.on("finish", async () => {
    if (hasFailure) return;
    if (!hasFile) {
      fail("Envie ao menos um arquivo para processar.", 400);
      return;
    }

    try {
      await Promise.all(pendingWrites);
      for (const job of jobs) {
        const stats = await fs.promises.stat(job.input_path);
        updateJob(job.id, {
          status: "queued",
          progress: 15,
          size_before: stats.size
        });
        enqueueJob(job.id);
      }
      updateBatch(batchId, { status: "processing", total_bytes: totalBytes });
      const snapshot = getBatchSnapshot(batchId);
      res.status(201).json({
        batch_id: batchId,
        status: snapshot.batch.status,
        jobs: snapshot.jobs,
        message: failMessage || "Upload concluído. Processamento iniciado."
      });
    } catch (error) {
      fail(`Falha ao finalizar upload: ${error.message}`, 500);
    }
  });

  req.pipe(busboy);
});

app.get("/api/batch/:batchId", (req, res) => {
  const snapshot = getBatchSnapshot(req.params.batchId);
  if (!snapshot) {
    res.status(404).json({ error: "Batch não encontrado ou expirado." });
    return;
  }
  res.json(snapshot);
});

app.post("/api/job/:jobId/retry", (req, res) => {
  const ok = retryJob(req.params.jobId);
  if (!ok) {
    res.status(400).json({ error: "Esse job não pode ser reprocessado agora." });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/job/:jobId/download", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status !== "ready" || !job.output_path) {
    res.status(404).json({ error: "Arquivo limpo não está disponível." });
    return;
  }

  const filename = job.original_name;
  res.setHeader("Content-Type", job.mimetype || "application/octet-stream");
  res.download(job.output_path, filename);
});

app.get("/api/batch/:batchId/download.zip", (req, res) => {
  const snapshot = getBatchSnapshot(req.params.batchId);
  if (!snapshot) {
    res.status(404).json({ error: "Batch não encontrado." });
    return;
  }

  const readyJobs = snapshot.jobs.filter((job) => job.status === "ready" && job.output_path);
  if (readyJobs.length === 0) {
    res.status(409).json({ error: "Nenhum arquivo pronto para ZIP neste batch." });
    return;
  }

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=batch-${snapshot.batch.id}.zip`);
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (error) => {
    console.error("[zip] failed", error.message);
    if (!res.headersSent) res.status(500).json({ error: "Erro ao gerar ZIP." });
  });
  archive.pipe(res);
  for (const job of readyJobs) {
    archive.file(job.output_path, { name: job.original_name });
  }
  archive.finalize();
});

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

const start = async () => {
  await loadStore();
  startCleanupLoop();
  app.listen(config.port, () => {
    console.log(`[server] running on port ${config.port}`);
  });
};

start().catch((error) => {
  console.error("[server] startup_failed", error);
  process.exit(1);
});
