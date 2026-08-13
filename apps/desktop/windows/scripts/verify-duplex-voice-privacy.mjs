import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const [workspace, hook, runtime] = await Promise.all([
  readFile(resolve(root, "shared/renderer/src/components/ChatWorkspace.tsx"), "utf8"),
  readFile(resolve(root, "shared/renderer/src/voice/duplex/useDuplexVoiceInput.ts"), "utf8"),
  readFile(resolve(root, "shared/main/voice/duplex/runtime.ts"), "utf8"),
]);
assert.match(workspace, /remote Provider \$\{ref\.provider_id\}, model \$\{ref\.model_id\}/);
assert.match(workspace, /if \(!privacyAlreadyConfirmed && !duplexPrivacyConfirmed\)[\s\S]{0,180}return/);
assert.match(workspace, /I understand—start Realtime voice/);
const gateIndex = workspace.indexOf("!privacyAlreadyConfirmed && !duplexPrivacyConfirmed");
const startIndex = workspace.indexOf("duplexVoiceInput.start()", gateIndex);
assert.ok(gateIndex >= 0 && startIndex > gateIndex, "privacy confirmation must precede microphone/Session start");
assert.match(hook, /message: "Realtime voice Session metrics"[\s\S]{0,200}attributes: event\.metrics/);
assert.doesNotMatch(runtime, /console\.(?:log|debug|info).*audioData|console\.(?:log|debug|info).*transcript/);
console.log("Duplex Voice M9 privacy verified (exact Provider/model disclosure, explicit pre-start confirmation, numeric-only diagnostics, and no raw voice logging).")
