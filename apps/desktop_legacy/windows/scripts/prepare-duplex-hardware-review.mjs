import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release, version } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const environment = process.argv.includes("--production") ? "production" : "development";
const outputArgument = process.argv.find((value, index, values) => values[index - 1] === "--output");
const root = resolve(import.meta.dirname, "..");
const output = resolve(outputArgument ?? resolve(root, "release/duplex-voice/hardware-review-workbook.json"));
const executable = resolve(root, "release/win-unpacked/OpenDrSai.exe");
const appAsar = resolve(root, "release/win-unpacked/resources/app.asar");
for (const artifact of [executable, appAsar]) assert.ok(existsSync(artifact), `Build the unpacked candidate before preparing hardware review: ${artifact}`);
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const step = (action, expected) => ({ action, expected, observed: null, passed: null });
const os = { platform: platform(), release: release(), build: version(), arch: arch() };
const scenario = (id, title, checks, deviceClasses, steps, requiredMetrics) => ({ id, title, checks, os, deviceClasses, steps, requiredMetrics, metrics: {}, attachments: [], passed: null });

const payload = {
  schemaVersion: 1,
  kind: "duplex-hardware-review-workbook",
  mode: "duplex",
  ok: false,
  generatedAt: new Date().toISOString(),
  environment,
  gateway: { profile: environment, port: environment === "development" ? 28642 : 18642 },
  providerId: "zhizengzeng",
  modelId: "gpt-realtime-2",
  protocolVersion: 2,
  artifacts: {
    executable: { uri: pathToFileURL(executable).toString(), sha256: sha256(executable) },
    appAsar: { uri: pathToFileURL(appAsar).toString(), sha256: sha256(appAsar) },
  },
  privacy: { deviceLabelsPersisted: false, transcriptTextPersisted: false, rawAudioRequired: false, credentialsPersisted: false },
  tester: null,
  instructions: [
    "Use the exact hash-bound unpacked candidate and the declared Gateway profile.",
    "Fill observed, passed, numeric metrics, attachment file URIs/SHA-256, and a named tester attestation only after performing each physical step.",
    "Do not enter device labels, transcript text, raw audio, credentials, or Provider event payloads.",
    "A programmatically emitted lifecycle event or simulated audio fixture is not a substitute for the physical action described here.",
  ],
  scenarios: [
    scenario("win11-builtin-sleep", "Windows 11 built-in audio, speaker AEC, lock and sleep/resume", ["win11Builtin", "speakerAec", "sleepResume"], ["builtin-microphone", "builtin-speaker"], [
      step("Start a packaged Realtime conversation and exchange two spoken turns over the built-in speaker.", "Speech is intelligible and speaker echo does not create an unintended interruption."),
      step("Physically lock Windows, unlock it, then continue the same Session.", "The microphone state is visible and conversation recovery is explained without replaying disconnected speech."),
      step("Put the computer to sleep using Windows, wake it, and continue or follow the displayed recovery action.", "No zombie microphone or Session remains; recovery is predictable and the last stable Thread history remains intact."),
    ], ["ttfaMs", "stopLatencyMs", "reconnectCount", "terminalCount"]),
    scenario("win10-builtin-permission", "Windows 10 built-in audio and permission denial/recovery", ["win10Builtin", "permissionDenied"], ["builtin-microphone", "builtin-speaker"], [
      step("Deny microphone permission from the real Windows privacy control and try to start Realtime voice.", "No Provider Session or microphone occupancy is created and the UI gives a usable recovery action."),
      step("Restore permission and retry without resetting application data.", "A real spoken turn succeeds and the Session ends with exactly one terminal event."),
    ], ["providerSessionsBeforePermission", "providerSessionsAfterRecovery", "terminalCount"]),
    scenario("usb-unplug", "USB headset hot switch and unplug", ["usbHeadset", "deviceUnplug"], ["usb-headset"], [
      step("Start on built-in audio, switch input and output to a USB headset while the Session is active.", "Old-device frames do not leak into the new generation and the output transition is explained."),
      step("Unplug the USB headset during playback and follow the recovery action.", "Playback/microphone move to a valid fallback or remain safely paused; the Session can be ended cleanly."),
    ], ["switchLatencyMs", "unexpectedTerminalCount", "terminalCount"]),
    scenario("bluetooth-weak-network", "Bluetooth headset and weak network", ["bluetoothHeadset", "weakNetwork"], ["bluetooth-headset"], [
      step("Use a Bluetooth headset for a five-minute conversation including an acknowledgement and an explicit interruption.", "Acknowledgement does not cancel the answer; explicit interruption stops promptly without stale audio."),
      step("Introduce a real Wi-Fi interruption, restore it, and continue after the recovery notice.", "Lost speech is not replayed, reconnect is bounded, and the user is told what may need repeating."),
    ], ["interruptLatencyMs", "reconnectCount", "lostAudioMs", "underrunCount", "terminalCount"]),
  ],
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Pending physical Duplex review workbook written to ${output}. It remains ok=false and unsigned.`);
