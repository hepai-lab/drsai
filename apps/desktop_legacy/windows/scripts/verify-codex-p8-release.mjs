import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { hostname } from "node:os";

const root = resolve(import.meta.dirname, "../../../..");
const windows = resolve(root, "apps/desktop/windows");
const python = resolve(root, ".venv/Scripts/python.exe");
const npmCli = process.env.npm_execpath;
const full = process.argv.includes("--full");
if (!existsSync(python) || !npmCli || !existsSync(npmCli)) throw new Error("P8 release must run through npm with the repository .venv.");
const resultRoot = resolve(root, ".artifacts/codex-p8/results");
mkdirSync(resultRoot, { recursive: true });
const codexTests = readdirSync(resolve(root, "cores/python/packages/drsai/tests"))
  .filter((name) => name.startsWith("test_codex_") && name.endsWith(".py"))
  .map((name) => `cores/python/packages/drsai/tests/${name}`);
const suites = [
  ["p8-contract", python, ["-m", "pytest", "cores/python/packages/drsai/tests/test_codex_stable_contract.py", "-q"], root],
  ["p8-python", python, ["-m", "pytest", ...codexTests, "cores/python/packages/drsai/tests/test_oaep_delta_parity.py", "-q"], root],
  ["p8-models", python, ["-m", "pytest", "cores/python/packages/drsai/tests/test_codex_jsonrpc_client.py", "-q"], root],
  ["p8-patch", process.execPath, [npmCli, "run", "verify:p8-transactional-patch"], windows],
  ["p8-stream", process.execPath, [npmCli, "run", "verify:oaep-session-stream"], windows],
  ["p8-governance", process.execPath, [npmCli, "run", "verify:p8-removal-governance"], windows],
  ["p8-electron", process.execPath, [npmCli, "run", "verify:p8-electron-ipc"], windows],
  ["p8-evidence", process.execPath, [npmCli, "run", "typecheck"], windows],
];
if (full) suites.push(["p8-live", process.execPath, [npmCli, "run", "verify:p8-live"], windows]);
const results = [];
for (const [suite, command, args, cwd] of suites) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, timeout: 25 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const artifact = { schema: "opendrsai.codex-adapter-p8.command-result.v1", suite, executed: true,
    command: [basename(command), ...args].join(" "), observedAt: new Date().toISOString(),
    durationMs: Date.now() - started, status: result.status,
    stdoutDigest: sha(Buffer.from(result.stdout || "")), stderrDigest: sha(Buffer.from(result.stderr || "")) };
  writeFileSync(resolve(resultRoot, `${suite}.json`), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  results.push(artifact);
  if (result.status !== 0) {
    process.stderr.write(result.stdout || ""); process.stderr.write(result.stderr || "");
    throw new Error(`P8 release failed closed at ${suite}.`);
  }
}
if (full) {
  const livePath = resolve(root, ".artifacts/codex-p8-live-current/evidence.json");
  const live = JSON.parse(readFileSync(livePath, "utf8"));
  if (live.passed !== true || Date.now() - Date.parse(live.observedAt) > 24 * 60 * 60 * 1_000 || live.host !== hostname()) {
    throw new Error("P8 live evidence is missing, stale, failed, or belongs to another host.");
  }
}
const sourceFiles = [
  ...filesUnder(resolve(root, "cores/python/packages/drsai/src/drsai/backend/codex_adapter")),
  ...filesUnder(resolve(root, "cores/protocol/codex-app-server")),
  resolve(root, "cores/protocol/codex-app-server-stable-contract.json"),
  resolve(root, "cores/protocol/oaep/oaep.schema.json"),
  resolve(root, "apps/desktop/shared/main/oaepSessionStream.ts"),
  resolve(root, "apps/desktop/shared/main/runtimeClient.ts"),
  resolve(root, "apps/desktop/shared/main/sessionViewStore.ts"),
  resolve(root, "apps/desktop/shared/renderer/src/threadSnapshotPatch.ts"),
  resolve(root, "apps/desktop/shared/renderer/src/App.tsx"),
  resolve(root, "apps/desktop/windows/package.json"),
  resolve(root, "package-lock.json"),
].filter(existsSync).sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
const sourceDigest = digestFiles(sourceFiles);
const diff = git(["diff", "--binary", "--no-ext-diff", "--", "cores/protocol", "cores/python/packages/drsai", "apps/desktop/shared", "apps/desktop/windows/scripts", "docs/remote_workespace"]);
const untracked = git(["ls-files", "--others", "--exclude-standard", "--", "cores/protocol", "cores/python/packages/drsai", "apps/desktop/shared", "apps/desktop/windows/scripts", "docs/remote_workespace"])
  .split(/\r?\n/).filter(Boolean).map((path) => resolve(root, path)).filter(existsSync).sort();
const dirtyDigest = sha(Buffer.concat([Buffer.from(diff), Buffer.from("\0"), Buffer.from(digestFiles(untracked))]));
const buildFiles = [resolve(windows, "out/main/index.js"), resolve(windows, "out/preload/index.js"), resolve(windows, "out/renderer/index.html")];
if (!buildFiles.every(existsSync)) throw new Error("P8 release requires current Main/Preload/Renderer build output.");
const codexPackage = JSON.parse(readFileSync(resolve(windows, "node_modules/@openai/codex/package.json"), "utf8"));
const codexBinary = filesUnder(resolve(windows, `node_modules/@openai/codex-${process.platform}-${process.arch}`))
  .find((path) => /(?:codex|codex-cli)(?:\.exe)?$/i.test(basename(path)));
if (!codexBinary) throw new Error("P8 could not identify the installed Codex binary.");
const report = { schema: "opendrsai.codex-adapter-p8.release.v1", passed: true, mode: full ? "full" : "contract",
  observedAt: new Date().toISOString(), host: hostname(), platform: { os: process.platform, arch: process.arch, node: process.version },
  commit: git(["rev-parse", "HEAD"]).trim(), sourceDigest, dirtyDigest,
  buildDigest: digestFiles(buildFiles), codex: { version: codexPackage.version, binaryDigest: sha(readFileSync(codexBinary)) },
  schemaDigest: sha(readFileSync(resolve(root, "cores/protocol/oaep/oaep.schema.json"))), results };
const reportPath = resolve(root, ".artifacts/codex-p8-release-evidence.json");
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (full) {
  const ledger = spawnSync(process.execPath, ["scripts/verify-codex-p8-feature-ledger.mjs"], { cwd: windows, encoding: "utf8", windowsHide: true });
  if (ledger.status !== 0) throw new Error(`P8 feature evidence verification failed.\n${ledger.stdout}\n${ledger.stderr}`);
}
console.log(JSON.stringify({ passed: true, mode: report.mode, evidence: reportPath, sourceDigest, dirtyDigest }));

function filesUnder(path) { if (!existsSync(path)) return []; if (statSync(path).isFile()) return [path]; return readdirSync(path).flatMap((name) => filesUnder(join(path, name))); }
function digestFiles(paths) { const hash = createHash("sha256"); for (const path of paths) hash.update(relative(root, path).replaceAll("\\", "/")).update("\0").update(readFileSync(path)).update("\0"); return hash.digest("hex"); }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function git(args) { const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 128 * 1024 * 1024 }); if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "git failed"); return result.stdout; }
