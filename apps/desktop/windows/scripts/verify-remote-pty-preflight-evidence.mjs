import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const evidencePath = process.env.OPENDRSAI_REMOTE_PTY_PREFLIGHT_EVIDENCE || join(root, "release", "product-evidence", "remote-workspace", "remote-pty-preflight.json");
if (!existsSync(evidencePath)) throw new Error(`Remote PTY preflight evidence is missing: ${evidencePath}`);
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const samples = Array.isArray(evidence.samples) ? evidence.samples : [];
const failures = [];
if (evidence.schemaVersion !== 1 || evidence.mode !== "preflight" || evidence.completed !== true) failures.push("evidence is not a completed preflight");
if (evidence.temporaryCredential !== true) failures.push("temporary credential labelling is missing");
if (Number(evidence.durationSeconds) < 10 || Number(evidence.intervalSeconds) > 5 || samples.length < 2) failures.push("preflight duration, interval or sample coverage is insufficient");
let runtimeId = ""; let instanceId = "";
for (const [index, sample] of samples.entries()) {
  if (sample.tunnelCount !== 1 || sample.runtimeProcessCount !== 1 || sample.ptyProcessCount !== 0) failures.push(`sample ${index + 1} process counts are invalid`);
  runtimeId ||= String(sample.runtimeId || ""); instanceId ||= String(sample.instanceId || "");
  if (!runtimeId || !instanceId || sample.runtimeId !== runtimeId || sample.instanceId !== instanceId) failures.push(`sample ${index + 1} Runtime identity is missing or drifted`);
}
if (evidence.finalTunnelCount !== 0) failures.push("preflight did not clean its SSH tunnel");
const container = spawnSync("docker", ["ps", "-a", "--filter", "name=^/opendrsai-real-remote-gateway$", "--format", "{{.Names}}"], { encoding: "utf8", windowsHide: true });
if (container.error || container.status !== 0) throw container.error || new Error(container.stderr || "Unable to inspect Docker cleanup");
let cleanupVerified = !String(container.stdout || "").trim();
if (!cleanupVerified) {
  // A later formal window may legitimately reuse the fixed test-container
  // name. Its protected launcher refuses pre-existing containers, so a newer
  // bound state proves the preflight container had first been removed.
  const statePath = join(root, "release", "product-evidence", "remote-workspace", "remote-stability-1h.state.json");
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null;
  const inspected = spawnSync("docker", ["inspect", "opendrsai-real-remote-gateway", "--format", "{{.Id}}"], { encoding: "utf8", windowsHide: true });
  const newerFormalWindow = state
    && Date.parse(state.startedAt) > Date.parse(evidence.generatedAt)
    && String(state.containerId || "") === String(inspected.stdout || "").trim();
  if (!newerFormalWindow) failures.push("preflight Docker container remains or was not superseded by a newer bound formal window");
  cleanupVerified = Boolean(newerFormalWindow);
}
if (failures.length) throw new Error(`Remote PTY preflight evidence failed:\n- ${failures.join("\n- ")}`);
console.log(JSON.stringify({ status: "passed", samples: samples.length, runtimeId, instanceId, zeroOrphanPty: true, cleanupVerified }, null, 2));
