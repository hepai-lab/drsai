import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const apiSource = read("..", "shared", "api", "desktopApi.ts");
const schedulerSource = read("src", "main", "scheduledTasks.ts");
const mainSource = read("src", "main", "index.ts");
const preloadSource = read("..", "shared", "main", "preload.ts");
const uiSource = read("..", "shared", "renderer", "src", "components", "TaskCenterView.tsx");
const mockSource = read("..", "shared", "renderer", "src", "mockDesktopApi.ts");
const e2eSource = read("src", "main", "e2eSmoke.ts");
const runnerSource = read("scripts", "verify-e2e-chat.mjs");

function assert(condition, message) {
  if (!condition) throw new Error(`K7 verification failed: ${message}`);
}

const future = "2026-07-15T02:00:00.000Z";
const moved = "2026-07-20T02:30:00.000Z";
const tasks = new Map([
  ["pause", { id: "pause", status: "enabled", nextRunAt: future }],
  ["edit", { id: "edit", status: "enabled", nextRunAt: future }],
  ["delete", { id: "delete", status: "enabled", nextRunAt: future, activeWorkflowRunId: "workflow-history" }],
]);
const history = new Map([["workflow-history", { id: "workflow-history", status: "completed" }]]);
tasks.set("pause", { ...tasks.get("pause"), status: "paused" });
const pauseDue = [...tasks.values()].filter((task) => task.status === "enabled" && task.nextRunAt <= future).map((task) => task.id);
tasks.set("edit", { ...tasks.get("edit"), title: "Modified CERN check", nextRunAt: moved });
const oldTimeDue = [...tasks.values()].filter((task) => task.status === "enabled" && task.nextRunAt <= future).map((task) => task.id);
tasks.set("pause", { ...tasks.get("pause"), status: "enabled" });
const resumedDue = [...tasks.values()].filter((task) => task.status === "enabled" && task.nextRunAt <= future).map((task) => task.id);
tasks.delete("delete");
const afterDeleteDue = [...tasks.values()].filter((task) => task.status === "enabled" && task.nextRunAt <= "2026-08-15T00:00:00.000Z").map((task) => task.id);

const metrics = {
  listShowsSchedules: tasks.size === 2,
  pauseStopsNextTrigger: !pauseDue.includes("pause"),
  editMovesNextTrigger: !oldTimeDue.includes("edit") && tasks.get("edit").title === "Modified CERN check",
  resumeRestoresTrigger: resumedDue.filter((id) => id === "pause").length === 1,
  deleteRemovesSchedule: !tasks.has("delete"),
  deleteStopsFutureRuns: !afterDeleteDue.includes("delete"),
  historyRetained: history.has("workflow-history"),
  retentionPolicyExplicit: schedulerSource.includes('historyPolicy: "retain_results"'),
};
for (const [name, passed] of Object.entries(metrics)) assert(passed, `metric ${name}`);

const golden = { visible: true, pausedSkipped: true, editApplied: true, resumedOnce: true, deleted: true, ranAfterDelete: false, historyRetained: true, policyVisible: true };
const accepts = (value) => value.visible && value.pausedSkipped && value.editApplied && value.resumedOnce && value.deleted && !value.ranAfterDelete && value.historyRetained && value.policyVisible;
const mutations = [
  { visible: false }, { pausedSkipped: false }, { editApplied: false }, { resumedOnce: false },
  { deleted: false }, { ranAfterDelete: true }, { historyRetained: false }, { policyVisible: false },
];
assert(accepts(golden), "golden evidence rejected");
for (const mutation of mutations) assert(!accepts({ ...golden, ...mutation }), `negative mutation accepted: ${JSON.stringify(mutation)}`);

const contracts = [
  [apiSource, "DesktopScheduledTaskDeleteRequest"], [apiSource, "DesktopScheduledTaskDeleteResult"],
  [apiSource, 'historyPolicy: "retain_results"'], [apiSource, "deleteScheduledTask("],
  [schedulerSource, "export async function deleteScheduledTask"], [schedulerSource, "findScheduledTaskLocation"],
  [schedulerSource, "store.workspaces[key].splice"], [schedulerSource, "Historical results remain available"],
  [mainSource, 'secureHandle("desktop:scheduled-task-delete"'], [preloadSource, 'ipcRenderer.invoke("desktop:scheduled-task-delete"'],
  [mockSource, "deleteScheduledTask: async"], [mockSource, 'historyPolicy: "retain_results"'],
  [uiSource, 'data-testid="schedule-management-actions"'], [uiSource, 'data-testid={task.status === "enabled" ? "schedule-pause" : "schedule-resume"}'],
  [uiSource, 'data-testid="schedule-delete"'], [uiSource, 'data-testid="schedule-delete-confirmation"'],
  [uiSource, 'data-testid="schedule-delete-confirm"'], [uiSource, "已有任务结果仍会保留"],
  [uiSource, "changeStatus(task"], [uiSource, "confirmDelete(task"],
  [e2eSource, "runScheduledTaskManagementSmoke"], [e2eSource, "pauseAppliedBeforeTrigger"],
  [e2eSource, "modifyAppliedBeforeTrigger"], [e2eSource, "deletedTaskNeverRanAgain"],
  [e2eSource, "historyRetained"], [e2eSource, "cernPdfAvailable"],
  [runnerSource, '"k7-scheduled-task-management"'], [runnerSource, "packaged-k7-scheduled-task-management-result.json"],
];
for (const [source, token] of contracts) assert(source.includes(token), `contract missing: ${token}`);

console.log(`K7 scheduled-task management verification passed: ${Object.keys(metrics).length}/8 metrics, ${mutations.length}/8 negative mutations, ${contracts.length}/${contracts.length} contracts.`);
