import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [main, preload, controller, gateway] = await Promise.all([
  read("windows/src/main/index.ts"), read("shared/main/preload.ts"),
  read("shared/main/voice/duplex/controller.ts"), read("../../cores/python/packages/drsai/src/drsai/backend/gateway.py"),
]);

for (const channel of ["start", "update", "interrupt", "tool-result", "stop", "cancel", "dispose"]) {
  assert.match(main, new RegExp(`secureHandle\\(\\s*[\"']desktop:voice-duplex-${channel}`), `${channel} must use trusted secureHandle`);
}
assert.match(main, /isTrustedSender[\s\S]*desktop:voice-duplex-audio-port/);
assert.match(preload, /new MessageChannel\(\)[\s\S]*desktop:voice-duplex-audio-port/);
assert.match(controller, /getGatewayRequestHeaders[\s\S]*X-OpenDrSai-Gateway-Token/);
assert.doesNotMatch(preload, /X-OpenDrSai-Gateway-Token|Authorization.*voice-duplex/);
assert.match(gateway, /@app\.websocket\("\/v1\/audio\/duplex"\)/);
assert.match(gateway, /policy\.realtime_voice_model/);
assert.match(gateway, /selection\.ref\.provider_id != start\["providerId"\]/);
assert.match(gateway, /key not in \{"token", "authorization", "api_key"\}/);

console.log("Duplex Voice M3 IPC security verified (trusted sender, MessagePort audio, exact policy binding, and secret isolation).");
