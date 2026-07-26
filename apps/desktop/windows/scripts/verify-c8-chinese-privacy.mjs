import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repo = resolve(root, "../../..");
const executable = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const sourcePdf = resolve(process.env.OPENDRSAI_CERN_PDF || "C:/tmp/WLCG-20260715-WLCG-talk-IHEP-visit.pdf");
const python = process.env.OPENDRSAI_PDF_PYTHON || "C:/Users/win11/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
const extractor = join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "content", "pdf", "presentation.py");
const runId = process.env.OPENDRSAI_C8_RUN_ID?.trim() || "latest";
if (!/^[a-z0-9-]+$/i.test(runId)) throw new Error("OPENDRSAI_C8_RUN_ID must be alphanumeric with optional hyphens.");
for (const path of [executable, sourcePdf, python, extractor]) if (!existsSync(path)) throw new Error(`C8 dependency is missing: ${path}`);
const source = readFileSync(sourcePdf);
const sourceHash = sha256(source);
assert(source.length === 7_664_262 && sourceHash === "F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E", "CERN PDF fixture changed.");

const sensitiveValues = ["13812345678", "privacy.user+c8@example.test", "sk-C8PrivacyKey1234567890", "C8PersonalSecret987654"];
const testRoot = mkdtempSync(join(tmpdir(), "opendrsai-c8-"));
const workspace = join(testRoot, "中文 资料", "隐私 测试");
const evidenceDir = join(root, "release", "product-evidence", "c8-chinese-privacy", runId);
const resultPath = join(evidenceDir, "packaged-c8-chinese-privacy-result.json");
const appHome = join(testRoot, "应用 数据");
const userData = join(testRoot, "用户 数据");
for (const path of [workspace, evidenceDir, appHome, userData]) mkdirSync(path, { recursive: true });
const fixturePaths = [join(workspace, "联系人与密钥 样例.md"), join(workspace, "扫描 图片.png"), join(workspace, "WLCG 中文演示.pdf")];
writeFileSync(fixturePaths[0], `# D7 隐私材料\n\n手机号: ${sensitiveValues[0]}\n邮箱: ${sensitiveValues[1]}\nAPI Key: ${sensitiveValues[2]}\nuser_secret=${sensitiveValues[3]}\n`, "utf8");
writeFileSync(fixturePaths[1], Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zy8sAAAAASUVORK5CYII=", "base64"));
copyFileSync(sourcePdf, fixturePaths[2]);

try {
  const processOutput = await runPackagedApp();
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  assert(result.ok === true, `C8 packaged acceptance failed:\n${JSON.stringify(result, null, 2)}`);
  const appChecks = Object.entries(result.checks || {});
  assert(appChecks.length >= 19 && appChecks.every(([, passed]) => passed === true), "C8 has failing packaged checks.");
  const combinedLogs = `${processOutput.stdout}\n${processOutput.stderr}`;
  const logsSecretFree = sensitiveValues.every((secret) => !combinedLogs.includes(secret));
  const applicationDataSecretFree = scanDirectoryForSecrets(appHome, sensitiveValues).length === 0;
  assert(logsSecretFree, "C8 raw sensitive value leaked to packaged stdout/stderr.");
  assert(applicationDataSecretFree, "C8 raw sensitive value leaked into application-owned data.");
  assert(sha256(readFileSync(fixturePaths[2])) === sourceHash, "CERN PDF changed during C8 analysis.");
  const summary = { ok: true, runId, appChecks: appChecks.length, externalChecks: 2, totalChecks: appChecks.length + 2, logsSecretFree, applicationDataSecretFree, chineseWorkspacePath: workspace, sensitiveKinds: ["phone", "email", "api_key", "user_secret"], cernPdf: { sizeBytes: source.length, sha256: sourceHash }, screenshotPath: result.details.screenshotPath };
  writeFileSync(join(evidenceDir, "packaged-c8-chinese-privacy-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(evidenceDir, "evidence-integrity.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`C8 Chinese-path privacy passed ${summary.totalChecks}/${summary.totalChecks} checks; four sensitive values absent from UI, logs, notifications, shares, and app-owned data.`);
} finally {
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}

function runPackagedApp() {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const child = spawn(executable, [`--user-data-dir=${userData}`], {
      cwd: root,
      env: { ...process.env, DRSAI_HOME: appHome, DRSAI_REPO: workspace, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_DEV_AUTH_BYPASS: "1", OPENDRSAI_PDF_PYTHON: python, OPENDRSAI_PDF_SCRIPT: extractor, OPENDRSAI_E2E_C8_CHINESE_PRIVACY: "1", OPENDRSAI_E2E_C8_IMPORT_PATHS: fixturePaths.join("|"), OPENDRSAI_E2E_C8_SENSITIVE_VALUES: JSON.stringify(sensitiveValues), OPENDRSAI_E2E_C8_EVIDENCE_DIR: evidenceDir, OPENDRSAI_E2E_RESULT: resultPath, OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1", OPENDRSAI_E2E_DISABLE_GPU: "1", OPENDRSAI_E2E_TIMEOUT_MS: "120000" },
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const timer = setTimeout(() => { if (!settled) { settled = true; killTree(child.pid); reject(new Error("C8 timed out.")); } }, 135_000);
    child.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); code === 0 ? resolveRun({ stdout, stderr }) : reject(new Error(`C8 exited ${code}.\n${stdout}\n${stderr}${existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : " No result JSON."}`)); });
  });
}

function scanDirectoryForSecrets(directory, secrets) {
  const leaks = [];
  if (!existsSync(directory)) return leaks;
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const info = statSync(path);
    if (info.isDirectory()) leaks.push(...scanDirectoryForSecrets(path, secrets));
    else if (info.isFile() && info.size <= 5 * 1024 * 1024) {
      const bytes = readFileSync(path);
      for (const secret of secrets) if (bytes.includes(Buffer.from(secret))) leaks.push({ path, secret });
    }
  }
  return leaks;
}

function sha256(value) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
function killTree(pid) { if (pid) spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
