import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const evidencePath = process.env.OPENDRSAI_REMOTE_HOST_EVIDENCE
  || join(desktop, "release", "product-evidence", "remote-workspace", "remote-host-smoke.json");
const expectedAlias = String(process.env.OPENDRSAI_EXPECTED_REMOTE_HOST_ALIAS || process.env.OPENDRSAI_REMOTE_HOST_ALIAS || "remote_3090").trim();
const expectedUser = String(process.env.OPENDRSAI_EXPECTED_REMOTE_HOST_USER || process.env.OPENDRSAI_REMOTE_HOST_USER || "").trim();
const expectedFingerprint = String(process.env.OPENDRSAI_EXPECTED_REMOTE_HOST_FINGERPRINT || process.env.OPENDRSAI_REMOTE_HOST_FINGERPRINT || "").trim();
const requiredChecks = [
  "ssh", "runtime-install", "workspace", "files", "git", "session", "run", "tool-workspace-file",
  "approval", "checkpoint", "shell-pty", "long-command", "reconnect",
];
const failures = [];

if (!existsSync(evidencePath)) fail([`evidence does not exist: ${evidencePath}`]);
let evidence;
try { evidence = JSON.parse(readFileSync(evidencePath, "utf8")); }
catch (error) { fail([`evidence is invalid JSON: ${error instanceof Error ? error.message : String(error)}`]); }

if (!/^[A-Za-z0-9_.-]{1,255}$/.test(expectedAlias)) failures.push("expected host alias is invalid");
if (!/^[A-Za-z0-9_.-]{1,64}$/.test(expectedUser)) failures.push("OPENDRSAI_EXPECTED_REMOTE_HOST_USER is required and invalid");
if (!/^SHA256:[A-Za-z0-9+/]{20,}={0,2}$/.test(expectedFingerprint)) failures.push("OPENDRSAI_EXPECTED_REMOTE_HOST_FINGERPRINT is required and invalid");
if (evidence.schemaVersion !== 1) failures.push("schemaVersion is not 1");
if (evidence.passed !== true) failures.push("passed is not true");
if (evidence.cleanupVerified !== true) failures.push("cleanupVerified is not true");
if (evidence.temporaryArtifactPublisher !== true) failures.push("temporary artifact publisher is not labelled");
if (evidence.credentialMaterialPersisted !== false) failures.push("credentialMaterialPersisted is not false");
if (evidence.hostAlias !== expectedAlias) failures.push(`hostAlias ${evidence.hostAlias || "<missing>"} does not match ${expectedAlias}`);
if (evidence.nonRootUser !== expectedUser || evidence.nonRootUser === "root") failures.push(`non-root user ${evidence.nonRootUser || "<missing>"} does not match ${expectedUser}`);
if (evidence.operatingSystem !== "Linux") failures.push(`operatingSystem is ${evidence.operatingSystem || "<missing>"}, expected Linux`);
if (evidence.hostKeyFingerprint !== expectedFingerprint) failures.push("verified host-key fingerprint does not match the trusted expected fingerprint");
if (!/^runtime-[0-9a-f-]{36}$/i.test(String(evidence.runtimeId || ""))) failures.push("runtimeId is missing or invalid");
if (!/^instance-[0-9a-f-]{36}$/i.test(String(evidence.runtimeInstanceId || ""))) failures.push("runtimeInstanceId is missing or invalid");
if (!/^workspace-[0-9a-f-]{36}$/i.test(String(evidence.workspaceId || ""))) failures.push("workspaceId is missing or invalid");
if (!/^session-[0-9a-f-]{36}$/i.test(String(evidence.sessionId || ""))) failures.push("sessionId is missing or invalid");
if (!/^run-[0-9a-f-]{36}$/i.test(String(evidence.runId || ""))) failures.push("runId is missing or invalid");
if (expectedAlias === "remote_3090") {
  const prerequisites = evidence.temporaryPrerequisites;
  if (!prerequisites || typeof prerequisites !== "object") failures.push("remote_3090 temporary prerequisite evidence is missing");
  else {
    if (prerequisites.userLevelPython !== true) failures.push("remote_3090 temporary user-level Python is not verified");
    if (!/^\d+\.\d+\.\d+$/.test(String(prerequisites.uvVersion || ""))) failures.push("remote_3090 uv version is missing or invalid");
    if (prerequisites.sha256Verified !== true) failures.push("remote_3090 prerequisite SHA-256 verification is missing");
    if (prerequisites.temporarySshKey !== true) failures.push("remote_3090 temporary SSH key is not verified");
    if (prerequisites.cleaned !== true) failures.push("remote_3090 temporary prerequisites were not cleaned");
  }
}

const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
for (const required of requiredChecks) if (!checks.includes(required)) failures.push(`required check ${required} is missing`);
if (new Set(checks).size !== checks.length) failures.push("checks contains duplicate entries");
const generatedAt = Date.parse(evidence.generatedAt);
if (!Number.isFinite(generatedAt) || generatedAt > Date.now() + 60_000) failures.push("generatedAt is missing, invalid or in the future");

const serialized = JSON.stringify(evidence);
if (/-----BEGIN [^-]*PRIVATE KEY-----/.test(serialized)) failures.push("evidence contains private-key material");
if (/Bearer\s+\S+/i.test(serialized)) failures.push("evidence contains a bearer token");
if (/(?:password|secret|api[_-]?key)\s*[:=]\s*(?!\[REDACTED\])\S+/i.test(serialized)) failures.push("evidence contains secret-like material");

const tunnelCount = countSshTunnels(expectedAlias);
if (tunnelCount !== 0) failures.push(`${tunnelCount} SSH tunnel processes remain for ${expectedAlias}`);
if (failures.length) fail(failures);

console.log(JSON.stringify({
  status: "passed",
  hostAlias: evidence.hostAlias,
  nonRootUser: evidence.nonRootUser,
  hostKeyFingerprint: evidence.hostKeyFingerprint,
  runtimeId: evidence.runtimeId,
  workspaceId: evidence.workspaceId,
  sessionId: evidence.sessionId,
  runId: evidence.runId,
  checks: requiredChecks.length,
  cleanupVerified: true,
  temporaryPrerequisites: expectedAlias === "remote_3090" ? "verified" : "not-required",
  secretScan: "passed",
}, null, 2));

function countSshTunnels(alias) {
  if (process.platform !== "win32") return 0;
  const marker = alias.replace(/'/g, "''");
  const command = `@((Get-CimInstance Win32_Process | Where-Object { $line=[string]$_.CommandLine; $_.Name -like 'ssh*' -and $line.Contains('-N') -and $line.Contains('${marker}') })).Count`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Unable to inspect SSH tunnel cleanup: ${result.stderr || result.error?.message || "unknown error"}`);
  return Number(String(result.stdout || "").trim());
}

function fail(messages) {
  console.error(["External Remote Workspace host evidence verification failed:", ...messages.map((message) => `- ${message}`)].join("\n"));
  process.exit(1);
}
