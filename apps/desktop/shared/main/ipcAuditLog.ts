import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { DesktopIpcAuditEvent } from "./secureIpc";

export type DesktopIpcAuditWriter = (event: DesktopIpcAuditEvent) => Promise<void>;

export function createDesktopIpcAuditWriter(
  filePath: string,
  options: { maxBytes?: number; clock?: () => Date } = {},
): DesktopIpcAuditWriter {
  const maxBytes = Math.max(1_024, options.maxBytes ?? 5 * 1024 * 1024);
  const clock = options.clock ?? (() => new Date());
  let queue = Promise.resolve();
  return async (event) => {
    const record = {
      schemaVersion: 1,
      timestamp: clock().toISOString(),
      channel: event.channel,
      outcome: event.outcome,
      durationMs: Math.max(0, Math.floor(event.durationMs)),
      argumentCount: Math.max(0, Math.floor(event.argumentCount)),
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    };
    const line = `${JSON.stringify(record)}\n`;
    queue = queue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      const currentSize = await stat(filePath).then((value) => value.size).catch(() => 0);
      if (currentSize > 0 && currentSize + Buffer.byteLength(line) > maxBytes) {
        await rm(`${filePath}.1`, { force: true });
        await rename(filePath, `${filePath}.1`);
      }
      const handle = await open(filePath, "a", 0o600);
      try {
        await handle.writeFile(line, "utf8");
      } finally {
        await handle.close();
      }
    });
    return queue;
  };
}
