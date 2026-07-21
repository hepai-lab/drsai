import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const sourcePptx = resolve(process.env.OPENDRSAI_CERN_PPTX || join(root, "release", "product-evidence", "cern-manager-deck", "cern-wlcg-manager-zh.pptx"));
const runId = process.env.OPENDRSAI_M10_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_M10_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf, sourcePptx]) if (!existsSync(path)) throw new Error(`M10 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
const sourcePresentation = readFileSync(sourcePptx);
assert(source.length === 7_664_262, `CERN PDF size changed: ${source.length}`);
assert(sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF SHA-256 changed.");
assert(sourcePresentation.length > 10_000 && sourcePresentation.subarray(0, 2).toString("ascii") === "PK", "CERN manager report is not a valid PPTX container fixture.");

const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-m10-"));
const appHome = join(testRoot, "中文 用户", "OpenDrSai 应用数据");
const workspace = join(testRoot, "中文 用户", "CERN 用户原始材料");
const userData = join(testRoot, "electron user data");
const fixturePath = join(workspace, "WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const reportPath = join(workspace, "用户生成的 CERN 汇报.pptx");
const reportBytes = readFileSync(sourcePptx);
const evidenceDir = join(root, "release", "product-evidence", "m10-data-cleanup", runId);
const resultPath = join(evidenceDir, "packaged-m10-data-cleanup-result.json");
for (const path of [appHome, workspace, userData, evidenceDir, join(appHome, "cache"), join(appHome, "logs")]) mkdirSync(path, { recursive: true });
copyFileSync(sourcePdf, fixturePath);
copyFileSync(sourcePptx, reportPath);
writeFileSync(join(appHome, "cache", "m10-cache-marker.bin"), "app-owned cache");
writeFileSync(join(appHome, "logs", "m10.log"), "app-owned log");

try {
  await runPackagedApp();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `M10 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const checks = Object.entries(result.checks || {});
  assert(checks.length >= 17 && checks.every(([, passed]) => passed === true), `M10 expected at least 17 passing checks, got ${checks.filter(([, passed]) => passed).length}/${checks.length}.`);
  assert(existsSync(fixturePath) && sha256(readFileSync(fixturePath)) === sourceHash, "CERN PDF changed during application-data cleanup.");
  assert(existsSync(reportPath) && sha256(readFileSync(reportPath)) === sha256(reportBytes), "User report changed during application-data cleanup.");
  assert(!existsSync(join(appHome, "cache", "m10-cache-marker.bin")), "App-owned cache survived full cleanup.");
  assert(!existsSync(join(appHome, "logs", "m10.log")), "App-owned logs survived full cleanup.");
  assert(!existsSync(join(appHome, "desktop", "workspaces.json")), "Workspace registration survived full cleanup.");
  assert(!existsSync(join(appHome, "desktop", "project-memory.json")), "Project memory survived full cleanup.");
  assert(!existsSync(join(appHome, "desktop", "background-tasks.json")), "Background task data survived full cleanup.");

  const uninstall = verifyNormalUninstallPreservesUserData();
  const integrity = {
    runId,
    checks: checks.length,
    sourcePdf: { path: fixturePath, sizeBytes: source.length, sha256: sourceHash },
    userReport: { path: reportPath, sizeBytes: reportBytes.length, sha256: sha256(reportBytes) },
    normalUninstall: uninstall,
  };
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify(integrity, null, 2)}\n`);
  console.log(`M10 data cleanup passed (${checks.length}/${checks.length}); CERN PDF and user report survived cleanup and normal uninstall.`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function runPackagedApp() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_E2E_M10_DATA_CLEANUP: "1", OPENDRSAI_E2E_M10_CERN_PDF: fixturePath, OPENDRSAI_E2E_M10_USER_REPORT: reportPath, OPENDRSAI_E2E_M10_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "90000" },
      stdio: "ignore",
      windowsHide: true,
    });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("M10 packaged acceptance timed out.")); } }, 105_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun() : reject(new Error(`M10 app exited ${code}.${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON was written."}`)); });
  });
}

function verifyNormalUninstallPreservesUserData() {
  const uninstallScript = join(repo, "apps", "desktop", "windows", "installer", "uninstall-opendrsai.ps1");
  const uninstallVbs = join(repo, "apps", "desktop", "windows", "installer", "run-opendrsai-uninstall.vbs");
  const scriptSource = readFileSync(uninstallScript, "utf8");
  const vbsSource = readFileSync(uninstallVbs, "utf8");
  assert(scriptSource.includes("[switch]$RemoveUserData") && scriptSource.includes("if ($RemoveUserData)"), "Uninstall script does not gate user-data removal behind an explicit switch.");
  assert(!vbsSource.includes("-RemoveUserData"), "Normal MSI uninstall unexpectedly opts into user-data deletion.");

  const installRoot = join(testRoot, "fake installed runtime");
  const uninstallHome = join(testRoot, "normal uninstall app data");
  const programData = join(testRoot, "program data");
  mkdirSync(join(installRoot, "app"), { recursive: true });
  mkdirSync(uninstallHome, { recursive: true });
  mkdirSync(programData, { recursive: true });
  writeFileSync(join(installRoot, "app", "runtime.bin"), "runtime");
  writeFileSync(join(uninstallHome, "user-data-marker.json"), "preserve me");
  const execution = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", uninstallScript, "-InstallRoot", installRoot, "-DrsaiHome", uninstallHome], { env: { ...process.env, ProgramData: programData }, encoding: "utf8", windowsHide: true });
  assert(execution.status === 0, `Isolated normal uninstall failed: ${execution.stderr || execution.stdout}`);
  assert(!existsSync(join(installRoot, "app")), "Normal uninstall did not remove the installed runtime.");
  assert(existsSync(join(uninstallHome, "user-data-marker.json")), "Normal uninstall deleted application data without explicit opt-in.");
  assert(existsSync(fixturePath) && sha256(readFileSync(fixturePath)) === sourceHash, "Normal uninstall changed the CERN PDF workspace fixture.");
  assert(existsSync(reportPath) && sha256(readFileSync(reportPath)) === sha256(reportBytes), "Normal uninstall changed the user report.");
  return { removeUserDataRequiresExplicitSwitch: true, normalMsiPassesRemoveUserData: false, isolatedExecutionPassed: true, cernPdfPreserved: true, userReportPreserved: true };
}

function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
