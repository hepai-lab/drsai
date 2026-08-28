import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const evidenceDir = join(desktop, "release", "product-evidence", "remote-workspace");
const statePath = process.env.OPENDRSAI_REMOTE_STABILITY_STATE || join(evidenceDir, "remote-stability-1h.state.json");
const evidencePath = process.env.OPENDRSAI_REMOTE_STABILITY_EVIDENCE || join(evidenceDir, "remote-stability-1h.json");
const allowRunning = process.argv.includes("--allow-running");

const state = readJson(statePath, "stability state");
const evidence = readJson(evidencePath, "stability evidence");
const failures = [];
const samples = Array.isArray(evidence.samples) ? evidence.samples : [];
const durationSeconds = Number(evidence.durationSeconds);
const intervalSeconds = Number(evidence.intervalSeconds);
const processRunning = isProcessRunning(Number(state.pid));
let watchdogRunning = isProcessRunning(Number(state.watchdogPid));

if (state.temporaryCredential !== true || evidence.temporaryCredential !== true) failures.push("temporary credential labelling is missing");
if (evidence.mode !== "1h" || durationSeconds < 3_600) failures.push("evidence is not a one-hour run");
if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 3_600) failures.push("sample interval is outside the accepted range");
if (Number(state.durationSeconds) !== durationSeconds || Number(state.intervalSeconds) !== intervalSeconds) failures.push("state/evidence duration or interval mismatch");
if (!samples.length) failures.push("no stability samples were recorded");

let previousElapsed = -1;
let runtimeId = "";
let instanceId = "";
for (const [index, sample] of samples.entries()) {
  const elapsed = Number(sample.elapsedSeconds);
  if (!Number.isFinite(elapsed) || elapsed <= previousElapsed) failures.push(`sample ${index + 1} elapsed time is not strictly increasing`);
  if (index > 0 && elapsed - previousElapsed > intervalSeconds + 180) failures.push(`sample ${index + 1} exceeds the allowed sampling gap`);
  if (sample.tunnelCount !== 1) failures.push(`sample ${index + 1} has ${sample.tunnelCount} SSH tunnels instead of 1`);
  if (sample.runtimeProcessCount !== 1) failures.push(`sample ${index + 1} has ${sample.runtimeProcessCount} Runtime processes instead of 1`);
  if (sample.ptyProcessCount !== 0) failures.push(`sample ${index + 1} has ${sample.ptyProcessCount ?? "missing"} orphan PTY processes instead of 0`);
  if (!sample.runtimeId || !sample.instanceId) failures.push(`sample ${index + 1} omits Runtime identity`);
  runtimeId ||= String(sample.runtimeId || "");
  instanceId ||= String(sample.instanceId || "");
  if (runtimeId && sample.runtimeId !== runtimeId) failures.push(`sample ${index + 1} changed runtimeId`);
  if (instanceId && sample.instanceId !== instanceId) failures.push(`sample ${index + 1} changed instanceId`);
  previousElapsed = elapsed;
}

if (failures.length) fail(failures);

if (!evidence.completed) {
  if (!allowRunning) fail(["one-hour evidence is not complete"]);
  if (!processRunning) fail(["stability process exited before writing completed evidence"]);
  if (!Number.isInteger(Number(state.watchdogPid)) || !watchdogRunning || !String(state.watchdogEvidence || "").trim()) fail(["independent stability cleanup watchdog is not active or recorded"]);
  const startedAt = Date.parse(state.startedAt);
  if (!Number.isFinite(startedAt)) fail(["state startedAt is invalid"]);
  const wallElapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (wallElapsed > durationSeconds + 600) fail(["stability process exceeded its completion deadline"]);
  const liveTunnelCount = countProcesses("ssh", String(process.env.OPENDRSAI_SSH_CONFIG || join(desktop, ".cache", "real-ssh-config")), "-N");
  if (liveTunnelCount !== 1) fail([`live SSH tunnel count is ${liveTunnelCount}, expected 1`]);
  const liveContainer = inspectDockerContainer("opendrsai-real-remote-gateway");
  if (!liveContainer || !liveContainer.running) fail(["stability Docker container is not running"]);
  if (!state.containerId) fail(["stability state is not bound to a Docker container ID"]);
  if (state.containerId !== liveContainer.id) fail([`stability Docker container changed from ${state.containerId} to ${liveContainer.id}`]);
  console.log(JSON.stringify({ status: "running", pid: state.pid, watchdogPid: state.watchdogPid, wallElapsedSeconds: wallElapsed, samples: samples.length, lastElapsedSeconds: previousElapsed, runtimeId, instanceId, tunnelCount: liveTunnelCount, containerId: liveContainer.id }, null, 2));
  process.exit(0);
}

const expectedSamples = Math.max(2, Math.floor(durationSeconds / intervalSeconds));
if (samples.length < expectedSamples) failures.push(`only ${samples.length}/${expectedSamples} required samples were recorded`);
if (previousElapsed < durationSeconds - intervalSeconds - 180) failures.push("last sample does not cover the required stability window");
if (evidence.finalTunnelCount !== 0) failures.push(`finalTunnelCount is ${evidence.finalTunnelCount}, expected 0`);
if (processRunning) failures.push("stability launcher process is still running after completed evidence");
for (let attempt = 0; watchdogRunning && attempt < 30; attempt += 1) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  watchdogRunning = isProcessRunning(Number(state.watchdogPid));
}
if (watchdogRunning) failures.push("stability cleanup watchdog is still running after its cleanup deadline");
const watchdogEvidence = readOptionalJson(String(state.watchdogEvidence || ""));
if (!watchdogEvidence || watchdogEvidence.schemaVersion !== 1 || watchdogEvidence.runnerPid !== Number(state.pid) || watchdogEvidence.boundContainerId !== state.containerId || watchdogEvidence.cleanupVerified !== true || watchdogEvidence.remainingTunnels !== 0 || watchdogEvidence.remainingBoundContainer !== false || (watchdogEvidence.failures || []).length !== 0) {
  failures.push("independent watchdog cleanup evidence is missing, mismatched or failed");
}

if (evidence.finalization?.kind === "requirement-reduced-after-observed-window") {
  verifyPolicyChangeFinalization(evidence, state, failures);
} else {
  const stdoutPath = String(state.stdout || "");
  const stdout = existsSync(stdoutPath) ? readFileSync(stdoutPath, "utf8") : "";
  if (!stdout.includes(`verified ${durationSeconds}s long stability`)) failures.push("stdout does not contain the one-hour stability completion marker");
  if (!stdout.includes("Real OpenDrSai Gateway Docker E2E passed.")) failures.push("stdout does not contain the final real Gateway success marker");
}

const tunnelCount = countProcesses("ssh", String(process.env.OPENDRSAI_SSH_CONFIG || join(desktop, ".cache", "real-ssh-config")), "-N");
if (tunnelCount !== 0) failures.push(`${tunnelCount} matching SSH tunnel processes remain`);
const containerCount = countDockerContainer("opendrsai-real-remote-gateway");
if (containerCount !== 0) failures.push(`${containerCount} stability Docker containers remain`);

if (failures.length) fail(failures);
console.log(JSON.stringify({ status: "passed", durationSeconds, samples: samples.length, finalTunnelCount: evidence.finalTunnelCount, runtimeId, instanceId, cleanupVerified: true }, null, 2));

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function readOptionalJson(path) {
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function countProcesses(nameMarker, commandMarker, argumentMarker) {
  if (process.platform !== "win32") return 0;
  const markers = [nameMarker, commandMarker, argumentMarker].map((value) => String(value).replace(/'/g, "''"));
  const command = `@((Get-CimInstance Win32_Process | Where-Object { $line=[string]$_.CommandLine; $_.Name -like '*${markers[0]}*' -and $line.Contains('${markers[1]}') -and $line.Contains('${markers[2]}') })).Count`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Unable to inspect SSH tunnel processes: ${result.stderr || result.error?.message || "unknown error"}`);
  return Number(String(result.stdout || "").trim());
}

function countDockerContainer(name) {
  const result = spawnSync("docker", ["ps", "-a", "--filter", `name=^/${name}$`, "--format", "{{.Names}}"], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Unable to inspect Docker cleanup: ${result.stderr || result.error?.message || "unknown error"}`);
  return String(result.stdout || "").split(/\r?\n/).filter((value) => value.trim() === name).length;
}

function inspectDockerContainer(name) {
  const result = spawnSync("docker", ["inspect", name, "--format", "{{.Id}} {{.State.Running}}"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return null;
  const [id, running] = String(result.stdout || "").trim().split(/\s+/);
  return id ? { id, running: running === "true" } : null;
}

function verifyPolicyChangeFinalization(current, currentState, targetFailures) {
  const finalization = current.finalization || {};
  const sourcePath = String(finalization.sourceEvidence || "");
  const source = readOptionalJson(sourcePath);
  if (!source || source.schemaVersion !== 1) {
    targetFailures.push("policy-change source evidence is missing or invalid");
    return;
  }
  const sourceHash = sha256File(sourcePath);
  if (!sourceHash || sourceHash !== String(finalization.sourceSha256 || "")) targetFailures.push("policy-change source evidence hash does not match");
  if (Number(finalization.previousRequirementSeconds) !== 86_400 || Number(finalization.newRequirementSeconds) !== durationSeconds) targetFailures.push("policy-change duration metadata is invalid");
  if (Number(finalization.observedWindowSeconds) < durationSeconds) targetFailures.push("policy-change source did not observe the required window");
  if (Number(source.durationSeconds) < Number(finalization.previousRequirementSeconds) || source.completed !== false) targetFailures.push("policy-change source is not the recorded superseded long window");
  const sourceSamples = Array.isArray(source.samples) ? source.samples : [];
  for (const sample of samples) {
    const match = sourceSamples.find((candidate) => Number(candidate.elapsedSeconds) === Number(sample.elapsedSeconds));
    if (!match || JSON.stringify(match) !== JSON.stringify(sample)) targetFailures.push(`policy-change sample ${sample.elapsedSeconds} is not byte-equivalent to source evidence`);
  }
  if (String(currentState.finalizationKind || "") !== finalization.kind) targetFailures.push("policy-change state/evidence finalization kind differs");
}

function sha256File(path) {
  if (!path || !existsSync(path)) return "";
  const result = spawnSync(process.execPath, ["-e", "const fs=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))", path], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function fail(messages) {
  console.error(["Remote stability evidence verification failed:", ...messages.map((message) => `- ${message}`)].join("\n"));
  process.exit(1);
}
