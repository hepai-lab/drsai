import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [workspace, hook, capture] = await Promise.all([
  read("shared/renderer/src/components/ChatWorkspace.tsx"),
  read("shared/renderer/src/voice/duplex/useDuplexVoiceInput.ts"),
  read("shared/renderer/src/voice/duplex/captureController.ts"),
]);

assert.match(workspace, /<option value="duplex" disabled=!?{!duplexVoiceAvailability\.available}/);
assert.match(workspace, /if \(voicePreferences\.interactionMode === "duplex"\)[\s\S]*duplexVoiceInput\.start\(\)/);
assert.match(workspace, /onClick=\{\(\) => \{[\s\S]*toggleVoiceRecording/);
assert.match(workspace, /data-testid="duplex-voice-status"/);
assert.match(workspace, /duplexVoiceInput\.cancel\(\)/);
assert.match(hook, /startFromUserGesture\(\)/);
assert.match(capture, /mediaDevices\.getUserMedia/);
assert.doesNotMatch(hook, /useEffect\([^)]*=>[\s\S]{0,200}startFromUserGesture/);
assert.doesNotMatch(workspace, /useEffect\([^)]*=>[\s\S]{0,200}duplexVoiceInput\.start/);

console.log("Duplex Voice M4 UI route verified (explicit click, availability gate, status, cancellation, and no automatic microphone start).")
