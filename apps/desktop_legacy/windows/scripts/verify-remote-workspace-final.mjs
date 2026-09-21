import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const statusPath = join(root, "tests", "remote-workspace", "acceptance-status.json");
const status = JSON.parse(readFileSync(statusPath, "utf8"));
const checkOnly = process.argv.includes("--check");
const gates = [
  "110 unique verified feature points and zero known failures",
  "real remote_3090 evidence against an independently supplied user and host-key fingerprint",
  "completed one-hour stability evidence with zero residual tunnel/container",
  "Remote PTY acknowledgement/preflight plus strong-kill watchdog cleanup",
  "Windows build/hash/version integrity plus a strict signing pipeline contract",
  "internal acceptance readiness with unsigned artifacts explicitly classified as non-public",
  "zero OpenDrSai test temporary directories",
];

if (checkOnly) {
  console.log(JSON.stringify({ schemaVersion: 1, marker: "Remote Workspace final acceptance gate is ready.", gates, requiredEnvironment: ["OPENDRSAI_EXPECTED_REMOTE_HOST_USER", "OPENDRSAI_EXPECTED_REMOTE_HOST_FINGERPRINT"] }, null, 2));
  process.exit(0);
}

// Validate the authoritative 110-item plan/status partition before accepting any
// external identity input or running expensive environment gates.
run(process.execPath, ["scripts/remote-workspace-progress.mjs"]);
run(process.execPath, ["scripts/verify-remote-workspace-progress-regressions.mjs"]);

const failures = [];
if (status.schemaVersion !== 1) failures.push("acceptance status schemaVersion is not 1");
const verified = Array.isArray(status.verified) ? status.verified : [];
const ids = new Set(verified.map((item) => item?.id));
if (verified.length !== 110 || ids.size !== 110) failures.push(`acceptance status is ${verified.length}/110 with ${ids.size} unique IDs`);
if ((status.knownFailures || []).length !== 0) failures.push(`${status.knownFailures.length} known failure(s) remain`);
for (const item of verified) {
  if (!/^M\d{2}-F\d{2}$/.test(String(item?.id || "")) || !String(item?.evidence || "").trim() || !String(item?.detail || "").trim()) failures.push(`verified item ${item?.id || "<missing>"} lacks an ID, evidence or detail`);
}
if (failures.length) fail(failures);

const expectedUser = String(process.env.OPENDRSAI_EXPECTED_REMOTE_HOST_USER || "").trim();
const expectedFingerprint = String(process.env.OPENDRSAI_EXPECTED_REMOTE_HOST_FINGERPRINT || "").trim();
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(expectedUser) || expectedUser === "root") fail(["OPENDRSAI_EXPECTED_REMOTE_HOST_USER must be an independently supplied non-root user"]);
if (!/^SHA256:[A-Za-z0-9+/]{20,}={0,2}$/.test(expectedFingerprint)) fail(["OPENDRSAI_EXPECTED_REMOTE_HOST_FINGERPRINT must be independently supplied"]);

run(process.execPath, ["scripts/verify-external-remote-host-evidence.mjs"], {
  OPENDRSAI_REMOTE_HOST_EVIDENCE: process.env.OPENDRSAI_REMOTE_HOST_EVIDENCE || join(root, "release", "product-evidence", "remote-workspace", "remote_3090-final.json"),
  OPENDRSAI_EXPECTED_REMOTE_HOST_ALIAS: "remote_3090",
  OPENDRSAI_EXPECTED_REMOTE_HOST_USER: expectedUser,
  OPENDRSAI_EXPECTED_REMOTE_HOST_FINGERPRINT: expectedFingerprint,
});
run(process.execPath, ["scripts/verify-remote-stability-evidence.mjs"]);
run(process.execPath, ["scripts/verify-remote-stability-final-regressions.mjs"]);
run(process.execPath, ["scripts/verify-remote-pty-lifecycle.mjs"]);
run(process.execPath, ["scripts/verify-remote-pty-preflight-evidence.mjs"]);
run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/verify-remote-stability-watchdog.ps1"]);
run(process.execPath, ["scripts/verify-windows-signing-contract.mjs"]);
run(process.execPath, ["scripts/verify-windows-signing-evidence-regressions.mjs"]);
run(process.execPath, ["scripts/verify-release-readiness.mjs"], {
  REQUIRE_RELEASE_READY: "1",
  REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "0",
  SKIP_PUBLIC_RELEASE_CHECK: "1",
});
run(process.execPath, ["scripts/verify-test-temp-cleanup.mjs"]);
console.log(JSON.stringify({ status: "passed", verifiedFeatures: verified.length, gates: gates.length, remoteWorkspaceVersion: "V1", cleanupVerified: true }, null, 2));

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...extraEnv }, stdio: "inherit", windowsHide: true, timeout: 1_800_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
}

function fail(messages) {
  console.error(["Remote Workspace final acceptance failed:", ...messages.map((message) => `- ${message}`)].join("\n"));
  process.exit(1);
}
