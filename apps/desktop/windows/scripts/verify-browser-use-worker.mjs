import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const files = {
  sharedTypes: read("src/shared/browser/types.ts"),
  desktopApi: read("../shared/api/desktopApi.ts"),
  preload: read("../shared/main/preload.ts"),
  mockApi: read("../shared/renderer/src/mockDesktopApi.ts"),
  main: read("src/main/index.ts"),
  protocol: read("src/main/browser/browserUse/protocol.ts"),
  processManager: read("src/main/browser/browserUse/processManager.ts"),
  workerClient: read("src/main/browser/browserUse/workerClient.ts"),
  trace: read("src/main/browser/browserTaskTrace.ts"),
  controller: read("src/main/browser/adapters/browserUseController.ts"),
  actionPolicy: read("src/shared/browser/actionPolicy.ts"),
  worker: read("src/python/browser_use_worker/worker.py"),
  workerProtocol: read("src/python/browser_use_worker/protocol.py"),
  requirements: read("src/python/browser_use_worker/requirements.txt"),
  smoke: read("scripts/verify-browser-use-worker-smoke.mjs"),
};

const requiredEvents = [
  "task.started",
  "page.observed",
  "action.proposed",
  "action.completed",
  "screenshot",
  "task.completed",
  "task.failed",
  "task.cancelled",
];

const checks = [
  ["shared browser task event union", requiredEvents.every((event) => files.sharedTypes.includes(event))],
  ["worker command protocol", files.protocol.includes("BrowserUseWorkerCommand") && files.protocol.includes("task.start") && files.protocol.includes("action.approve") && files.protocol.includes("task.stop")],
  ["worker event parser", files.protocol.includes("parseBrowserUseWorkerEvent") && requiredEvents.every((event) => files.protocol.includes(event))],
  ["worker command serializer", files.protocol.includes("serializeBrowserUseWorkerCommand") && files.protocol.includes("JSON.stringify(command)")],
  ["worker process manager", files.processManager.includes("startBrowserUseWorkerProcess") && files.processManager.includes("browser_use_worker") && files.processManager.includes("windowsHide: true")],
  ["worker isolates browser-use config/profile dirs", files.processManager.includes("BROWSER_USE_CONFIG_DIR") && files.processManager.includes("BROWSER_USE_PROFILES_DIR") && files.processManager.includes("BROWSER_USE_DEFAULT_USER_DATA_DIR")],
  ["worker isolates browser-harness dirs", files.processManager.includes("BH_HOME") && files.processManager.includes("BH_TMP_DIR") && files.processManager.includes("BH_AGENT_WORKSPACE")],
  ["worker client emits structured events", files.workerClient.includes("BrowserUseWorkerClient") && files.workerClient.includes('this.emit("event"') && files.workerClient.includes("parseBrowserUseWorkerEvent")],
  ["browser-use controller adapter", files.controller.includes("BrowserUseController") && files.controller.includes('readonly engine = "browser-use"') && files.controller.includes("createBrowserUseTaskCommand")],
  ["desktop API exposes browser task IPC", files.desktopApi.includes("startBrowserTask") && files.desktopApi.includes("stopBrowserTask") && files.desktopApi.includes("approveBrowserTaskAction") && files.desktopApi.includes("onBrowserTaskEvent")],
  ["preload exposes browser task IPC", files.preload.includes("desktop:browser-task-start") && files.preload.includes("desktop:browser-task-stop") && files.preload.includes("desktop:browser-task-approve") && files.preload.includes("desktop:browser-task-event")],
  ["main process handles browser task IPC", files.main.includes("desktop:browser-task-start") && files.main.includes("desktop:browser-task-stop") && files.main.includes("desktop:browser-task-approve") && files.main.includes("browserTaskSubscribers")],
  ["main process persists browser task traces", files.main.includes("initializeBrowserTaskTrace") && files.main.includes("appendBrowserTaskTraceEvent") && files.trace.includes("getBrowserTaskTraceDir")],
  ["main process prefers Python 3.11 for browser-use", files.main.includes("resolveBrowserUsePythonCommand") && files.main.includes("OPENDRSAI_BROWSER_USE_PYTHON") && files.main.includes("C:\\\\Python311\\\\python.exe")],
  ["mock API covers browser task IPC", files.mockApi.includes("startBrowserTask") && files.mockApi.includes("stopBrowserTask") && files.mockApi.includes("onBrowserTaskEvent")],
  ["mock API covers browser approval IPC", files.mockApi.includes("approveBrowserTaskAction")],
  ["python worker command loop", files.worker.includes("def handle_command") && files.worker.includes("task.started") && files.worker.includes("task.failed") && files.worker.includes("task.cancelled")],
  ["python worker waits for fake approval", files.worker.includes("wait_for_approval") && files.worker.includes("requiresApproval") && files.worker.includes("Timed out waiting for browser-use action approval")],
  ["python worker attempts real browser-use", files.worker.includes("from browser_use import Agent, ChatBrowserUse") && files.worker.includes("BROWSER_USE_API_KEY") && files.worker.includes("agent.run()")],
  ["python worker has fake-real test mode", files.worker.includes("OPENDRSAI_BROWSER_USE_FAKE_REAL") && files.worker.includes("run_fake_browser_use_task")],
  ["python protocol helper", files.workerProtocol.includes("WorkerCommand") && files.workerProtocol.includes("make_event")],
  ["browser-use dependency declared", files.requirements.includes("browser-use")],
  ["sensitive operation approval policy", files.actionPolicy.includes("browserActionRequiresSensitiveApproval") && files.protocol.includes("sensitiveOperations")],
  ["browser-use worker smoke script", files.smoke.includes("from browser_use import Agent, ChatBrowserUse") && files.smoke.includes("hasPlaywrightChromium") && files.smoke.includes("fallback-task") && files.smoke.includes("fake-real-task") && files.smoke.includes("action.approve") && files.smoke.includes("task.completed")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

if (failed.length) {
  console.error(`\nbrowser-use worker verification failed: ${failed.length} check(s) failed.`);
  process.exit(1);
}

console.log("\nbrowser-use worker scaffold verification passed.");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}
