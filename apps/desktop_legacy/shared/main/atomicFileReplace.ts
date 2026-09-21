import { copyFile, open, readFile, rename, rm } from "fs/promises";
import { randomUUID } from "crypto";

const RETRY_DELAYS_MS = [0, 25, 50, 100, 200, 400, 800, 1_200, 1_600];
const RETRYABLE_CODES = new Set(["EACCES", "EBUSY", "EEXIST", "EPERM"]);

export interface AtomicReplaceOperations {
  rename(source: string, destination: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  syncFile(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
}

const defaultOperations: AtomicReplaceOperations = {
  rename,
  copyFile,
  readFile,
  syncFile: async (path) => { const handle = await open(path, "r+"); try { await handle.sync(); } finally { await handle.close(); } },
  remove: async (path) => rm(path, { force: true }),
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export async function replaceFileSafely(source: string, destination: string, operations: AtomicReplaceOperations = defaultOperations): Promise<void> {
  let lastError: unknown;
  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs) await operations.wait(delayMs);
    try { await operations.rename(source, destination); return; } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
    }
  }

  // Windows antivirus and indexers can deny rename-over-existing while still
  // allowing ordinary file writes. Preserve a recoverable backup, copy the
  // complete temporary file, fsync it, and verify byte-for-byte before success.
  const backup = `${destination}.${process.pid}.${randomUUID()}.replace-backup`;
  let hasBackup = false;
  try {
    try { await operations.copyFile(destination, backup); hasBackup = true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const delayMs of RETRY_DELAYS_MS) {
      if (delayMs) await operations.wait(delayMs);
      try {
        await operations.copyFile(source, destination);
        await operations.syncFile(destination);
        const [expected, actual] = await Promise.all([operations.readFile(source), operations.readFile(destination)]);
        if (!expected.equals(actual)) throw Object.assign(new Error("Atomic replacement verification failed."), { code: "EIO" });
        return;
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) throw error;
      }
    }
    throw lastError;
  } catch (error) {
    if (hasBackup) await operations.copyFile(backup, destination).catch(() => undefined);
    throw error;
  } finally {
    await operations.remove(backup).catch(() => undefined);
  }
}

function isRetryable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && RETRYABLE_CODES.has(String(error.code));
}
