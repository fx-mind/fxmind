/**
 * Simple exclusive file locks via O_EXCL create under .fxmind/state/locks/.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function locksDir(root) {
  return path.join(path.resolve(root), ".fxmind", "state", "locks");
}

function lockFilePath(root, name) {
  const safe = String(name || "default")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 120);
  return path.join(locksDir(root), `${safe}.lock`);
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin */
  }
}

function acquireLock(root, name, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 30_000;
  const pollMs = Number(options.pollMs) || 25;
  const file = lockFilePath(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const fd = fs.openSync(file, "wx");
      try {
        fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
      } catch {
        /* ignore */
      }
      return {
        release() {
          try {
            fs.closeSync(fd);
          } catch {
            /* ignore */
          }
          try {
            fs.unlinkSync(file);
          } catch {
            /* ignore */
          }
        },
      };
    } catch (err) {
      if (err && err.code !== "EEXIST") {
        throw err;
      }
      sleepSync(pollMs);
    }
  }
  throw new Error(`fxmind lock timeout: ${name}`);
}

function withFileLock(root, name, fn, options = {}) {
  const lock = acquireLock(root, name, options);
  try {
    return fn();
  } finally {
    lock.release();
  }
}

async function withFileLockAsync(root, name, fn, options = {}) {
  const lock = acquireLock(root, name, options);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

module.exports = {
  locksDir,
  lockFilePath,
  acquireLock,
  withFileLock,
  withFileLockAsync,
};
