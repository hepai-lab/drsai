import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const workerPath = join(root, "..", "shared", "browser-use-worker", "worker.py");
const python311 = "C:\\Python311\\python.exe";
const pythonCommand =
  process.env.OPENDRSAI_BROWSER_USE_SMOKE_PYTHON ||
  (existsSync(python311) ? python311 : process.env.PYTHON || "python");
const browserUseHome = join(root, ".tmp-browser-use-smoke");

if (!existsSync(workerPath)) {
  throw new Error(`Missing browser-use worker: ${workerPath}`);
}

await verifyBrowserUseImport();
const chromiumInstalled = hasPlaywrightChromium();

const fallbackEvents = await runWorker(
  {},
  [
    {
      type: "task.start",
      taskId: "fallback-task",
      instruction: "Inspect local fixture",
      url: "http://localhost:3000/",
      policy: { requireApprovalForSideEffects: true },
    },
    { type: "task.stop", taskId: "fallback-task" },
  ],
);

const fakeRealEvents = await runWorker(
  { OPENDRSAI_BROWSER_USE_FAKE_REAL: "1" },
  [
    {
      type: "task.start",
      taskId: "fake-real-task",
      instruction: "Inspect local fixture",
      url: "http://localhost:3000/",
      policy: { requireApprovalForSideEffects: true },
    },
    {
      type: "action.approve",
      taskId: "fake-real-task",
      actionId: "fake-real-task:approve-click",
      approved: true,
    },
  ],
);

const fallbackStarted = hasEvent(fallbackEvents, "task.started", "fallback-task");
const fallbackExplicit = fallbackEvents.some(
  (event) =>
    event.type === "task.failed" &&
    event.taskId === "fallback-task" &&
    /browser-use (is not configured|package unavailable)/.test(String(event.error || "")),
);
const fallbackCancelled = hasEvent(fallbackEvents, "task.cancelled", "fallback-task");
const fakeStarted = hasEvent(fakeRealEvents, "task.started", "fake-real-task");
const fakeObserved = hasEvent(fakeRealEvents, "page.observed", "fake-real-task");
const fakeProposedApproval = fakeRealEvents.some(
  (event) =>
    event.type === "action.proposed" &&
    event.taskId === "fake-real-task" &&
    event.requiresApproval === true,
);
const fakeAction = hasEvent(fakeRealEvents, "action.completed", "fake-real-task");
const fakeScreenshot = hasEvent(fakeRealEvents, "screenshot", "fake-real-task");
const fakeCompleted = hasEvent(fakeRealEvents, "task.completed", "fake-real-task");

const checks = [
  ["worker Python imports browser-use Agent runtime", true],
  ["Playwright Chromium runtime is installed", chromiumInstalled],
  ["worker emits task.started in fallback mode", fallbackStarted],
  ["worker reports explicit browser-use availability/config failure", fallbackExplicit],
  ["worker accepts cancellation in fallback mode", fallbackCancelled],
  ["worker emits task.started in fake-real mode", fakeStarted],
  ["worker emits page observation in fake-real mode", fakeObserved],
  ["worker proposes an approvable action in fake-real mode", fakeProposedApproval],
  ["worker emits action completion in fake-real mode", fakeAction],
  ["worker emits screenshot in fake-real mode", fakeScreenshot],
  ["worker emits task completion in fake-real mode", fakeCompleted],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (failed.length) {
  fail(
    `browser-use worker smoke failed: ${failed.length} check(s).\nFallback: ${JSON.stringify(
      fallbackEvents,
    )}\nFake real: ${JSON.stringify(fakeRealEvents)}`,
  );
}

console.log("\nbrowser-use worker smoke passed.");

function runWorker(extraEnv, commands) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, [workerPath], {
      cwd: root,
      env: {
        ...process.env,
        BROWSER_USE_CONFIG_DIR: join(browserUseHome, "config"),
        BROWSER_USE_PROFILES_DIR: join(browserUseHome, "profiles"),
        BROWSER_USE_DEFAULT_USER_DATA_DIR: join(browserUseHome, "profiles", "default"),
        BH_HOME: join(browserUseHome, "browser-harness"),
        BH_CONFIG_DIR: join(browserUseHome, "browser-harness", "config"),
        BH_RUNTIME_DIR: join(browserUseHome, "browser-harness", "runtime"),
        BH_TMP_DIR: join(browserUseHome, "browser-harness", "tmp"),
        BH_AGENT_WORKSPACE: join(browserUseHome, "browser-harness", "agent-workspace"),
        ...extraEnv,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const events = [];
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`browser-use worker smoke timed out.\n${stderr}`));
    }, 10_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      let newline = stdout.indexOf("\n");
      while (newline !== -1) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (line) events.push(JSON.parse(line));
        newline = stdout.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start Python worker with ${pythonCommand}: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`browser-use worker exited with ${code}.\n${stderr}`));
        return;
      }
      resolve(events);
    });

    for (const command of commands) {
      child.stdin.write(`${JSON.stringify(command)}\n`);
    }
    child.stdin.end();
  });
}

function verifyBrowserUseImport() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonCommand,
      ["-c", "from browser_use import Agent, ChatBrowserUse; print('imports-ok')"],
      {
        cwd: root,
        env: {
          ...process.env,
          BROWSER_USE_CONFIG_DIR: join(browserUseHome, "config"),
          BROWSER_USE_PROFILES_DIR: join(browserUseHome, "profiles"),
          BROWSER_USE_DEFAULT_USER_DATA_DIR: join(browserUseHome, "profiles", "default"),
          BH_HOME: join(browserUseHome, "browser-harness"),
          BH_CONFIG_DIR: join(browserUseHome, "browser-harness", "config"),
          BH_RUNTIME_DIR: join(browserUseHome, "browser-harness", "runtime"),
          BH_TMP_DIR: join(browserUseHome, "browser-harness", "tmp"),
          BH_AGENT_WORKSPACE: join(browserUseHome, "browser-harness", "agent-workspace"),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`browser-use Agent import failed with ${pythonCommand}.\n${stderr}`));
        return;
      }
      resolve();
    });
  });
}

function hasEvent(events, type, taskId) {
  return events.some((event) => event.type === type && event.taskId === taskId);
}

function hasPlaywrightChromium() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return false;
  const playwrightRoot = join(localAppData, "ms-playwright");
  if (!existsSync(playwrightRoot)) return false;
  return readdirSync(playwrightRoot).some((name) => name.startsWith("chromium-"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
