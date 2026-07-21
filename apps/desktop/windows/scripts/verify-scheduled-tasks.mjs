import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Scheduled task verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const api = read("src/shared/desktopApi.ts");
const scheduledTasks = read("src/main/scheduledTasks.ts");
const main = read("src/main/index.ts");
const preload = read("src/preload/index.ts");
const skillSquare = read("src/renderer/src/components/SkillSquareView.tsx");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const styles = read("src/renderer/src/styles.css");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  packageJson.includes(
    '"verify:scheduled-tasks": "node scripts/verify-scheduled-tasks.mjs"',
  ),
  "package script is not registered",
);

assert(
  api.includes("DesktopScheduledTask") &&
    api.includes("DesktopScheduledTaskKind") &&
    api.includes('"scheduled" | "monitor"') &&
    api.includes("DesktopScheduledTaskCadence") &&
    api.includes("DesktopScheduledTaskRunResult") &&
    api.includes("DesktopScheduledTaskWorkerStatus") &&
    api.includes("activeWorkflowRunId") &&
    api.includes('"reconnected"') &&
    api.includes('"manual"') &&
    api.includes('"daily"'),
  "shared API omits scheduler taxonomy",
);
assert(
  api.includes("listScheduledTasks(") &&
    api.includes("createScheduledTask(") &&
    api.includes("updateScheduledTask(") &&
    api.includes("deleteScheduledTask(") &&
    api.includes("runDueScheduledTasks("),
  "desktop API omits scheduled task methods",
);
assert(
  api.includes("getScheduledTaskWorkerStatus()") &&
    api.includes("lastStartedAt") &&
    api.includes("lastFinishedAt") &&
    api.includes("lastResult"),
  "desktop API omits scheduler worker telemetry",
);

assert(
  scheduledTasks.includes("scheduled-tasks.json") &&
    scheduledTasks.includes("MAX_SCHEDULED_TASKS_PER_WORKSPACE") &&
    scheduledTasks.includes("workspaceKey(") &&
    scheduledTasks.includes("readScheduledTaskStore") &&
    scheduledTasks.includes("writeScheduledTaskStore"),
  "main scheduler store is not durable and workspace-scoped",
);
assert(
    scheduledTasks.includes("listScheduledTasks") &&
    scheduledTasks.includes("createScheduledTask") &&
    scheduledTasks.includes("updateScheduledTask") &&
    scheduledTasks.includes("deleteScheduledTask") &&
    scheduledTasks.includes('historyPolicy: "retain_results"') &&
    scheduledTasks.includes("runDueScheduledTasks") &&
    scheduledTasks.includes("startScheduledTaskWorker") &&
    scheduledTasks.includes("listWorkflowRuns?") &&
    scheduledTasks.includes("getActiveWorkflowRun") &&
    scheduledTasks.includes("getActiveWorkflowRunReconnectMessage") &&
    scheduledTasks.includes("clearActiveWorkflowRun") &&
    scheduledTasks.includes('status: "reconnected"') &&
    scheduledTasks.includes("restart-recovered workflow run") &&
    scheduledTasks.includes("getNextScheduledRunAt") &&
    scheduledTasks.includes("isTaskDue"),
  "main scheduler CRUD functions are missing",
);
assert(
  scheduledTasks.includes("ScheduledTaskWorkerHandle") &&
    scheduledTasks.includes("normalizeWorkerIntervalMs") &&
    scheduledTasks.includes("normalizeWorkerInitialDelayMs") &&
    scheduledTasks.includes("running = true") &&
    scheduledTasks.includes("timer.unref?.()") &&
    scheduledTasks.includes("clearTimeout(timer)") &&
    scheduledTasks.includes("runtime.onWorkflowRun") &&
    scheduledTasks.includes("getStatus()") &&
    scheduledTasks.includes("lastResult"),
  "scheduler worker does not provide bounded scans, non-overlap, mirroring, and shutdown",
);
assert(
  scheduledTasks.includes("assertScheduledTaskKind") &&
    scheduledTasks.includes("assertScheduledTaskStatus") &&
    scheduledTasks.includes("assertScheduledTaskCadence") &&
    scheduledTasks.includes("normalizeRequiredText") &&
    scheduledTasks.includes("normalizeLimit"),
  "scheduler inputs are not bounded or validated",
);

assert(main.includes('from "./scheduledTasks"'), "main process does not import scheduler");
assert(
    main.includes('secureHandle("desktop:scheduled-tasks-list"') &&
    main.includes('secureHandle("desktop:scheduled-task-create"') &&
    main.includes('secureHandle("desktop:scheduled-task-update"') &&
    main.includes('secureHandle("desktop:scheduled-task-delete"') &&
    main.includes('secureHandle("desktop:scheduled-tasks-run-due"') &&
    main.includes("runDueScheduledTasksAndMirror") &&
    main.includes("getScheduledTaskWorkerStatus") &&
    main.includes("listWorkflowRuns,") &&
    main.includes('secureHandle("desktop:scheduled-task-worker-status"') &&
    main.includes("startScheduledTaskWorkerIfEnabled") &&
    main.includes("stopScheduledTaskWorker") &&
    main.includes("OPENDRSAI_DISABLE_SCHEDULED_TASK_WORKER") &&
    main.includes("upsertBackgroundTaskForWorkflowRun"),
  "main process does not expose scheduler IPC",
);
assert(
  main.includes("startScheduledTaskWorkerIfEnabled();") &&
    main.includes("stopScheduledTaskWorker();") &&
    main.includes("OPENDRSAI_SCHEDULED_TASK_WORKER_INTERVAL_MS") &&
    main.includes("OPENDRSAI_SCHEDULED_TASK_WORKER_INITIAL_DELAY_MS"),
  "main process does not wire scheduler worker lifecycle",
);

assert(
  preload.includes("DesktopScheduledTask") &&
    preload.includes("desktop:scheduled-tasks-list") &&
    preload.includes("desktop:scheduled-task-create") &&
    preload.includes("desktop:scheduled-task-update") &&
    preload.includes("desktop:scheduled-task-delete") &&
    preload.includes("desktop:scheduled-tasks-run-due") &&
    preload.includes("desktop:scheduled-task-worker-status"),
  "preload bridge omits scheduler APIs",
);

assert(
  skillSquare.includes("ScheduledTaskPanel") &&
    skillSquare.includes("desktopApi.listScheduledTasks") &&
    skillSquare.includes("desktopApi.createScheduledTask") &&
    skillSquare.includes("desktopApi.updateScheduledTask") &&
    skillSquare.includes("desktopApi.runDueScheduledTasks") &&
    skillSquare.includes("desktopApi.getScheduledTaskWorkerStatus") &&
    skillSquare.includes("scheduled-worker-status") &&
    skillSquare.includes("result.reconnected") &&
    skillSquare.includes("activeWorkflowRunId") &&
    skillSquare.includes("onResume") &&
    skillSquare.includes('aria-label="Scheduled and monitoring tasks"') &&
    skillSquare.includes('aria-label="Scheduler worker status"') &&
    skillSquare.includes("Scheduled monitors") &&
    skillSquare.includes("Run due"),
  "Skills view does not render scheduler state",
);

assert(
  mock.includes("scheduledTasks") &&
    mock.includes("listScheduledTasks") &&
    mock.includes("createScheduledTask") &&
    mock.includes("updateScheduledTask") &&
    mock.includes("deleteScheduledTask") &&
    mock.includes("runDueScheduledTasks") &&
    mock.includes("getScheduledTaskWorkerStatus") &&
    mock.includes("mockScheduledWorkerStatus") &&
    mock.includes('status: "reconnected"') &&
    mock.includes("activeWorkflowRunStatus") &&
    mock.includes("restart-recovered workflow run") &&
    mock.includes("getMockNextScheduledRunAt"),
  "mock bridge omits scheduled task behavior",
);

assert(
  styles.includes(".scheduled-task-panel") &&
    styles.includes(".scheduled-worker-status") &&
    styles.includes(".scheduled-worker-status.running") &&
    styles.includes(".scheduled-task-panel li.paused") &&
    styles.includes(".scheduled-task-panel li.blocked"),
  "scheduler styles are missing",
);

assert(
  roadmap.includes("Scheduled / monitoring tasks") &&
    roadmap.includes("npm run verify:scheduled-tasks") &&
    roadmap.includes("scheduled-tasks.json") &&
    roadmap.includes("approval-gated due-scan") &&
    roadmap.includes("real clock/restart worker") &&
    roadmap.includes("worker status telemetry") &&
    roadmap.includes("active workflow run") &&
    roadmap.includes("reconnected") &&
    roadmap.includes("restart-recovered") &&
    roadmap.includes("Resume"),
  "roadmap does not record scheduled task status and verification",
);

console.log("Scheduled task verification passed.");
