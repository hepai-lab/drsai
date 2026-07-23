import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = mkdtempSync(join(tmpdir(), "opendrsai-terminal-replay-"));
try {
  const output = join(temp, "replay.mjs");
  await build({ entryPoints: [join(root, "../shared/main/terminalReplay.ts")], outfile: output, bundle: true, platform: "node", format: "esm" });
  const { reconcileTerminalReplay } = await import(pathToFileURL(output).href);
  const base = { generation: 2, sequence: 4 };
  const duplicate = reconcileTerminalReplay(base, null, [{ generation: 2, sequence: 4, value: "duplicate" }, { generation: 2, sequence: 5, value: "fresh" }]);
  assert.deepEqual(duplicate.accepted.map((item) => item.value), ["fresh"]);
  assert.deepEqual(duplicate.cursor, { generation: 2, sequence: 5 });

  const gap = reconcileTerminalReplay(base, null, [{ generation: 2, sequence: 6, value: "gap" }]);
  assert.equal(gap.snapshotRequired, true);
  assert.equal(gap.accepted.length, 0);
  const old = reconcileTerminalReplay(base, null, [{ generation: 1, sequence: 99, value: "old" }]);
  assert.equal(old.snapshotRequired, false);
  assert.equal(old.accepted.length, 0);
  const newer = reconcileTerminalReplay(base, null, [{ generation: 3, sequence: 1, value: "new generation" }]);
  assert.equal(newer.snapshotRequired, true);

  const restored = reconcileTerminalReplay(base, { generation: 3, sequence: 8 }, [
    { generation: 3, sequence: 8, value: "snapshot duplicate" },
    { generation: 3, sequence: 9, value: "delta" },
  ]);
  assert.equal(restored.snapshotAccepted, true);
  assert.deepEqual(restored.accepted.map((item) => item.value), ["delta"]);
  assert.deepEqual(restored.cursor, { generation: 3, sequence: 9 });
  console.log("Terminal generation, duplicate, gap, and snapshot replay verification passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
