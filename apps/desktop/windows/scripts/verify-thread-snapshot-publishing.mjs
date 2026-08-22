import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const adapter = readFileSync(
  join(root, "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"),
  "utf8",
);
const app = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");

const publishAndReturn = adapter.slice(
  adapter.indexOf("function publishAndReturn"),
  adapter.indexOf("function publishThreadUpdate"),
);
const scheduledPublisher = adapter.slice(
  adapter.indexOf("function scheduleThreadUpdate"),
  adapter.indexOf("function createThreadSnapshot"),
);

assert.match(publishAndReturn, /scheduleThreadUpdate\(nextMessages\)/);
assert.doesNotMatch(publishAndReturn, /publishThreadUpdate\(nextMessages\)/);
assert.match(scheduledPublisher, /pendingThreadSnapshotRef\.current = snapshot/);
assert.match(scheduledPublisher, /queueMicrotask\(\(\) =>/);
assert.match(scheduledPublisher, /notifyThreadUpdated\(pendingSnapshot\)/);
assert.match(adapter, /threadId: threadIdRef\.current/);
assert.match(adapter, /result\.catch\(\(error\) =>/);
assert.match(
  app,
  /if \(!storedSnapshot \|\| storedSnapshot\.updatedAt < snapshot\.updatedAt\) \{\s+threadSnapshotStore\.set/,
);

process.stdout.write("Thread snapshot publishing verification passed (8 checks).\n");
