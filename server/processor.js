import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { v4 as uuidv4 } from "uuid";
import { config, imageExtensions, videoExtensions } from "./config.js";
import { getExtension, fileSize } from "./utils.js";
import { getBatch, getJob, getBatchJobs, updateBatch, updateJob } from "./store.js";

const queue = [];
let activeWorkers = 0;

const METADATA_KEYWORDS = [
  "gps",
  "artist",
  "author",
  "copyright",
  "creator",
  "serial",
  "software",
  "make",
  "model",
  "date",
  "keyword",
  "comment",
  "description",
  "title",
  "location"
];

const runCommand = (command, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Timeout ao executar ${command}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve({ stdout, stderr });
      return reject(new Error(stderr || `${command} finalizou com código ${code}`));
    });
  });

const verifyBasicMetadata = async (outputPath) => {
  const { stdout } = await runCommand("exiftool", ["-json", outputPath], config.processTimeoutMs);
  const parsed = JSON.parse(stdout || "[]");
  const payload = parsed[0] || {};
  const keys = Object.keys(payload);
  const suspicious = keys.filter((key) => {
    const lowered = key.toLowerCase();
    return METADATA_KEYWORDS.some((needle) => lowered.includes(needle));
  });
  return {
    passed: suspicious.length === 0,
    suspicious_keys: suspicious
  };
};

const processImage = async (job, outputPath, options) => {
  await fs.promises.copyFile(job.input_path, outputPath);
  const args = ["-overwrite_original", "-all="];
  if (options.removeEmbeddedThumbnails) {
    args.push("-ThumbnailImage=");
  }
  if (options.normalizeOrientation) {
    args.push("-Orientation=1");
  }
  args.push(outputPath);
  await runCommand("exiftool", args, config.processTimeoutMs);
};

const processVideo = async (job, outputPath) => {
  const args = ["-y", "-i", job.input_path, "-map", "0", "-map_metadata", "-1", "-c", "copy", outputPath];
  await runCommand("ffmpeg", args, config.processTimeoutMs);
};

const buildOutputFilename = (job, options) => {
  const ext = options.keepOriginalExtension ? getExtension(job.original_name) : path.extname(job.input_path);
  if (!options.renameFiles) return `${job.id}${ext}`;
  return `${options.renamePrefix || "clean"}_${uuidv4()}${ext}`;
};

const updateBatchBytes = (batchId) => {
  const batch = getBatch(batchId);
  if (!batch) return;
  const jobs = getBatchJobs(batchId);
  const total = jobs.reduce((acc, job) => acc + (job.size_before || 0), 0);
  updateBatch(batchId, { total_bytes: total });
};

const worker = async (jobId) => {
  const job = getJob(jobId);
  if (!job) return;
  const batch = getBatch(job.batch_id);
  if (!batch) return;

  const options = batch.options || {};
  const outputFilename = buildOutputFilename(job, options);
  const outputPath = path.join(config.outputDir, outputFilename);

  try {
    updateJob(job.id, {
      status: "processing",
      progress: 55,
      output_path: outputPath,
      output_name: outputFilename,
      error: null
    });

    const ext = getExtension(job.original_name);
    if (imageExtensions.has(ext)) {
      await processImage(job, outputPath, options);
    } else if (videoExtensions.has(ext)) {
      await processVideo(job, outputPath);
    } else {
      throw new Error("Formato não suportado para limpeza de metadados.");
    }

    const [beforeBytes, afterBytes, check] = await Promise.all([
      fileSize(job.input_path),
      fileSize(outputPath),
      verifyBasicMetadata(outputPath)
    ]);

    updateJob(job.id, {
      status: "ready",
      progress: 100,
      size_before: beforeBytes,
      size_after: afterBytes,
      metadata_check: check
    });
    updateBatchBytes(job.batch_id);
  } catch (error) {
    console.error("[job] failed", job.id, error.message);
    updateJob(job.id, {
      status: "error",
      progress: 100,
      error: error.message
    });
  }
};

const scheduleNext = () => {
  while (activeWorkers < config.jobConcurrency && queue.length > 0) {
    const nextJobId = queue.shift();
    activeWorkers += 1;
    worker(nextJobId)
      .catch((error) => {
        console.error("[queue] worker_error", error.message);
      })
      .finally(() => {
        activeWorkers -= 1;
        scheduleNext();
      });
  }
};

export const enqueueJob = (jobId) => {
  queue.push(jobId);
  scheduleNext();
};

export const retryJob = (jobId) => {
  const job = getJob(jobId);
  if (!job || job.status !== "error") return false;
  updateJob(jobId, {
    status: "queued",
    progress: 15,
    error: null
  });
  enqueueJob(jobId);
  return true;
};
