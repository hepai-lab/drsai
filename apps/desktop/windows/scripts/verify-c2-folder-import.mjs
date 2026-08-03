import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const runId = process.env.OPENDRSAI_C2_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_C2_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf]) if (!existsSync(path)) throw new Error(`C2 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf); const sourceHash = sha256(source);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-c2-"));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 应用数据");
const folderPath = join(testRoot, "中文 用户", "C2 CERN 30 文件材料包");
const userData = join(testRoot, "electron user data");
const evidenceDir = join(root, "release", "product-evidence", "c2-folder-import", runId);
const resultPath = join(evidenceDir, "packaged-c2-folder-import-result.json");
const subA = join(folderPath, "第一组材料"); const subB = join(folderPath, "第二组材料");
for (const path of [appHome, folderPath, subA, subB, join(folderPath, "node_modules"), userData, evidenceDir]) mkdirSync(path, { recursive: true });
const cernPdfPath = join(folderPath, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf"); copyFileSync(sourcePdf, cernPdfPath);
for (let index = 1; index <= 10; index += 1) writeFileSync(join(subA, `说明-${String(index).padStart(2, "0")}.txt`), `CERN text material ${index}\n`, "utf8");
for (let index = 1; index <= 10; index += 1) writeFileSync(join(subB, `数据-${String(index).padStart(2, "0")}.json`), `${JSON.stringify({ source: "CERN", index, value: index * 9.6 })}\n`, "utf8");
writeFileSync(join(folderPath, "容量.csv"), "year,tbps\n2027,4.8\n2029,9.6\n", "utf8");
writeFileSync(join(folderPath, "路线.csv"), "stage,target\nDC27,50%\nDC29,100%\n", "utf8");
writeFileSync(join(folderPath, "摘要.md"), "# WLCG 摘要\n\nHL-LHC 数据量增长十倍。\n", "utf8");
writeFileSync(join(folderPath, "来源.md"), "# 来源\n\nCERN Indico 固定 PDF。\n", "utf8");
writeFileSync(join(folderPath, "架构.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
writeFileSync(join(folderPath, "拓扑.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>', "utf8");
writeFileSync(join(folderPath, "不支持-1.xyz"), "unsupported one", "utf8");
writeFileSync(join(folderPath, "不支持-2.xyz"), "unsupported two", "utf8");
writeFileSync(join(folderPath, "损坏文件.pdf"), "this is not a PDF", "utf8");

try {
  await runPackagedApp();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `C2 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 22 && checks.every(([, passed]) => passed === true), `C2 expected at least 22 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  assert(existsSync(cernPdfPath) && sha256(readFileSync(cernPdfPath)) === sourceHash, "CERN PDF changed during folder scan.");
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify({ runId, checks: checks.length, cernPdf: { sizeBytes: source.length, sha256: sourceHash }, physicalFileCount: 30, expected: { imported: 27, skippedFiles: 2, skippedDirectories: 1, failed: 1, nestedDirectories: 2, duplicates: 1 } }, null, 2)}\n`);
  console.log(`C2 folder import passed (${checks.length}/${checks.length}); 30 files counted with progress, skip, failure, and duplicate isolation.`);
} finally { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); }

function runPackagedApp() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], { cwd: root, env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: folderPath, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_C2_FOLDER_IMPORT: "1", OPENDRSAI_E2E_C2_FOLDER_PATH: folderPath, OPENDRSAI_E2E_C2_CERN_PDF: cernPdfPath, OPENDRSAI_E2E_C2_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "90000", OPENDRSAI_PDF_PYTHON: resolve(process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"), OPENDRSAI_PDF_SCRIPT: resolve(root, "../../../cores/python/packages/drsai/src/drsai/content/pdf/presentation.py") }, stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("C2 packaged acceptance timed out.")); } }, 105_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`C2 app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}
function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
