import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "../../../..");
const windows = resolve(root, "apps/desktop/windows");
const python = resolve(root, ".venv/Scripts/python.exe");
const npmCli = process.env.npm_execpath;
const full = process.argv.includes("--full");
if (!existsSync(python)) throw new Error("P7 release requires the repository Python virtual environment.");
if (!npmCli || !existsSync(npmCli)) throw new Error("P7 release must run through npm so its CLI can be pinned.");

const pythonTests = readdirSync(resolve(root, "cores/python/packages/drsai/tests"))
  .filter((name) => name.startsWith("test_codex_") && name.endsWith(".py"))
  .map((name) => resolve(root, "cores/python/packages/drsai/tests", name));
pythonTests.push(
  resolve(root, "cores/python/packages/drsai/tests/test_oaep_delta_parity.py"),
  resolve(root, "cores/python/packages/drsai/tests/test_oaep_runtime_four_path.py"),
  resolve(root, "cores/python/packages/drsai/tests/test_normalized_agent_events.py"),
  resolve(root, "cores/python/packages/drsai/tests/test_runtime_conversation_journal.py"),
);

const gates = [
  ["feature ledger", process.execPath, ["scripts/verify-codex-p7-feature-ledger.mjs", ...(full ? ["--require-complete"] : [])], windows],
  ["TypeScript typecheck", process.execPath, [npmCli, "run", "typecheck:windows"], resolve(root, "apps/desktop")],
  ["single Session stream", process.execPath, [npmCli, "run", "verify:oaep-session-stream"], windows],
  ["incremental Session View Store", process.execPath, [npmCli, "run", "verify:p7-session-view-store"], windows],
  ["16ms renderer patch batching", process.execPath, [npmCli, "run", "verify:thread-patch-frame-batcher"], windows],
  ["OAEP presentation", process.execPath, [npmCli, "run", "verify:oaep-presentation"], windows],
  ["restart recovery matrix", process.execPath, [npmCli, "run", "verify:codex-p7-restart-matrix"], windows],
  ["attachment lifecycle", process.execPath, [npmCli, "run", "verify:codex-p7-attachments"], windows],
  ["recovery action coordinator", process.execPath, [npmCli, "run", "verify:recovery-action-coordinator"], windows],
  ["ordinary and diagnostic UI separation", process.execPath, [npmCli, "run", "verify:run-inspector-ui"], windows],
  ["Desktop integration contract", process.execPath, [npmCli, "run", "verify:codex-desktop-integration"], windows],
  ["long conversation responsiveness", process.execPath, [npmCli, "run", "verify:conversation-performance"], windows],
  ["10k and large-output stress", process.execPath, [npmCli, "run", "verify:codex-v6-performance"], windows],
  ["Python Adapter mandatory suite", python, ["-m", "pytest", ...pythonTests, "-q"], root],
];

const results = [];
for (const [name, command, args, cwd] of gates) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  results.push({ name, command: [basename(command), ...args].join(" "), durationMs: Date.now() - startedAt, status: result.status });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    throw new Error(`Codex Adapter P7 release gate failed closed at ${name}.`);
  }
}

let live = null;
if (full) {
  const evidencePath = process.env.OPENDRSAI_CODEX_P7_LIVE_EVIDENCE;
  if (!evidencePath || !existsSync(evidencePath)) throw new Error("Full P7 release requires OPENDRSAI_CODEX_P7_LIVE_EVIDENCE.");
  live = JSON.parse(readFileSync(evidencePath, "utf8"));
  const observedAt = Date.parse(String(live.observedAt || ""));
  const accepted = live.passed === true && Date.now() - observedAt < 24 * 60 * 60 * 1_000
    && live.multiTurn?.turnCount >= 3 && live.multiTurn?.threadIdStable === true
    && live.streaming?.firstContentBeforeTerminal === true && live.restart?.converged === true
    && live.archive?.roundTrip === true && live.approval?.count >= 1
    && live.cancellation?.verified === true && live.workspaceFileOperation?.verified === true;
  if (!accepted) throw new Error("P7 live evidence is incomplete or stale; full release failed closed.");
}

function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => filesUnder(join(path, name)));
}
const evidenceSources = [
  ...filesUnder(resolve(root, "cores/python/packages/drsai/src/drsai/backend/codex_adapter")),
  resolve(root, "cores/python/packages/drsai/src/drsai/backend/runtime/oaep.py"),
  resolve(root, "cores/python/packages/drsai/src/drsai/backend/runtime/normalized_writer.py"),
  resolve(root, "apps/desktop/shared/main/oaepSessionStream.ts"),
  resolve(root, "apps/desktop/shared/main/sessionViewStore.ts"),
  resolve(root, "apps/desktop/shared/renderer/src/threadSnapshotPatch.ts"),
].sort();
const sourceHash = createHash("sha256");
for (const path of evidenceSources) sourceHash.update(path.slice(root.length)).update("\0").update(readFileSync(path));
const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).stdout.trim();
const codexPackagePath = resolve(windows, "node_modules/@openai/codex/package.json");
const codexPackage = JSON.parse(readFileSync(codexPackagePath, "utf8"));
const codexPlatformRoot = resolve(windows, `node_modules/@openai/codex-${process.platform}-${process.arch}`);
const codexBinary = filesUnder(codexPlatformRoot).find((path) => /(?:codex|codex-cli)(?:\.exe)?$/i.test(basename(path)));
if (!codexBinary) throw new Error("P7 release could not identify the installed Codex binary.");
const adapterVersionSource = readFileSync(resolve(root, "cores/python/packages/drsai/src/drsai/backend/codex_adapter/version.py"), "utf8");
const adapterVersion = adapterVersionSource.match(/CODEX_ADAPTER_MAPPING_VERSION\s*=\s*["']([^"']+)/)?.[1];
if (!adapterVersion) throw new Error("P7 release could not identify the Adapter mapping version.");
const report = {
  schema: "opendrsai.codex-adapter-p7.release.v1",
  passed: true,
  mode: full ? "full" : "contract",
  observedAt: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  dirtyDigest: createHash("sha256").update(git("status", "--porcelain=v1")).digest("hex"),
  sourceDigest: sourceHash.digest("hex"),
  oaepSchemaDigest: createHash("sha256").update(readFileSync(resolve(root, "cores/protocol/oaep/oaep.schema.json"))).digest("hex"),
  versions: { adapter: adapterVersion, oaep: "1.0", codex: codexPackage.version, evidenceSchema: "v1" },
  codexBinaryDigest: createHash("sha256").update(readFileSync(codexBinary)).digest("hex"),
  platform: { os: process.platform, arch: process.arch, node: process.version },
  gates: results,
  ...(live ? { live } : {}),
};
const output = resolve(root, ".artifacts/codex-p7-release-evidence.json");
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, evidence: output }, null, 2));
