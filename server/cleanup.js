import fs from "node:fs";
import { config } from "./config.js";
import { getExpiredBatchIds, removeBatch } from "./store.js";

const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore missing files
  }
};

const cleanupBatch = async (batchId) => {
  const jobs = removeBatch(batchId);
  await Promise.all(
    jobs.flatMap((job) => [safeUnlink(job.input_path), safeUnlink(job.output_path)])
  );
  console.log("[cleanup] batch_expired", batchId, jobs.length);
};

export const startCleanupLoop = () => {
  setInterval(async () => {
    const expiredIds = getExpiredBatchIds();
    if (expiredIds.length === 0) return;
    for (const batchId of expiredIds) {
      await cleanupBatch(batchId);
    }
  }, Math.max(config.tempTtlMinutes * 30_000, 30_000));
};
