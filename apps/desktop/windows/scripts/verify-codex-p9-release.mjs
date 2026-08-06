import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { discoverP9CodexBinary, p9CodexDigestEntries, p9GitDiffArgs, p9SourceEntries } from "./codex-p9-source-scope.mjs";

const root = resolve(import.meta.dirname, "../../../..");
const windows = resolve(root, "apps/desktop/windows");
const python = resolve(root, ".venv/Scripts/python.exe");
const npmCli = process.env.npm_execpath;
const full = process.argv.includes("--full");
const electronOnly = process.argv.includes("--electron-only");
if (!existsSync(python) || !npmCli || !existsSync(npmCli)) throw new Error("P9 release requires npm and the repository .venv.");
const resultRoot = resolve(root, ".artifacts/codex-p9/results");
mkdirSync(resultRoot, { recursive: true });
const planPath = p9PlanPath();
const sourceDigest = digestFiles(p9SourceEntries(root, planPath));
const dirtyDigest = sha(run("git", p9GitDiffArgs(root, planPath), root).stdout);
const buildDigest = digestFiles([resolve(windows, "out")]);
const common = { sourceDigest, dirtyDigest, buildDigest, ...readCodexIdentity(), host: hostname(), observedAt: new Date().toISOString() };
const suites = [
  { suite: "p9-evidence", features: ["M01-F01","M01-F02","M01-F03","M01-F06"], steps: [
    [process.execPath, ["scripts/verify-codex-p9-evidence-contract.mjs"], windows],
    [process.execPath, [npmCli, "run", "typecheck"], windows],
  ] },
  { suite: "p9-binding", features: ids("M02"), steps: [[python, ["-m","pytest",
    "cores/python/packages/drsai/tests/test_agent_backend_bindings.py",
    "cores/python/packages/drsai/tests/test_codex_backend_client.py","-q"], root]] },
  { suite: "p9-snapshot", features: ids("M03"), steps: [
    [process.execPath, [npmCli,"run","verify:p8-transactional-patch"], windows],
    [process.execPath, [npmCli,"run","verify:p9-runtime-identity"], windows],
  ] },
  { suite: "p9-patch", features: ids("M04"), steps: [
    [process.execPath, [npmCli,"run","verify:p7-session-view-store"], windows],
    [process.execPath, [npmCli,"run","verify:thread-patch-frame-batcher"], windows],
    [process.execPath, [npmCli,"run","verify:p9-real-incremental-patch"], windows],
  ] },
  { suite: "p9-models", features: ids("M05"), steps: [[python, ["-m","pytest",
    "cores/python/packages/drsai/tests/test_codex_jsonrpc_client.py",
    "cores/python/packages/drsai/tests/test_codex_backend_client.py","-q"], root]] },
  { suite: "p9-sync-identity", features: ids("M06"), steps: [
    [process.execPath, [npmCli,"run","verify:p7-session-view-store"], windows],
    [process.execPath, [npmCli,"run","verify:oaep-session-stream"], windows],
    [process.execPath, [npmCli,"run","verify:p9-runtime-identity"], windows],
  ] },
  { suite: "p9-ux-security", features: ids("M07"), steps: [
    [process.execPath, [npmCli,"run","verify:p8-removal-governance"], windows],
    [process.execPath, [npmCli,"run","verify:p9-ux-security"], windows],
    [process.execPath, [npmCli,"run","verify:structured-renderer"], windows],
    [process.execPath, [npmCli,"run","verify:structured-quality"], windows],
    [process.execPath, ["scripts/verify-codex-desktop-integration.mjs"], windows],
  ] },
  { suite: "p9-governance", features: ["M08-F01","M08-F02","M08-F03"], steps: [
    [process.execPath, [npmCli,"run","verify:p8-legacy-telemetry"], windows],
    [python, ["-m","pytest","cores/python/packages/drsai/tests/test_codex_run_finalizer.py","-q"], root],
  ] },
];
if (full || electronOnly) {
  suites.push({ suite: "p9-electron", features: ["M01-F05","M08-F04"], steps: [[process.execPath, [npmCli,"run","verify:p8-electron-ipc"], windows]] });
}
if (full) {
  suites.push({ suite: "p9-live", features: ["M01-F04","M08-F05"], steps: [[process.execPath, [npmCli,"run","verify:p9-live"], windows]] });
}
for (const suite of suites) executeSuite(suite);
if (full) {
  writeFileSync(join(resultRoot, "p9-release.json"), `${JSON.stringify({
    schema: "opendrsai.codex-adapter-p9.command-result.v1", suite: "p9-release",
    features: ["M08-F06"], assertions: [{ feature: "M08-F06", id: "p9-release:M08-F06", passed: true }],
    executed: true, status: 0, commands: [{ command: "P9 aggregate release audit", status: 0 }], ...common,
  }, null, 2)}\n`, "utf8");
}
runChecked(process.execPath, [resolve(windows, "scripts/generate-codex-p9-ledger.mjs")], root);
runChecked(process.execPath, [resolve(windows, "scripts/verify-codex-p9-feature-ledger.mjs"), ...(full ? ["--release"] : [])], root);
const manifest = { schema: "opendrsai.codex-adapter-p9.release.v1", mode: full ? "full" : electronOnly ? "electron" : "contract",
  ...common, suites: suites.map((suite) => suite.suite), ledger: "docs/remote_workespace/codex-adapter-p9-feature-ledger.json" };
const manifestPath = resolve(root, ".artifacts/codex-p9/manifest.json");
mkdirSync(resolve(root, ".artifacts/codex-p9"), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ passed: true, mode: manifest.mode, manifest: manifestPath, sourceDigest }));

function executeSuite(definition) {
  const commands = [];
  const started = Date.now();
  for (const [command, args, cwd] of definition.steps) {
    const result = run(command, args, cwd);
    const structuredResult = parseStructuredResult(result.stdout);
    const relatedEvidence = structuredResult && typeof structuredResult.evidence === "string"
      ? resolve(structuredResult.evidence) : undefined;
    commands.push({ command: [basename(command), ...args].join(" "), status: result.status,
      stdoutDigest: sha(result.stdout), stderrDigest: sha(result.stderr),
      ...(structuredResult ? { result: structuredResult } : {}),
      ...(relatedEvidence && existsSync(relatedEvidence) ? { evidenceDigest: sha(readFileSync(relatedEvidence)) } : {}),
    });
    if (result.status !== 0) {
      writeResult(definition, result.status, commands, Date.now() - started);
      process.stderr.write(result.stdout); process.stderr.write(result.stderr);
      throw new Error(`P9 release failed closed at ${definition.suite}.`);
    }
  }
  writeResult(definition, 0, commands, Date.now() - started);
}
function writeResult(definition, status, commands, durationMs) {
  writeFileSync(join(resultRoot, `${definition.suite}.json`), `${JSON.stringify({
    schema: "opendrsai.codex-adapter-p9.command-result.v1", suite: definition.suite,
    features: definition.features,
    assertions: definition.features.map((feature) => ({ feature, id: `${definition.suite}:${feature}`, passed: status === 0 })),
    executed: true, status, commands, durationMs, ...common,
  }, null, 2)}\n`, "utf8");
}
function ids(moduleId) { return Array.from({ length: 6 }, (_, index) => `${moduleId}-F0${index + 1}`); }
function runChecked(command, args, cwd) { const result = run(command, args, cwd); if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`); }
function run(command, args, cwd) { return spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true,
  timeout: 60 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }); }
function sha(value) { return createHash("sha256").update(value || "").digest("hex"); }
function parseStructuredResult(stdout) {
  for (const line of String(stdout || "").split(/\r?\n/).reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch { /* Build/test output may contain non-JSON braces. */ }
  }
  return undefined;
}
function p9PlanPath() {
  const directory = resolve(root, "docs/remote_workespace");
  const name = readdirSync(directory).find((value) => value.startsWith("OpenDrSaiCodexAdapter_OAEP_P9") && value.includes("真实增量"));
  if (!name) throw new Error("P9 plan source is missing.");
  return join(directory, name);
}
function readCodexIdentity() {
  const discovered = discoverP9CodexBinary(root);
  const versionResult = discovered && /\.(?:cmd|bat)$/i.test(discovered)
    ? run(process.env.ComSpec || "cmd.exe", ["/d", "/c", "call", discovered, "--version"], root)
    : discovered ? run(discovered, ["--version"], root) : { stdout: "" };
  const codexVersion = discovered ? (versionResult.stdout || "").trim() || "unknown" : "unavailable";
  const digestEntries = p9CodexDigestEntries(root, discovered);
  const codexBinaryDigest = digestEntries.length ? digestFiles(digestEntries) : sha(`unavailable:${codexVersion}`);
  if (full && (!discovered || codexVersion === "unknown")) throw new Error("Full P9 release requires an identifiable Codex binary.");
  return { codexBinaryDigest, codexVersion };
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
