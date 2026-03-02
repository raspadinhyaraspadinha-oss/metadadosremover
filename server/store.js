import fs from "node:fs";
import { config } from "./config.js";
import { nowIso } from "./utils.js";

const defaultState = {
  batches: {},
  jobs: {}
};

let state = structuredClone(defaultState);
let persistTimer = null;

const toArray = (obj) => Object.values(obj || {});

const schedulePersist = () => {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      await fs.promises.writeFile(config.storePath, JSON.stringify(state, null, 2), "utf8");
    } catch (error) {
      console.error("[store] persist_failed", error.message);
    }
  }, 200);
};

export const loadStore = async () => {
  try {
    const raw = await fs.promises.readFile(config.storePath, "utf8");
    const parsed = JSON.parse(raw);
    state = {
      batches: parsed.batches || {},
      jobs: parsed.jobs || {}
    };
  } catch {
    state = structuredClone(defaultState);
  }
};

export const createBatch = ({ id, options, ...rest }) => {
  const createdAt = nowIso();
  state.batches[id] = {
    id,
    options,
    ...rest,
    created_at: createdAt,
    updated_at: createdAt,
    expires_at: new Date(Date.now() + config.tempTtlMinutes * 60_000).toISOString(),
    status: "uploading",
    total_bytes: 0,
    total_files: 0
  };
  schedulePersist();
  return state.batches[id];
};

export const updateBatch = (batchId, patch) => {
  if (!state.batches[batchId]) return null;
  state.batches[batchId] = {
    ...state.batches[batchId],
    ...patch,
    updated_at: nowIso()
  };
  schedulePersist();
  return state.batches[batchId];
};

export const createJob = (job) => {
  const isNew = !state.jobs[job.id];
  state.jobs[job.id] = {
    ...job,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  const batch = state.batches[job.batch_id];
  if (batch && isNew) {
    batch.total_files += 1;
    batch.updated_at = nowIso();
  }
  schedulePersist();
  return state.jobs[job.id];
};

export const updateJob = (jobId, patch) => {
  if (!state.jobs[jobId]) return null;
  state.jobs[jobId] = {
    ...state.jobs[jobId],
    ...patch,
    updated_at: nowIso()
  };
  schedulePersist();
  return state.jobs[jobId];
};

export const getJob = (jobId) => state.jobs[jobId] || null;

export const getBatch = (batchId) => state.batches[batchId] || null;

export const getAllBatches = () =>
  toArray(state.batches).sort((a, b) => (a.created_at > b.created_at ? -1 : 1));

export const getBatchJobs = (batchId) =>
  toArray(state.jobs)
    .filter((job) => job.batch_id === batchId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

export const getBatchSnapshot = (batchId) => {
  const batch = getBatch(batchId);
  if (!batch) return null;
  const jobs = getBatchJobs(batchId);
  const counts = jobs.reduce(
    (acc, job) => {
      acc.total += 1;
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    },
    { total: 0, queued: 0, processing: 0, ready: 0, error: 0, uploading: 0 }
  );
  const globalProgress = counts.total === 0 ? 0 : Math.round(((counts.ready + counts.error) / counts.total) * 100);
  const status = counts.processing > 0 || counts.queued > 0 || counts.uploading > 0 ? "processing" : "done";

  return {
    batch: {
      ...batch,
      status,
      counts,
      global_progress: globalProgress
    },
    jobs
  };
};

export const getExpiredBatchIds = () => {
  const now = Date.now();
  return toArray(state.batches)
    .filter((batch) => Date.parse(batch.expires_at) <= now)
    .map((batch) => batch.id);
};

export const removeBatch = (batchId) => {
  const jobs = getBatchJobs(batchId);
  for (const job of jobs) {
    delete state.jobs[job.id];
  }
  delete state.batches[batchId];
  schedulePersist();
  return jobs;
};
