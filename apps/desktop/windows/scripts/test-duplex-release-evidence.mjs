import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const directory = mkdtempSync(join(tmpdir(), "opendrsai-duplex-release-")); const validator = new URL("./verify-duplex-release-evidence.mjs", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");
const seal = (payload) => ({ ...payload, integrity: { algorithm: "sha256", digest: createHash("sha256").update(JSON.stringify(payload)).digest("hex") } });
const common = { schemaVersion: 1, mode: "duplex", ok: true, generatedAt: new Date().toISOString(), tester: { name: "Release Tester", signedAt: new Date().toISOString(), attestation: "I personally reviewed the attached real run." }, attachments: ["evidence://run/video-and-report"] };
const reports = {
  packaged: seal({ ...common, kind: "packaged", packagedApp: true, featureFlag: "OPENDRSAI_ENABLE_DUPLEX_VOICE=1", observed: { uplinkAudioFrames: 10, downlinkAudioDeltas: 8, interrupts: 1, terminalCount: 1 } }),
  live: seal({ ...common, kind: "live", providerId: "zhizengzeng", modelId: "gpt-realtime-2", observed: { sessionReady: true, inputAudio: true, inputTranscript: true, outputAudio: true, outputTranscript: true, interruption: true, toolRoundTrip: true } }),
  hardware: seal({ ...common, kind: "hardware", runs: [
    { passed: true, checks: ["win10Builtin", "permissionDenied"], attachments: ["evidence://win10"] },
    { passed: true, checks: ["win11Builtin", "speakerAec", "sleepResume"], attachments: ["evidence://win11"] },
    { passed: true, checks: ["usbHeadset", "deviceUnplug"], attachments: ["evidence://usb"] },
    { passed: true, checks: ["bluetoothHeadset", "weakNetwork"], attachments: ["evidence://bluetooth"] },
  ] }),
};
try {
  for (const [kind, report] of Object.entries(reports)) { const path = join(directory, `${kind}.json`); writeFileSync(path, JSON.stringify(report)); const output = execFileSync(process.execPath, [validator, kind, path], { encoding: "utf8" }); assert.match(output, /release evidence passed/); }
  const fallback = { ...reports.packaged, mode: "serial" }; const fallbackPath = join(directory, "fallback.json"); writeFileSync(fallbackPath, JSON.stringify(fallback)); assert.notEqual(spawnSync(process.execPath, [validator, "packaged", fallbackPath]).status, 0, "serial fallback evidence must fail");
  const tampered = { ...reports.live, modelId: "other" }; const tamperedPath = join(directory, "tampered.json"); writeFileSync(tamperedPath, JSON.stringify(tampered)); assert.notEqual(spawnSync(process.execPath, [validator, "live", tamperedPath]).status, 0, "wrong model or digest must fail");
  console.log("Duplex Voice M10 evidence gates verified (packaged, Live, hardware, anti-fallback, attestation, attachments, and tamper detection).")
} finally { rmSync(directory, { recursive: true, force: true }); }
