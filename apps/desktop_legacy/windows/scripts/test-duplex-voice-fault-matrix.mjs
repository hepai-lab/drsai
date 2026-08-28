import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const bundled = resolve(root, "../shared/test-kit/run-bundled-test.mjs");
const cases = [
  { domain: "network", reason: "reconnect_exhausted", args: [bundled, "scripts/test-duplex-voice-recovery.mjs"], marker: /reconnect/ },
  { domain: "provider", reason: "provider_protocol_error", args: [bundled, "scripts/test-duplex-voice-provider.mjs"], marker: /Provider|provider/ },
  { domain: "ipc", reason: "invalid_ipc_payload", args: ["scripts/verify-duplex-voice-ipc.mjs"], marker: /IPC/ },
  { domain: "device", reason: "input_device_unavailable", args: [bundled, "scripts/test-duplex-voice-capture.mjs"], marker: /capture|Capture/ },
  { domain: "audio_context", reason: "audio_context_suspended", args: [bundled, "scripts/test-duplex-voice-playback.mjs"], marker: /playback|Playback/ },
  { domain: "io", reason: "history_write_failed", args: [bundled, "scripts/test-duplex-voice-history.mjs"], marker: /history|History/ },
  { domain: "approval", reason: "approval_rejected", args: [bundled, "scripts/test-duplex-voice-desktop-approval.mjs"], marker: /approval|Approval/ },
  { domain: "race", reason: "duplicate_terminal", args: [bundled, "scripts/test-duplex-voice-runtime.mjs"], marker: /10000|10,000/ },
  { domain: "property", reason: "seeded_invariant", args: ["--no-warnings", "--experimental-strip-types", "scripts/test-duplex-voice-fault-properties.mjs"], marker: /fixed seed.*10,000/ },
];

for (const testCase of cases) {
  const result = spawnSync(process.execPath, testCase.args, { cwd: root, encoding: "utf8", env: { ...process.env, OPENDRSAI_DUPLEX_FAULT_SEED: "1592639710" }, timeout: 120_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(result.status, 0, `[${testCase.domain}:${testCase.reason}] failed\n${output}`);
  assert.match(output, testCase.marker, `[${testCase.domain}:${testCase.reason}] produced no expected coverage marker`);
  console.log(`[${testCase.domain}:${testCase.reason}] passed`);
}

console.log("Duplex Voice M10 fault matrix passed (network, Provider, IPC, device, AudioContext, I/O, approval, fixed-seed properties, and 10,000 terminal races).");
