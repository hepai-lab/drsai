import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const desktopRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(desktopRoot, "../../..");
const pythonSource = join(repoRoot, "cores", "python", "packages", "drsai", "src");
const fixtureScript = join(desktopRoot, "scripts", "fixtures", "run_traceability_phase1_fixture.py");
const python = resolvePython();
const electronCli = require.resolve("electron/cli.js");
const temporaryRoot = mkdtempSync(join(tmpdir(), "opendrsai-run-traceability-"));
const home = join(temporaryRoot, "home");
const workspace = join(temporaryRoot, "workspace");
const fixture = join(temporaryRoot, "fixture.json");
const desktopResult = join(temporaryRoot, "desktop-result.json");
const exportDir = join(temporaryRoot, "exports");
const evidencePath = join(repoRoot, "docs", "desktop", "evidence", "agent-runtime-traceability-phase1-windows-e2e-result.json");
const userData = join(temporaryRoot, "user-data");
const port = 23000 + (process.pid % 15000);
const token = randomBytes(32).toString("base64url");
const oidcSigningSecret = randomBytes(32).toString("base64url");
const e2ePrincipalId = "11111111-1111-4111-8111-111111111111";
const pathSeparator = process.platform === "win32" ? ";" : ":";
const commonEnv = {
  ...process.env,
  DRSAI_HOME: home,
  OPENDRSAI_DEV_HOME: home,
  DRSAI_REPO: workspace,
  DRSAI_API_HOST: "127.0.0.1",
  DRSAI_API_PORT: String(port),
  OPENDRSAI_GATEWAY_PORT: String(port),
  OPENDRSAI_DEV_GATEWAY_PORT: String(port),
  OPENDRSAI_GATEWAY_INSTANCE_TOKEN: token,
  OPENDRSAI_OIDC_HS256_SECRET: oidcSigningSecret,
  OPENDRSAI_E2E_OIDC_HS256_SECRET: oidcSigningSecret,
  OPENDRSAI_ENFORCE_WORKSPACE_PERMISSIONS: "1",
  OPENDRSAI_E2E_AUTH_USER_ID: e2ePrincipalId,
  // Keep the locally signed E2E principal scoped to the isolated Gateway.
  // A live platform-catalog 401 must not invalidate the acceptance session.
  OPENDRSAI_PLATFORM_AGENTS_ENABLED: "0",
  PYTHONPATH: [pythonSource, process.env.PYTHONPATH].filter(Boolean).join(pathSeparator),
};

let gateway;
try {
  run(python, [fixtureScript, "--home", home, "--workspace", workspace, "--output", fixture], repoRoot, commonEnv);
  gateway = spawn(python, ["-m", "drsai.backend.gateway"], {
    cwd: repoRoot,
    env: commonEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const gatewayLogs = collect(gateway);
  await waitForGateway(gateway, gatewayLogs);

  const app = spawn(process.execPath, [electronCli, desktopRoot, `--user-data-dir=${userData}`], {
    cwd: desktopRoot,
    env: {
      ...commonEnv,
      DRSAI_GATEWAY_DEV_MANAGED: "1",
      OPENDRSAI_GATEWAY_STARTUP: "external",
      OPENDRSAI_GATEWAY_PROBE_TIMEOUT_MS: "15000",
      OPENDRSAI_E2E_RUN_TRACEABILITY_PHASE1: "1",
      OPENDRSAI_E2E_RUN_TRACEABILITY_FIXTURE: fixture,
      OPENDRSAI_E2E_RESULT: desktopResult,
      OPENDRSAI_E2E_EXPORT_DIR: exportDir,
      OPENDRSAI_E2E_TIMEOUT_MS: "120000",
      OPENDRSAI_E2E_DISABLE_GPU: "1",
      OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const appLogs = collect(app);
  const appCode = await waitForExit(app, 140_000);
  if (appCode !== 0 || !existsSync(desktopResult)) {
    const structuredResult = existsSync(desktopResult)
      ? readFileSync(desktopResult, "utf8")
      : "<no structured Desktop result>";
    throw new Error(`Desktop E2E failed (${appCode}).\nResult: ${structuredResult}\n${appLogs.tail()}`);
  }
  const result = JSON.parse(readFileSync(desktopResult, "utf8"));
  if (result.ok !== true || !Object.values(result.checks || {}).every(Boolean)) {
    throw new Error(`Desktop E2E checks failed: ${JSON.stringify(result)}`);
  }

  await stopProcess(gateway);
  gateway = undefined;
  run(
    python,
    [fixtureScript, "--verify", "--home", home, "--output", fixture, "--desktop-result", desktopResult],
    repoRoot,
    commonEnv,
  );
  writeFileSync(evidencePath, `${JSON.stringify({
    schema_version: "opendrsai.run-traceability-windows-e2e-result/1",
    generated_at: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    scenarios: ["A", "B", "C-waiting", "C-denied", "D", "E", "F"],
    checks: result.checks,
    details: result.details,
    offline_database_verification: true,
    security_audit_verification: true,
  }, null, 2)}\n`, "utf8");
  console.log("Real Windows Runtime/Desktop Run traceability phase 1 E2E passed (A-F + waiting/denied approval).\n");
} finally {
  if (gateway) await stopProcess(gateway);
  if (resolve(temporaryRoot).startsWith(resolve(tmpdir()))) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function resolvePython() {
  const candidates = [
    process.env.OPENDRSAI_GATEWAY_SMOKE_PYTHON,
    join(repoRoot, ".venv", "Scripts", "python.exe"),
    join(repoRoot, "venv", "Scripts", "python.exe"),
    join(repoRoot, ".venv", "bin", "python"),
    "python",
  ].filter(Boolean);
  const candidate = candidates.find((value) => value.includes("\\") || value.includes("/") ? existsSync(value) : true);
  if (!candidate) throw new Error("A Python runtime is required for the real Run traceability E2E.");
  return candidate;
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout;
}

function collect(child) {
  const chunks = [];
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk) => {
    chunks.push(chunk.toString());
    if (chunks.length > 500) chunks.shift();
  });
  return { tail: () => chunks.join("").slice(-32_000) };
}

async function waitForGateway(child, logs) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Gateway exited early (${child.exitCode}).\n${logs.tail()}`);
    try {
      const headers = { "X-OpenDrSai-Gateway-Token": token };
      const [health, models] = await Promise.all([
        fetch(`http://127.0.0.1:${port}/health`, { headers }),
        fetch(`http://127.0.0.1:${port}/v1/models`, { headers }),
      ]);
      const modelBody = models.ok ? await models.json() : null;
      if (health.ok && modelBody?.object === "list" && Array.isArray(modelBody.data)) return;
    } catch { /* retry */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(`Gateway did not become ready.\n${logs.tail()}`);
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      void stopProcess(child);
      reject(new Error("Desktop E2E timed out."));
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); resolvePromise(code); });
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000)),
  ]);
  if (child.exitCode === null && process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
}
