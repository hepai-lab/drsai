import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Background task verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const api = read("../shared/api/desktopApi.ts");
const backgroundTasks = read("src/main/backgroundTasks.ts");
const main = read("src/main/index.ts");
const preload = read("../shared/main/preload.ts");
const skillSquare = read("../shared/renderer/src/components/SkillSquareView.tsx");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const styles = read("../shared/renderer/src/styles.css");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  packageJson.includes(
    '"verify:background-tasks": "node scripts/verify-background-tasks.mjs"',
  ),
  "package script is not registered",
);

assert(api.includes("DesktopBackgroundTask"), "shared API omits background task type");
assert(
  api.includes("DesktopBackgroundTaskKind") &&
    api.includes('"workflow_run"') &&
    api.includes('"scheduled_monitor"') &&
    api.includes('"agent_run"') &&
    api.includes('"presentation_generation"'),
  "shared API omits background task kind taxonomy",
);
assert(
  api.includes("DesktopBackgroundTaskStatus") &&
    api.includes('"queued"') &&
    api.includes('"waiting_approval"') &&
    api.includes('"completed"') &&
    api.includes('"cancelled"'),
  "shared API omits background task statuses",
);
assert(
  api.includes("listBackgroundTasks(") &&
    api.includes("enqueueBackgroundTask(") &&
    api.includes("updateBackgroundTask("),
  "desktop API omits background task queue methods",
);

assert(
  backgroundTasks.includes("background-tasks.json") &&
    backgroundTasks.includes("MAX_BACKGROUND_TASKS_PER_WORKSPACE") &&
    backgroundTasks.includes("workspaceKey(") &&
    backgroundTasks.includes("readBackgroundTaskStore") &&
    backgroundTasks.includes("writeBackgroundTaskStore"),
  "main background task store is not durable and workspace-scoped",
);
assert(
  backgroundTasks.includes("listBackgroundTasks") &&
    backgroundTasks.includes("enqueueBackgroundTask") &&
    backgroundTasks.includes("updateBackgroundTask"),
  "main background task queue CRUD functions are missing",
);
assert(
  backgroundTasks.includes("upsertBackgroundTaskForWorkflowRun") &&
    backgroundTasks.includes("mapWorkflowRunStatus") &&
    backgroundTasks.includes("workflow_run") &&
    backgroundTasks.includes("targetId: run.id"),
  "workflow runs are not mirrored into background tasks",
);
assert(
  backgroundTasks.includes("upsertBackgroundTaskForManagerPresentation") &&
    backgroundTasks.includes("completedPresentationSteps") &&
    backgroundTasks.includes("pendingDecisions") &&
    backgroundTasks.includes("presentation_generation"),
  "presentation generation is not supervised through the generic background queue",
);
assert(
  backgroundTasks.includes("upsertBackgroundTaskForAgentRun") &&
    backgroundTasks.includes("agentCompletedSteps") &&
    backgroundTasks.includes("mapAgentRunStatus") &&
    backgroundTasks.includes('kind: "agent_run"') &&
    backgroundTasks.includes("progress: agentRunProgress(event.type)"),
  "Agent runs are not supervised through the generic background queue",
);
assert(
  backgroundTasks.includes("rename(temporaryPath, BACKGROUND_TASKS_FILE)") &&
    backgroundTasks.includes("randomUUID()}.tmp"),
  "background task persistence is not atomic",
);
assert(
  backgroundTasks.includes("normalizeRequiredText") &&
    backgroundTasks.includes("normalizeLimit") &&
    backgroundTasks.includes("assertBackgroundTaskStatus"),
  "background task inputs are not bounded or validated",
);

assert(main.includes('from "./backgroundTasks"'), "main process does not import queue");
assert(
  main.includes('secureHandle("desktop:background-tasks-list"') &&
    main.includes('secureHandle("desktop:background-task-enqueue"') &&
    main.includes('secureHandle("desktop:background-task-update"'),
  "main process does not expose background task IPC",
);
assert(
  main.includes("await upsertBackgroundTaskForWorkflowRun(result.run)") &&
    main.includes("markShellWorkflowStepRunning") &&
    main.includes("await upsertBackgroundTaskForWorkflowRun(run)"),
  "workflow run lifecycle does not update background task status",
);
assert(
  main.includes("subscribeAgentRunLifecycle") &&
    main.includes("upsertBackgroundTaskForAgentRun(request, event)") &&
    main.includes("agentBackgroundTaskSync"),
  "Agent run lifecycle does not update background task status in order",
);

assert(
  preload.includes("DesktopBackgroundTask") &&
    preload.includes("desktop:background-tasks-list") &&
    preload.includes("desktop:background-task-enqueue") &&
    preload.includes("desktop:background-task-update"),
  "preload bridge omits background task APIs",
);

assert(
  skillSquare.includes("BackgroundTaskQueue") &&
    skillSquare.includes("desktopApi.listBackgroundTasks") &&
    skillSquare.includes('data-testid="background-task-queue"') &&
    skillSquare.includes('aria-label={zh ? "后台任务" : "Background task queue"}') &&
    skillSquare.includes("refreshBackgroundTasks") &&
    skillSquare.includes("Background tasks") &&
    skillSquare.includes("background-task-progress") &&
    skillSquare.includes("Completed:") &&
    skillSquare.includes("Needs you:") &&
    skillSquare.includes("background-task-list-status") &&
    skillSquare.includes("background-task-detail-status"),
  "Task views do not render the localized background task queue",
);

assert(
  mock.includes("backgroundTasks") &&
    mock.includes("upsertMockBackgroundTaskForWorkflowRun") &&
    mock.includes("mapMockWorkflowStatus") &&
    mock.includes("listBackgroundTasks") &&
    mock.includes("enqueueBackgroundTask") &&
    mock.includes("updateBackgroundTask"),
  "mock bridge omits background task behavior",
);

assert(
  styles.includes(".background-task-queue") &&
    styles.includes(".background-task-queue li.waiting_approval") &&
    styles.includes(".background-task-queue li.completed"),
  "background task queue styles are missing",
);

assert(
  roadmap.includes("Background tasks") &&
    roadmap.includes("npm run verify:background-tasks") &&
    roadmap.includes("background task queue"),
  "roadmap does not record background task status and verification",
);

console.log("Background task verification passed.");
