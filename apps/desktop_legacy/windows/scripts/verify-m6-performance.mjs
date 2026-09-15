import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const evidenceDir = join(root, "release", "product-evidence", "m6-performance");
const fixtureRoot = join(root, "release", "product-fixtures", "m6-100k-workspace");
const fixtureMarker = join(fixtureRoot, ".m6-fixture.json");
const requestedRunId = process.env.OPENDRSAI_M6_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(requestedRunId)) throw new Error("OPENDRSAI_M6_RUN_ID must be alphanumeric with optional hyphens.");
if (!existsSync(executable)) throw new Error("Build release/win-unpacked before running M6 acceptance.");
if (!existsSync(sourcePdf)) throw new Error(`Fixed CERN PDF fixture is missing: ${sourcePdf}`);
const source = readFileSync(sourcePdf);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(createHash("sha256").update(source).digest("hex").toUpperCase() === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");

prepareFixture();
const cernPdf = join(fixtureRoot, "bucket-000", "000-WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const largeFile = join(fixtureRoot, "bucket-000", "001-large-preview.txt");
const importPaths = [cernPdf, ...Array.from({ length: 29 }, (_, index) => join(fixtureRoot, "imports", `import-${String(index + 1).padStart(2, "0")}.txt`))];
const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-m6-performance-"));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 数据");
const userData = join(testRoot, "electron user data");
const runEvidenceDir = join(evidenceDir, requestedRunId);
const resultPath = join(runEvidenceDir, "packaged-m6-performance-result.json");
for (const path of [appHome, userData, runEvidenceDir]) mkdirSync(path, { recursive: true });
rmSync(resultPath, { force: true });

try {
  await run();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `M6 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 20 && checks.every(([, passed]) => passed === true), `M6 expected at least 20 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  writeFileSync(join(runEvidenceDir, "fixture-manifest.json"), readFileSync(fixtureMarker));
  console.log(`M6 packaged performance acceptance passed (${checks.length}/${checks.length} checks; max renderer gap ${Number(result.details?.heartbeat?.maxGapMs).toFixed(1)} ms).`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

function prepareFixture() {
  if (existsSync(fixtureMarker)) {
    const marker = JSON.parse(readFileSync(fixtureMarker, "utf8"));
    const last = join(fixtureRoot, "bucket-099", "file-0999.txt");
    if (marker.generatedFileCount === 100_000 && existsSync(last) && existsSync(join(fixtureRoot, "bucket-000", "001-large-preview.txt"))) return;
  }
  rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  mkdirSync(fixtureRoot, { recursive: true });
  for (let bucket = 0; bucket < 100; bucket += 1) {
    const bucketName = `bucket-${String(bucket).padStart(3, "0")}`;
    const bucketPath = join(fixtureRoot, bucketName);
    mkdirSync(bucketPath);
    const seed = join(bucketPath, ".seed");
    closeSync(openSync(seed, "w"));
    for (let file = 0; file < 1000; file += 1) linkSync(seed, join(bucketPath, `file-${String(file).padStart(4, "0")}.txt`));
  }
  const bucket0 = join(fixtureRoot, "bucket-000");
  copyFileSync(sourcePdf, join(bucket0, "000-WLCG-20260715-WLCG-talk-IHEP-visit.pdf"));
  const largeFile = join(bucket0, "001-large-preview.txt");
  closeSync(openSync(largeFile, "w"));
  truncateSync(largeFile, 64 * 1024 * 1024);
  const imports = join(fixtureRoot, "imports");
  mkdirSync(imports);
  for (let index = 1; index <= 29; index += 1) writeFileSync(join(imports, `import-${String(index).padStart(2, "0")}.txt`), `M6 import fixture ${index}\n`, "utf8");
  writeFileSync(fixtureMarker, `${JSON.stringify({ generatedAt: new Date().toISOString(), generatedFileCount: 100_000, bucketCount: 100, filesPerBucket: 1000, largeFileBytes: statSync(largeFile).size, fixedCernPdf: { filename: "WLCG-20260715-WLCG-talk-IHEP-visit.pdf", sizeBytes: source.length, sha256: "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E" } }, null, 2)}\n`);
}

function run() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], { cwd: root, env: { ...process.env, DRSAI_HOME: appHome, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_M6_PERFORMANCE: "1", OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_M6_WORKSPACE: fixtureRoot, OPENDRSAI_E2E_M6_LARGE_FILE: largeFile, OPENDRSAI_E2E_M6_CERN_PDF: cernPdf, OPENDRSAI_E2E_M6_IMPORT_PATHS: importPaths.join("|"), OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_TIMEOUT_MS: "120000" }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("M6 packaged acceptance timed out.")); } }, 135_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`M6 packaged app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
