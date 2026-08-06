import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dirname, "../../shared/main/chat.ts"), "utf8");
const forbiddenSharedIdentifiers = [
  "CodexProjectionTarget",
  "CodexChatTarget",
  "codexChatTargets",
  "emitCodexOaepEvent",
  "mapCodexOaepEvent",
];

for (const identifier of forbiddenSharedIdentifiers) {
  assert.equal(source.includes(identifier), false, `${identifier} must not name shared Runtime/OAEP state`);
}
assert.match(source, /interface RuntimeProjectionTarget/, "shared OAEP projection must use Runtime terminology");
assert.match(source, /const runtimeChatTargets = new Map/, "shared active Run state must use Runtime terminology");
assert.match(source, /function emitRuntimeOaepEvent/, "shared OAEP events must use Runtime terminology");
assert.match(source, /agentDefinition === "codex@1"/, "Codex-specific preflight must remain explicitly scoped to the adapter branch");

console.log(`OpenDrSai backend-neutral naming verified: ${forbiddenSharedIdentifiers.length} legacy shared identifiers absent.`);
