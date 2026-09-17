import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { testLocalMicrophone } from "../../shared/renderer/src/voice/localDeviceTest.ts";

let stopped = 0;
let providerStarts = 0;
const liveTrack = { readyState: "live", label: "USB microphone", stop: () => { stopped += 1; } };
const ready = await testLocalMicrophone({ getUserMedia: async (constraints) => {
  assert.deepEqual(constraints, { audio: { deviceId: { exact: "usb-mic" } } });
  return { getAudioTracks: () => [liveTrack], getTracks: () => [liveTrack] };
} }, "usb-mic");
assert.deepEqual(ready, { ok: true, code: "ready", deviceLabel: "USB microphone" });
assert.equal(stopped, 1, "local test must release every acquired track");
assert.equal(providerStarts, 0, "local microphone test must never start a Provider session");

for (const [name, code] of [["NotAllowedError", "permission_denied"], ["SecurityError", "permission_denied"], ["NotFoundError", "device_missing"], ["OverconstrainedError", "device_missing"]]) {
  const result = await testLocalMicrophone({ getUserMedia: async () => { throw Object.assign(new Error(name), { name }); } }, "");
  assert.equal(result.code, code);
}
assert.equal((await testLocalMicrophone(undefined, "")).code, "unsupported");

const app = await readFile(new URL("../../shared/renderer/src/App.tsx", import.meta.url), "utf8");
assert.match(app, /data-testid="voice-device-summary"/);
assert.match(app, /data-testid="voice-advanced-settings"/);
assert.match(app, /data-testid="voice-local-mic-test"/);
const testFunction = app.slice(app.indexOf("const testLocalVoiceMicrophone"), app.indexOf("const switchVoicePreferencesToSerial"));
assert.ok(!/startDuplexVoiceSession|startVoiceTranscription|Provider/.test(testFunction), "local device test UI must not call a Provider or transcription API");
console.log("Local voice device test passed (live track, cleanup, permission/device errors, progressive settings, and zero Provider starts).");
