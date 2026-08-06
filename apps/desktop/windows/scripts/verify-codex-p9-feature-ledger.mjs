import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { discoverP9CodexBinary, p9CodexDigestEntries, p9GitDiffArgs, p9SourceEntries } from "./codex-p9-source-scope.mjs";

const root = resolve(import.meta.dirname, "../../../..");
const release = process.argv.includes("--release");
const ledger = JSON.parse(readFileSync(resolve(root, "docs/remote_workespace/codex-adapter-p9-feature-ledger.json"), "utf8"));
const rows = Object.entries(ledger.features || {});
const planPath = p9PlanPath();
const currentSourceDigest = digestFiles(p9SourceEntries(root, planPath));
const currentDirtyDigest = sha(spawnSync("git", p9GitDiffArgs(root, planPath),
  { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).stdout || "");
const discoveredCodex = discoverP9CodexBinary(root);
const codexDigestEntries = p9CodexDigestEntries(root, discoveredCodex);
const currentCodexBinaryDigest = codexDigestEntries.length ? digestFiles(codexDigestEntries) : sha("unavailable:unavailable");
if (ledger.total !== 48 || rows.length !== 48 || new Set(rows.map(([id]) => id)).size !== 48) {
  throw new Error("P9 ledger is not one-to-one with 48 features.");
}
for (const [id, row] of rows) {
  if (!/^M(?:0[1-8])-F0[1-6]$/.test(id) || !["accepted", "blocked", "failed", "missing"].includes(row.status)) {
    throw new Error(`Invalid P9 ledger row: ${id}`);
  }
  if (!existsSync(resolve(root, row.source))) throw new Error(`${id} source is missing: ${row.source}`);
  if (row.status !== "accepted") {
    if (release) throw new Error(`${id} is not accepted: ${row.status}/${row.reason || "unknown"}`);
    continue;
  }
  const artifact = resolve(root, row.artifact);
  if (!existsSync(artifact)) throw new Error(`${id} accepted evidence is missing.`);
  const bytes = readFileSync(artifact);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (row.artifactDigest !== digest) throw new Error(`${id} artifact digest mismatch.`);
  const result = JSON.parse(bytes.toString("utf8"));
  if (result.suite !== row.suite || result.executed !== true || result.status !== 0
    || !Array.isArray(result.features) || !result.features.includes(id)) {
    throw new Error(`${id} has no successful feature-specific assertion evidence.`);
  }
  for (const field of ["sourceDigest", "dirtyDigest", "buildDigest", "codexBinaryDigest", "codexVersion", "observedAt", "host"]) {
    if (!result[field]) throw new Error(`${id} accepted artifact lacks ${field}.`);
  }
  if (result.sourceDigest !== currentSourceDigest || result.dirtyDigest !== currentDirtyDigest) {
    throw new Error(`${id} evidence belongs to different source or dirty-worktree bytes `
      + `(sourceChanged=${result.sourceDigest !== currentSourceDigest}, dirtyChanged=${result.dirtyDigest !== currentDirtyDigest}).`);
  }
  if (result.codexBinaryDigest !== currentCodexBinaryDigest) throw new Error(`${id} Codex binary evidence is stale.`);
  if (!Array.isArray(result.commands) || !result.commands.length || result.commands.some((command) => command?.status !== 0)) {
    throw new Error(`${id} command evidence is incomplete or unsuccessful.`);
  }
  if (id === "M01-F05" || id === "M08-F04") verifyElectronEvidence(result, id);
  if (id === "M01-F04" || id === "M08-F05") verifyLiveEvidence(result, id);
  const assertion = Array.isArray(result.assertions) && result.assertions.find((value) => value?.feature === id);
  if (!assertion || assertion.passed !== true || typeof assertion.id !== "string") {
    throw new Error(`${id} lacks a successful named assertion.`);
  }
}
console.log(`Codex Adapter P9 ledger verified${release ? " for release" : ""}: ${rows.length} rows.`);

function verifyElectronEvidence(result, id) {
  const evidence = result.commands.map((command) => command?.result)
    .find((value) => value?.details?.transport === "electron-ipc-main-preload-renderer");
  if (!evidence || evidence.ok !== true || !evidence.checks
    || Object.values(evidence.checks).some((value) => value !== true)
    || evidence.details.patchCount !== 1_000
    || !Number.isFinite(evidence.details.latencyP95Ms)
    || !Number.isFinite(evidence.details.applyP95Ms)
    || !Number.isFinite(evidence.details.renderP95Ms)
    || evidence.details.finalContentLength !== 1_000) {
    throw new Error(`${id} lacks inspectable Electron transport/reducer/render evidence.`);
  }
}

function verifyLiveEvidence(result, id) {
  const command = result.commands.find((candidate) => candidate?.result?.passed === true
    && typeof candidate.result.evidence === "string" && typeof candidate.evidenceDigest === "string");
  if (!command) throw new Error(`${id} lacks inspectable native Live evidence.`);
  const evidencePath = resolve(command.result.evidence);
  const allowedRoot = resolve(root, ".artifacts/codex-p9-live-current");
  if (relative(allowedRoot, evidencePath).startsWith("..") || !existsSync(evidencePath)) {
    throw new Error(`${id} Live evidence escapes the isolated acceptance directory.`);
  }
  const bytes = readFileSync(evidencePath);
  if (createHash("sha256").update(bytes).digest("hex") !== command.evidenceDigest) {
    throw new Error(`${id} Live evidence digest mismatch.`);
  }
  const evidence = JSON.parse(bytes.toString("utf8"));
  if (evidence.passed !== true || evidence.multiTurn?.turnCount < 30
    || evidence.multiTurn?.threadIdStable !== true || evidence.multiTurn?.turnIdsUnique !== true
    || evidence.multiTurn?.contextRetained !== true || evidence.streaming?.firstContentBeforeTerminal !== true
    || Number(evidence.approval?.count || 0) < 1 || evidence.cancellation?.verified !== true
    || evidence.archive?.roundTrip !== true || evidence.workspaceFileOperation?.verified !== true
    || evidence.runtime?.restartVerified !== true) {
    throw new Error(`${id} native Live evidence is incomplete.`);
  }
}

function sha(value) { return createHash("sha256").update(value || "").digest("hex"); }
function p9PlanPath() {
  const directory = resolve(root, "docs/remote_workespace");
  const name = readdirSync(directory).find((value) => value.startsWith("OpenDrSaiCodexAdapter_OAEP_P9") && value.includes("真实增量"));
  if (!name) throw new Error("P9 plan source is missing.");
  return join(directory, name);
}
function digestFiles(entries) {
  const files = entries.flatMap(walk).sort();
  const hash = createHash("sha256");
  for (const file of files) hash.update(relative(root, file).replaceAll("\\", "/")).update("\0").update(readFileSync(file)).update("\0");
  return hash.digest("hex");
}
function walk(entry) {
  if (!existsSync(entry)) return [];
  if (isDerivedEvidencePath(entry)) return [];
  if (statSync(entry).isFile()) return [entry];
  return readdirSync(entry).flatMap((name) => walk(join(entry, name)));
}
function isDerivedEvidencePath(entry) {
  return /[\\/](?:node_modules|out|dist|\.artifacts|__pycache__)(?:[\\/]|$)/.test(entry)
    || /\.(?:pyc|pyo|tsbuildinfo)$/i.test(entry);
}
