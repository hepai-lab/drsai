import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const desktopRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(desktopRoot, "../../..");
const pythonSource = join(repoRoot, "cores", "python", "packages", "drsai", "src");
const fixtureScript = join(desktopRoot, "scripts", "fixtures", "run_editable_phase2_fixture.py");
const python = resolvePython();
const electronCli = require.resolve("electron/cli.js");
const inspectionSafety = process.argv.includes("--inspection-safety");
const phase3 = process.argv.includes("--phase3") || inspectionSafety;
const temporaryRoot = mkdtempSync(join(tmpdir(), inspectionSafety ? "opendrsai-run-inspection-safety-" : phase3 ? "opendrsai-run-traceability-p3-" : "opendrsai-run-editable-p2-"));
const home = join(temporaryRoot, "home");
const workspace = join(temporaryRoot, "workspace");
const fixture = join(temporaryRoot, "fixture.json");
const desktopResult = join(temporaryRoot, "desktop-result.json");
const exportDir = join(temporaryRoot, "exports");
const screenshotPath = join(repoRoot, "docs", "desktop", "evidence", inspectionSafety ? "run-inspection-safety-windows-e2e.png" : "agent-runtime-traceability-phase3-windows-e2e.png");
const evidencePath = join(repoRoot, "docs", "desktop", "evidence", inspectionSafety ? "run-inspection-safety-windows-e2e-result.json" : phase3 ? "agent-runtime-traceability-phase3-windows-e2e-result.json" : "agent-runtime-editable-phase2-windows-e2e-result.json");
const regressionEvidencePath = join(repoRoot, "docs", "desktop", "evidence", "agent-runtime-traceability-phase3-regression-results.jsonl");
const userData = join(temporaryRoot, "user-data");
const port = 25000 + (process.pid % 12000);
const token = randomBytes(32).toString("base64url");
const oidcSigningSecret = randomBytes(32).toString("base64url");
const principal = "22222222-2222-4222-8222-222222222222";
const accessToken = fakeOidcToken(principal, oidcSigningSecret);
const separator = process.platform === "win32" ? ";" : ":";
const env = {
  ...process.env, DRSAI_HOME: home, OPENDRSAI_DEV_HOME: home, DRSAI_REPO: workspace,
  DRSAI_API_HOST: "127.0.0.1", DRSAI_API_PORT: String(port),
  OPENDRSAI_GATEWAY_PORT: String(port), OPENDRSAI_DEV_GATEWAY_PORT: String(port),
  OPENDRSAI_GATEWAY_INSTANCE_TOKEN: token, OPENDRSAI_OIDC_HS256_SECRET: oidcSigningSecret,
  OPENDRSAI_E2E_OIDC_HS256_SECRET: oidcSigningSecret, OPENDRSAI_ENFORCE_WORKSPACE_PERMISSIONS: "1",
  OPENDRSAI_E2E_AUTH_USER_ID: principal,
  // The synthetic, locally signed principal is valid only for this isolated
  // Gateway.  Prevent the authenticated shell from offering it to the live
  // platform catalog, whose expected 401 would otherwise invalidate the
  // Desktop session while the runtime acceptance flow is still running.
  OPENDRSAI_PLATFORM_AGENTS_ENABLED: "0",
  DRSAI_RUNTIME_CONTROLLED_MODEL: "1", DRSAI_RUNTIME_PHASE2_ACCEPTANCE: "1",
  ...(phase3 ? { DRSAI_RUNTIME_PHASE3_ACCEPTANCE: "1", OPENDRSAI_ENABLE_REGRESSION_CONTROL: "1" } : {}),
  PYTHONPATH: [pythonSource, process.env.PYTHONPATH].filter(Boolean).join(separator),
};
const startedAt = new Date().toISOString();

let gateway;
let completed = false;
try {
  run(python, [fixtureScript, "--home", home, "--workspace", workspace, "--output", fixture], repoRoot, env);
  gateway = spawn(python, ["-m", "drsai.backend.gateway"], { cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const gatewayLogs = collect(gateway);
  await waitForGateway(gateway, gatewayLogs);
  await waitForStableDesktopBuild();
  const app = spawn(process.execPath, [electronCli, desktopRoot, `--user-data-dir=${userData}`], {
    cwd: desktopRoot,
    env: {
      ...env, DRSAI_GATEWAY_DEV_MANAGED: "1", OPENDRSAI_GATEWAY_STARTUP: "external",
      OPENDRSAI_GATEWAY_PROBE_TIMEOUT_MS: "15000",
      ...(phase3 ? {
        OPENDRSAI_E2E_RUN_TRACEABILITY_PHASE3: "1",
        OPENDRSAI_E2E_RUN_TRACEABILITY_PHASE3_FIXTURE: fixture,
        OPENDRSAI_E2E_SCREENSHOT: screenshotPath,
        ...(inspectionSafety ? { OPENDRSAI_E2E_RUN_INSPECTION_SAFETY_ONLY: "1" } : {}),
      } : {
        OPENDRSAI_E2E_RUN_EDITABLE_PHASE2: "1",
        OPENDRSAI_E2E_RUN_EDITABLE_PHASE2_FIXTURE: fixture,
      }),
      OPENDRSAI_E2E_RESULT: desktopResult,
      OPENDRSAI_E2E_EXPORT_DIR: exportDir,
      OPENDRSAI_E2E_TIMEOUT_MS: phase3 ? "300000" : "180000", OPENDRSAI_E2E_DISABLE_GPU: "1",
      OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  const appLogs = collect(app);
  const code = await waitForExit(app, phase3 ? 320_000 : 200_000);
  if (code !== 0 || !existsSync(desktopResult)) {
    throw new Error(`Phase ${phase3 ? "3" : "2"} Desktop E2E failed (${code}).\n${existsSync(desktopResult) ? readFileSync(desktopResult, "utf8") : "<no result>"}\nGateway:\n${gatewayLogs.tail()}\nDesktop:\n${appLogs.tail()}`);
  }
  const result = JSON.parse(readFileSync(desktopResult, "utf8"));
  if (result.ok !== true || !Object.values(result.checks || {}).every(Boolean)) throw new Error(JSON.stringify(result));
  let regression = null;
  if (phase3 && !inspectionSafety) {
    const regressionOutput = join(temporaryRoot, "regression");
    const executionId = `phase3-windows-e2e-${process.pid}`;
    run(python, [
      join(repoRoot, "eval", "regression", "run_regression.py"), "run",
      "--suite", "phase3-release-smoke", "--adapter", "gateway",
      "--gateway-url", `http://127.0.0.1:${port}`,
      "--gateway-token", token, "--access-token", accessToken, "--user-id", principal,
      "--output", regressionOutput, "--execution-id", executionId,
    ], repoRoot, env);
    const regressionResults = join(regressionOutput, executionId, "results.jsonl");
    run(python, [
      join(repoRoot, "eval", "regression", "run_regression.py"), "gate",
      "--results", regressionResults,
      "--policy", join(repoRoot, "eval", "regression", "policies", "phase3-release-gate.yaml"),
    ], repoRoot, env);
    const regressionBytes = readFileSync(regressionResults);
    writeFileSync(regressionEvidencePath, regressionBytes);
    const regressionItems = regressionBytes.toString("utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    regression = {
      suite: "phase3-release-smoke", gate: "passed", case_count: regressionItems.length,
      cases: Object.fromEntries(regressionItems.map((item) => [item.case_id, item.status])),
      results_digest: sha256(regressionBytes),
    };
  }
  await stopProcess(gateway); gateway = undefined;
  if (!inspectionSafety) run(python, [fixtureScript, "--verify", "--home", home, "--output", fixture, "--desktop-result", desktopResult], repoRoot, env);
  const sourceFiles = [
    "apps/desktop/windows/package.json",
    "apps/desktop/windows/electron.vite.config.ts",
    "apps/desktop/windows/scripts/verify-run-editable-phase2-windows-e2e.mjs",
    "apps/desktop/windows/scripts/fixtures/run_editable_phase2_fixture.py",
    "apps/desktop/windows/src/main/e2eSmoke.ts",
    "apps/desktop/windows/src/main/index.ts",
    "apps/desktop/shared/api/runExperiment.ts",
    "apps/desktop/shared/main/runtimeClient.ts",
    "apps/desktop/shared/renderer/src/components/RunExperimentPanel.tsx",
    "apps/desktop/shared/renderer/src/components/RunInspectorPanel.tsx",
    "apps/desktop/shared/renderer/src/components/SessionRunHistory.tsx",
    "apps/desktop/shared/renderer/src/components/RunComparisonView.tsx",
    "cores/python/packages/drsai/src/drsai/backend/gateway.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/replay_execution.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/replay_planner.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/agent.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/engine.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/adoptions.py",
    "cores/python/packages/drsai/src/drsai/backend/workspace/git_worktree_service.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/experiment_export.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/oaep.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/security.py",
    "eval/regression/suites/phase3-release-smoke.yaml",
    "eval/regression/policies/phase3-release-gate.yaml",
    "eval/regression/src/opendrsai_regression/evidence.py",
    "eval/regression/src/opendrsai_regression/assertions.py",
    "eval/regression/cases/question_answering/p3_hello.yaml",
    "eval/regression/cases/tool_use/p3_web.yaml",
    "eval/regression/cases/knowledge/p3_runtime.yaml",
    "eval/regression/cases/skill_use/p3_presentation.yaml",
    "eval/regression/cases/image_input/p3_screenshot.yaml",
    "eval/regression/cases/image_output/p3_image.yaml",
  ];
  const buildFiles = [
    "apps/desktop/windows/out/main/index.js",
    "apps/desktop/windows/out/preload/index.js",
    "apps/desktop/windows/out/renderer/index.html",
  ];
  writeFileSync(evidencePath, `${JSON.stringify({
    schema_version: inspectionSafety ? "opendrsai.run-inspection-safety-windows-e2e-result/1" : phase3 ? "opendrsai.run-traceability-phase3-windows-e2e-result/1" : "opendrsai.run-editable-phase2-windows-e2e-result/1",
    generated_at: new Date().toISOString(), started_at: startedAt,
    command: inspectionSafety ? "npm run verify:run-inspection-safety-windows-e2e" : phase3 ? "npm run verify:run-traceability-phase3-windows-e2e" : "npm run verify:run-editable-phase2-windows-e2e", exit_code: 0,
    commit: currentCommit(), source_files: sourceFiles, source_digest: digestFiles(sourceFiles), application_build_digest: digestFiles(buildFiles),
    desktop_result_digest: sha256(readFileSync(desktopResult)), platform: process.platform, architecture: process.arch,
    scenarios: inspectionSafety ? ["run_inspection_secret_corpus"] : phase3 ? ["O", "P", "Q", "R", "S", "T", "U"] : ["G", "H", "I", "J", "K", "L", "M", "N"], checks: result.checks, details: result.details,
    regression,
    screenshot_digest: phase3 && existsSync(screenshotPath) ? sha256(readFileSync(screenshotPath)) : null,
    real_gateway: true, real_electron: true, offline_database_verification: !inspectionSafety,
    controlled_model: true, model_execution: "deterministic_runtime_acceptance",
    proof_scope: inspectionSafety ? ["gateway", "electron", "desktop_ipc", "oaep", "manifest", "renderer"] : ["gateway", "electron", "desktop_ipc", "oaep", "database", "git_worktree", "approval", "renderer"],
    not_proven: phase3 ? ["real_backend_account"] : ["real_backend_account"],
  }, null, 2)}\n`, "utf8");
  console.log(inspectionSafety ? "Real Windows Runtime/Desktop Run Inspection safety E2E passed.\n" : phase3 ? "Real Windows Runtime/Desktop Phase 3 E2E passed (O-U).\n" : "Real Windows Runtime/Desktop Phase 2 E2E passed (G-N).\n");
  completed = true;
} finally {
  if (gateway) await stopProcess(gateway);
  if (resolve(temporaryRoot).startsWith(resolve(tmpdir()))) {
    try { rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
    catch (error) { console.warn(`Phase ${phase3 ? "3" : "2"} E2E temporary cleanup deferred: ${error?.message || error}`); }
  }
}
if (completed) process.exit(0);

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function fakeOidcToken(subject, secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: "https://ai-dev.ihep.ac.cn/api", sub: subject, aud: "hai-api",
    exp: Math.floor(Date.now() / 1000) + 600, typ: "access_token",
    scope: "openid hai_api", org_id: "phase3-e2e-org", sid: "phase3-e2e-session",
  });
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}
function digestFiles(paths) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path); hash.update("\0"); hash.update(readFileSync(resolve(repoRoot, path))); hash.update("\0");
  }
  return hash.digest("hex");
}
function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8", windowsHide: true }).trim();
}

async function waitForStableDesktopBuild() {
  const required = [
    join(desktopRoot, "out", "main", "index.js"),
    join(desktopRoot, "out", "preload", "index.js"),
    join(desktopRoot, "out", "renderer", "index.html"),
  ];
  const deadline = Date.now() + 30_000;
  let stableSince = 0;
  while (Date.now() < deadline) {
    if (required.every(existsSync)) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 2_000) return;
    } else {
      stableSince = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Desktop build outputs did not remain stable for two seconds.");
}

function resolvePython() {
  const candidates = [process.env.OPENDRSAI_GATEWAY_SMOKE_PYTHON, join(repoRoot, ".venv", "Scripts", "python.exe"), "python"].filter(Boolean);
  return candidates.find((value) => value.includes("\\") || value.includes("/") ? existsSync(value) : true);
}
function run(command, args, cwd, environment) {
  const result = spawnSync(command, args, { cwd, env: environment, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
}
function collect(child) {
  const chunks = [];
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => { chunks.push(chunk.toString()); if (chunks.length > 500) chunks.shift(); });
  return { tail: () => chunks.join("").slice(-32_000) };
}
async function waitForGateway(child, logs) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Gateway exited early (${child.exitCode}).\n${logs.tail()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { "X-OpenDrSai-Gateway-Token": token } });
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(`Gateway did not become ready.\n${logs.tail()}`);
}
function waitForExit(child, timeout) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error("Electron E2E timed out.")), timeout);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      child.stdout?.destroy(); child.stderr?.destroy();
      child.unref();
      resolvePromise(code);
    });
  });
}
async function stopProcess(child) {
  if (!child) return;
  if (child.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
    const deadline = Date.now() + 5_000;
    while (child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  child.stdout?.destroy(); child.stderr?.destroy();
  child.unref();
}
