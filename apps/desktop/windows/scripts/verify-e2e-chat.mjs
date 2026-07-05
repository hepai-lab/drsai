import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(root, "..", "..", "..");
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const pythonSrc = join(repoRoot, "cores", "python", "packages", "drsai", "src");
const port = Number(process.env.OPENDRSAI_E2E_CHAT_PORT || "18643");
const baseUrl = `http://127.0.0.1:${port}`;
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E chat smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:e2e-chat.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-e2e-chat-"));
const appHome = join(tempDir, "drsai-home");
const pythonUserProfile = join(tempDir, "python-user");
const resultPath = join(tempDir, "result.json");
mkdirSync(appHome, { recursive: true });

let gatewayProcess = null;
let shuttingDownGateway = false;

try {
  await assertPortFree();
  gatewayProcess = await startPythonGateway();
  await waitForJson("/health", 25_000);
  await runPackagedApp();
  if (!existsSync(resultPath)) {
    throw new Error("E2E chat did not write a smoke result.");
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (!result.ok) {
    throw new Error(`E2E chat failed:\n${JSON.stringify(result, null, 2)}`);
  }
  assertChatDiagnostics(result);
  console.log("E2E chat passed with packaged Electron + real Python fake gateway.");
} finally {
  if (gatewayProcess) killProcessTree(gatewayProcess.pid);
  rmSync(tempDir, { recursive: true, force: true });
}

async function assertPortFree() {
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) });
    throw new Error(`${baseUrl} is already serving HTTP. Stop the existing gateway before running verify:e2e-chat.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
}

function assertChatDiagnostics(result) {
  const thread = result?.details?.thread;
  if (!thread || typeof thread.id !== "string" || !thread.id.startsWith("thread-") || thread.kind !== "chat") {
    throw new Error(`E2E chat did not create a real chat thread:\n${JSON.stringify(thread, null, 2)}`);
  }
  if (thread.id === "e2e-chat-request-0001" || thread.id === "e2e-chat-run-0001") {
    throw new Error(`E2E chat thread id collapsed into request/run id:\n${JSON.stringify(thread, null, 2)}`);
  }
  const summary = result?.details?.chatSummary;
  if (!summary || summary.firstEventType !== "start" || summary.terminalEventType !== "done" || summary.lastEventType !== "done") {
    throw new Error(`E2E chat did not record a completed chat event summary:\n${JSON.stringify(result, null, 2)}`);
  }
  if (!Number.isFinite(summary.durationMs) || summary.durationMs < 0) {
    throw new Error(`E2E chat durationMs is invalid:\n${JSON.stringify(summary, null, 2)}`);
  }
  const events = result?.details?.events;
  if (!Array.isArray(events) || !events.every((event) => Number.isFinite(event.at))) {
    throw new Error(`E2E chat events did not include relative timestamps:\n${JSON.stringify(events, null, 2)}`);
  }
  if (!events.every((event) => !event.sessionId || event.sessionId === thread.id)) {
    throw new Error(`E2E chat emitted events for the wrong thread:\n${JSON.stringify(events, null, 2)}`);
  }
  if (!events.every((event) => !event.runId || event.runId === "e2e-chat-run-0001")) {
    throw new Error(`E2E chat emitted events for the wrong run:\n${JSON.stringify(events, null, 2)}`);
  }
  for (let index = 1; index < events.length; index += 1) {
    if (events[index].at < events[index - 1].at) {
      throw new Error(`E2E chat event timestamps are not monotonic:\n${JSON.stringify(events, null, 2)}`);
    }
  }
  const threads = result?.details?.threads;
  if (!Array.isArray(threads) || !threads.some((item) =>
    item.id === thread.id &&
    item.status === "idle" &&
    item.lastRequestId === "e2e-chat-request-0001" &&
    item.lastRunId === "e2e-chat-run-0001" &&
    String(item.title || "").includes("hello e2e chat")
  )) {
    throw new Error(`E2E chat did not return its thread to idle after completion:\n${JSON.stringify(threads, null, 2)}`);
  }
  if (!result?.checks?.chatThreadEvents || !result?.checks?.chatRunEvents || !result?.checks?.chatDistinctIds || !result?.checks?.chatThreadIdle) {
    throw new Error(`E2E chat did not enable the thread/run idle invariants:\n${JSON.stringify(result?.checks, null, 2)}`);
  }
}

function startPythonGateway() {
  const python = resolvePython();
  const child = spawn(python, ["-m", "drsai.backend.gateway"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DRSAI_API_HOST: "127.0.0.1",
      DRSAI_API_PORT: String(port),
      DRSAI_GATEWAY_FAKE_AGENT: "1",
      DRSAI_HOME: appHome,
      USERNAME: "opendrsai-e2e-chat",
      USERPROFILE: pythonUserProfile,
      PYTHONPATH: [pythonSrc, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const logs = collectLogs(child);
  child.once("exit", (code) => {
    if (!shuttingDownGateway && code !== null && code !== 0) {
      process.stderr.write(`Python gateway exited with code ${code}.\n${logs.tail()}\n`);
    }
  });
  gatewayProcess = child;
  return child;
}

function runPackagedApp() {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const child = spawn(exePath, [], {
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
        OPENDRSAI_GATEWAY_PORT: String(port),
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_CHAT: "1",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: "45000",
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
      reject(new Error(`E2E chat timed out.\n${stdout}\n${stderr}`));
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
        resolvePromise();
        return;
      }
      const result = existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : "";
      reject(new Error(`Packaged app exited with code ${code}.${result}\n${stdout}\n${stderr}`));
    });
  });
}

function resolvePython() {
  const candidates = [
    process.env.OPENDRSAI_GATEWAY_SMOKE_PYTHON,
    join(repoRoot, "venv", "Scripts", "python.exe"),
    join(repoRoot, ".venv", "Scripts", "python.exe"),
    join(repoRoot, "venv", "bin", "python"),
    join(repoRoot, ".venv", "bin", "python"),
    "python.exe",
  ].filter(Boolean);
  const python = candidates.find((candidate) => candidate.includes("\\") || candidate.includes("/") ? existsSync(candidate) : true);
  if (!python) {
    throw new Error(`Could not find Python for E2E chat. Set OPENDRSAI_GATEWAY_SMOKE_PYTHON or create ${join(repoRoot, "venv")}.`);
  }
  return python;
}

async function waitForJson(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      if (response.status === 200) return;
    } catch {
      // Keep polling until ready.
    }
    if (gatewayProcess?.exitCode !== null) {
      throw new Error(`Python gateway exited before ${path} became ready.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Python gateway did not become ready at ${baseUrl}${path}.`);
}

function collectLogs(child) {
  const chunks = [];
  const append = (chunk) => {
    chunks.push(chunk.toString());
    while (chunks.join("").length > 12_000) chunks.shift();
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  return { tail: () => chunks.join("").slice(-12_000) };
}

function killProcessTree(pid) {
  if (!pid) return;
  shuttingDownGateway = true;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}
