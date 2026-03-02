import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const rootDir = process.cwd();
const storageDir = path.join(rootDir, "storage");
const uploadDir = path.join(storageDir, "uploads");
const outputDir = path.join(storageDir, "outputs");
const dataDir = path.join(storageDir, "data");
const storePath = path.join(dataDir, "store.json");

for (const dir of [storageDir, uploadDir, outputDir, dataDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const mbToBytes = (value, fallback) => {
  const parsed = Number.parseFloat(value ?? "");
  const mb = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.floor(mb * 1024 * 1024);
};

const intOrDefault = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  port: intOrDefault(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  baseUrl: process.env.BASE_URL || `http://localhost:${intOrDefault(process.env.PORT, 3000)}`,
  maxFileSizeBytes: mbToBytes(process.env.MAX_FILE_SIZE_MB, 250),
  maxBatchSizeBytes: mbToBytes(process.env.MAX_BATCH_SIZE_MB, 1500),
  maxFilesPerBatch: intOrDefault(process.env.MAX_FILES_PER_BATCH, 50),
  processTimeoutMs: intOrDefault(process.env.PROCESS_TIMEOUT_MS, 120000),
  jobConcurrency: intOrDefault(process.env.JOB_CONCURRENCY, 2),
  tempTtlMinutes: intOrDefault(process.env.TEMP_TTL_MINUTES, 60),
  rateLimitWindowMs: intOrDefault(process.env.RATE_LIMIT_WINDOW_MS, 60000),
  rateLimitMax: intOrDefault(process.env.RATE_LIMIT_MAX, 80),
  adminUser: process.env.ADMIN_USER || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  storageDir,
  uploadDir,
  outputDir,
  storePath
};

export const allowedExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".mp4",
  ".mov",
  ".webm"
]);

export const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);
export const videoExtensions = new Set([".mp4", ".mov", ".webm"]);
