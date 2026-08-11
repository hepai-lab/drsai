import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

for (const key of ["NO_PROXY", "no_proxy"]) {
  const entries = String(process.env[key] || "").split(",").map((value) => value.trim()).filter(Boolean);
  for (const host of ["127.0.0.1", "localhost"]) if (!entries.includes(host)) entries.push(host);
  process.env[key] = entries.join(",");
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..", "..");
const pythonSrc = join(repoRoot, "cores", "python", "packages", "drsai", "src");
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const port = Number(process.env.OPENDRSAI_E2E_AGENT_RUN_FAILURE_PORT || "18647");
let activePort = port;
const oidcSigningSecret = createHash("sha256").update(`opendrsai-e2e-agent-failures:${port}`).digest("hex");
const baseUrl = () => `http://127.0.0.1:${activePort}`;
const evidenceDir = join(root, "release", "product-evidence", "k4-failure-recovery");
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E agent run failure smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:e2e-agent-run-failures.");
}

const requestedScenarios = String(process.env.OPENDRSAI_E2E_FAILURE_SCENARIOS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const scenarios = requestedScenarios.length > 0
  ? requestedScenarios
  : process.argv.includes("--k4-only")
    ? ["network-exhausted", "external-service"]
    : ["abort", "sse-error", "timeout", "chunk-disconnect", "network-exhausted", "external-service"];
for (const [index, scenario] of scenarios.entries()) {
  activePort = port + index;
  await runScenario(scenario);
}

console.log(`E2E agent run failure paths passed: ${scenarios.join(", ")}.`);
process.exit(0);

async function runScenario(scenario) {
  const tempDir = mkdtempSync(join(tmpdir(), `opendrsai-e2e-agent-${scenario}-`));
  const appHome = join(tempDir, "drsai-home");
  const workspacePath = join(tempDir, "workspace");
  const pythonUserProfile = join(tempDir, "python-user");
  const resultPath = join(tempDir, "result.json");
  mkdirSync(appHome, { recursive: true });
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(pythonUserProfile, { recursive: true });
  writeFileSync(join(workspacePath, "failure-fixture.txt"), `${scenario}\n`, "utf8");
  let server = null;

  try {
    await assertPortFree();
    server = startRuntimeGateway(scenario, appHome, workspacePath, pythonUserProfile);
    await waitForGatewayReady(server);
    await runPackagedApp({ appHome, resultPath, scenario, workspacePath });
    if (!existsSync(resultPath)) {
      throw new Error(`${scenario}: packaged app did not write an agent run smoke result.`);
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    if (!result.ok) {
      throw new Error(`${scenario}: E2E agent run failure smoke failed:\n${JSON.stringify(result, null, 2)}`);
    }
    assertScenarioDiagnostics(scenario, result);
    assertThreadPersistence(scenario, result, appHome);
    if (["network-exhausted", "external-service"].includes(scenario)) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, `${scenario}-result.json`), `${JSON.stringify({
        ok: true,
        scenario,
        result,
      }, null, 2)}\n`, "utf8");
    }
  } finally {
    if (server?.pid) await stopProcessTree(server);
    await cleanupTempDir(tempDir);
  }
}

function assertThreadPersistence(scenario, result, appHome) {
  const detailKey = {
    abort: "abort",
    "sse-error": "sseError",
    timeout: "timeout",
    "chunk-disconnect": "chunkDisconnect",
    "network-exhausted": "networkExhausted",
    "external-service": "externalService",
  }[scenario];
  const summary = result?.details?.[detailKey];
  const expectedThreadStatus = scenario === "abort" ? "idle" : "error";
  if (!summary?.thread?.id || summary.thread.status !== expectedThreadStatus) {
    throw new Error(`${scenario}: listThreads did not persist terminal agent thread status ${expectedThreadStatus}:\n${JSON.stringify(summary, null, 2)}`);
  }
  const threadsPath = join(appHome, "desktop", "threads.json");
  if (!existsSync(threadsPath)) {
    throw new Error(`${scenario}: threads.json was not written.`);
  }
  const threads = JSON.parse(readFileSync(threadsPath, "utf8"));
  if (!Array.isArray(threads)) {
    throw new Error(`${scenario}: threads.json is not an array.`);
  }
  if (threads.some((thread) => thread.status === "running")) {
    throw new Error(`${scenario}: threads.json left a running agent thread:\n${JSON.stringify(threads, null, 2)}`);
  }
  const persisted = threads.find((thread) => thread.id === summary.thread.id);
  if (!persisted || persisted.status !== expectedThreadStatus) {
    throw new Error(`${scenario}: threads.json did not persist ${summary.thread.id} as ${expectedThreadStatus}:\n${JSON.stringify(threads, null, 2)}`);
  }
}

async function assertPortFree() {
  try {
    await fetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(800) });
    throw new Error(`${baseUrl()} is already serving HTTP. Stop the existing gateway before running verify:e2e-agent-run-failures.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
}

async function waitForGatewayReady(server) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) {
      throw new Error(`Runtime failure fixture exited with code ${server.exitCode}.\n${server.diagnosticStdout || ""}\n${server.diagnosticStderr || ""}`);
    }
    try {
      const response = await fetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`${baseUrl()} did not become ready for the Runtime failure fixture.\n${server?.diagnosticStdout || ""}\n${server?.diagnosticStderr || ""}`);
}

function startRuntimeGateway(scenario, appHome, workspacePath, pythonUserProfile) {
  const python = resolvePython();
  const child = spawn(python, ["-m", "drsai.backend.gateway"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DRSAI_API_HOST: "127.0.0.1",
      DRSAI_API_PORT: String(activePort),
      DRSAI_GATEWAY_FAKE_AGENT: "1",
      OPENDRSAI_DESKTOP_RUNTIME: "1",
      OPENDRSAI_OIDC_HS256_SECRET: oidcSigningSecret,
      OPENDRSAI_E2E_AGENT_FAILURE_SCENARIO: scenario,
      DRSAI_HOME: appHome,
      USERPROFILE: pythonUserProfile,
      PYTHONPATH: [pythonSrc, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
      OPENDRSAI_E2E_AGENT_WORKSPACE: workspacePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.diagnosticStdout = "";
  child.diagnosticStderr = "";
  child.stdout?.on("data", (chunk) => { child.diagnosticStdout += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { child.diagnosticStderr += chunk.toString(); });
  return child;
}

function resolvePython() {
  const candidates = [process.env.OPENDRSAI_PYTHON, join(repoRoot, ".venv", "Scripts", "python.exe"), "python"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore", windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  throw new Error("Python is required for the Runtime-backed Agent failure E2E.");
}

function assertScenarioDiagnostics(scenario, result) {
  const detailKey = {
    abort: "abort",
    "sse-error": "sseError",
    timeout: "timeout",
    "chunk-disconnect": "chunkDisconnect",
    "network-exhausted": "networkExhausted",
    "external-service": "externalService",
  }[scenario];
  const expectedTerminal = {
    abort: "aborted",
    "sse-error": "error",
    timeout: "aborted",
    "chunk-disconnect": "error",
    "network-exhausted": "error",
    "external-service": "error",
  }[scenario];
  const summary = detailKey ? result?.details?.[detailKey] : null;
  if (!summary || summary.firstEventType !== "start" || summary.terminalEventType !== expectedTerminal) {
    throw new Error(`${scenario}: E2E agent run failure smoke did not record the expected terminal summary:\n${JSON.stringify(result, null, 2)}`);
  }
  if (summary.lastEventType !== summary.terminalEventType) {
    throw new Error(`${scenario}: last event and terminal event diverged:\n${JSON.stringify(summary, null, 2)}`);
  }
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0) {
    throw new Error(`${scenario}: durationMs is invalid:\n${JSON.stringify(summary, null, 2)}`);
  }
  const events = summary.events;
  if (!Array.isArray(events) || !events.every((event) => Number.isFinite(event.at))) {
    throw new Error(`${scenario}: events did not include relative timestamps:\n${JSON.stringify(events, null, 2)}`);
  }
  if (
    scenario === "chunk-disconnect" &&
    !events.some((event) => event.type === "error" && (
      String(event.error || "").includes("ended before data: [DONE]") ||
      String(event.error || "").includes("synthetic agent stream disconnected") ||
      (event.failureRecovery?.kind === "network" && event.failureRecovery.exhausted === true)
    ))
  ) {
    throw new Error(`${scenario}: missing agent stream disconnect error:\n${JSON.stringify(events, null, 2)}`);
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].at < events[index - 1].at) {
      throw new Error(`${scenario}: event timestamps are not monotonic:\n${JSON.stringify(events, null, 2)}`);
    }
  }
}

function runPackagedApp({ appHome, resultPath, scenario, workspacePath }) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(exePath, [`--user-data-dir=${join(appHome, "electron-user-data")}`], {
      cwd: root,
      env: {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        PATH: systemPath,
        DRSAI_HOME: appHome,
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_GATEWAY_PORT: String(activePort),
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_OIDC_HS256_SECRET: oidcSigningSecret,
        OPENDRSAI_OIDC_HS256_SECRET: oidcSigningSecret,
        OPENDRSAI_E2E_AUTH_USER_ID: "48e5ae58-3b3b-45f8-b440-d0e0962ac295",
        OPENDRSAI_E2E_AGENT_RUN_FAILURES: "1",
        OPENDRSAI_E2E_AGENT_RUN_FAILURE_SCENARIO: scenario,
        OPENDRSAI_E2E_WORKSPACE_PATH: workspacePath,
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: "45000",
        OPENDRSAI_NETWORK_RECOVERY_WINDOW_MS: "1400",
        OPENDRSAI_CHAT_TIMEOUT_MS: scenario === "timeout" ? "1000" : "12000",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      reject(new Error(`${scenario}: E2E agent run failure timed out.\n${stdout}\n${stderr}`));
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolveRun();
        return;
      }
      const result = existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : "";
      reject(new Error(`${scenario}: packaged app exited with code ${code}.${result}\n${stdout}\n${stderr}`));
    });
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  const closed = child.exitCode !== null
    ? Promise.resolve()
    : new Promise((resolveClose) => child.once("close", resolveClose));
  killProcessTree(child.pid);
  await Promise.race([closed, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2000))]);
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.stdin?.destroy();
}

async function cleanupTempDir(path) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  process.stderr.write(`[cleanup] Could not remove ${path}: ${lastError instanceof Error ? lastError.message : String(lastError)}; release cleanup will retry.\n`);
}
