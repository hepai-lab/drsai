import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { replaceFileSafely } from "./atomicFileReplace";

export async function readDurableJson<T>(filePath: string, decode: (value: unknown) => T, options: { maxBytes?: number } = {}): Promise<{ value: T; recoveredFromBackup: boolean } | null> {
  const maxBytes = options.maxBytes;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new Error("Durable JSON maxBytes must be a positive safe integer.");
  for (const [candidate, recoveredFromBackup] of [[filePath, false], [`${filePath}.bak`, true]] as const) {
    try {
      const raw = maxBytes === undefined ? await readFile(candidate, "utf8") : await readBoundedUtf8(candidate, maxBytes);
      const value = decode(JSON.parse(raw));
      return { value, recoveredFromBackup };
    } catch {
      // Missing, malformed and schema-invalid primary data all fall through to
      // the last fully committed backup. Callers decide the empty-store policy.
    }
  }
  return null;
}

async function readBoundedUtf8(filePath: string, maxBytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > maxBytes) throw new Error("Durable JSON file exceeds its read limit.");
    const buffer = Buffer.allocUnsafe(maxBytes + 1); let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error("Durable JSON file exceeds its read limit.");
    return buffer.subarray(0, total).toString("utf8");
  } finally { await handle.close(); }
}

export async function writeDurableJson(filePath: string, value: unknown, options: { maxBytes?: number } = {}): Promise<void> {
  const maxBytes = options.maxBytes;
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new Error("Durable JSON maxBytes must be a positive safe integer.");
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (maxBytes !== undefined && Buffer.byteLength(content, "utf8") > maxBytes) throw new Error("Durable JSON content exceeds its write limit.");
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await replaceContent(filePath, content);
  await replaceContent(`${filePath}.bak`, content);
}

async function replaceContent(filePath: string, content: string): Promise<void> {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await replaceFileSafely(temporary, filePath);
    await chmod(filePath, 0o600).catch(() => undefined);
  } finally {
    await rm(temporary, { force: true });
  }
}
