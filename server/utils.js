import fs from "node:fs";
import path from "node:path";
import sanitizeFilename from "sanitize-filename";
import { v4 as uuidv4 } from "uuid";
import { allowedExtensions } from "./config.js";

const DEFAULT_PREFIX = "arquivo";

export const nowIso = () => new Date().toISOString();

export const safeFilename = (input, fallbackPrefix = DEFAULT_PREFIX) => {
  const raw = sanitizeFilename(input || "") || `${fallbackPrefix}-${uuidv4()}`;
  const normalized = raw.replace(/\s+/g, "_");
  return normalized.length > 120 ? normalized.slice(0, 120) : normalized;
};

export const getExtension = (filename) => path.extname(filename || "").toLowerCase();

export const isSupportedExtension = (filename) => allowedExtensions.has(getExtension(filename));

export const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
};

export const ensureFileExists = async (filePath) => {
  await fs.promises.access(filePath, fs.constants.R_OK);
};

export const fileSize = async (filePath) => {
  const stats = await fs.promises.stat(filePath);
  return stats.size;
};
