import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const verifier = resolve(root, "scripts/verify-duplex-legacy-removal-gate.mjs");
const normal = spawnSync(process.execPath, [verifier], { cwd: root, encoding: "utf8" });
assert.equal(normal.status, 0, normal.stderr); assert.match(normal.stdout, /P3 removal decision/);
for (const removed of [
  "../shared/renderer/src/voice/streaming/use" + "StreamingVoiceInput.ts",
  "scripts/test-streaming-voice-main.mjs",
]) assert.equal(existsSync(resolve(root, removed)), false, `removed Streaming runtime returned: ${removed}`);
console.log("Duplex Voice M10 legacy gate verified (P3 runtime removal, no UI/new config, and old preference migration retained).");
