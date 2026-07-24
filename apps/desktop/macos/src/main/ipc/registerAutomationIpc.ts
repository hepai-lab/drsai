import type { IpcMain } from "electron";
import { backgroundTaskStore } from "../../../../shared/main/backgroundTasks";
import { notifyBackgroundTaskCompleted, setCompletionNotificationPreference } from "../../../../shared/main/completionNotifications";
import { listReusableTasks, prepareReusableTaskRun, saveReusableTask } from "../../../../shared/main/reusableTasks";
import { scheduledTaskStore } from "../../../../shared/main/scheduledTasks";
import { listWorkflowMarketplace, syncWorkflowMarketplace } from "../../../../shared/main/workflowMarketplace";
import { completeWorkflowRunStep, dispatchWorkflowRunStep, listWorkflowRuns, startWorkflowRun } from "../../../../shared/main/workflowRuns";
import type { MacosServiceContainer } from "../serviceContainer";

export type MacosAutomationIpcServices = Pick<MacosServiceContainer, "workspace" | "automation">;

/** Registers workflow and task automation with live worker state and explicit workspace authorization. */
export function registerMacosAutomationIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: MacosAutomationIpcServices,
): void {
  const assertOptionalWorkspace = async (path: unknown) => {
    if (path !== undefined) await services.workspace.assertPath(path);
  };

  ipcMain.handle("desktop:workflow-marketplace-list", async (_event, workspacePath) => { await assertOptionalWorkspace(workspacePath); return listWorkflowMarketplace(workspacePath); });
  ipcMain.handle("desktop:workflow-marketplace-sync", async (_event, request) => {
    const path = await services.workspace.assertPath(request?.workspacePath);
    if ((await services.workspace.findByPath(path))?.location === "remote") throw new Error("Workflow marketplace sync requires a local Workspace source file.");
    return syncWorkflowMarketplace(request);
  });
  ipcMain.handle("desktop:workflow-run-prepare", (_event, request) => services.automation.prepareWorkflowRun(request));
  ipcMain.handle("desktop:workflow-run-start", async (_event, request) => { await assertOptionalWorkspace(request?.recipe?.workspacePath); const result = await startWorkflowRun(request); await backgroundTaskStore.upsertWorkflow(result.run); return result; });
  ipcMain.handle("desktop:workflow-runs-list", async (_event, workspacePath) => { await assertOptionalWorkspace(workspacePath); return listWorkflowRuns(workspacePath); });
  ipcMain.handle("desktop:workflow-run-step-dispatch", async (_event, request) => { const result = await dispatchWorkflowRunStep(request); await backgroundTaskStore.upsertWorkflow(result.run); return result; });
  ipcMain.handle("desktop:workflow-run-step-complete", async (_event, request) => { const result = await completeWorkflowRunStep(request); await backgroundTaskStore.upsertWorkflow(result.run); return result; });
  ipcMain.handle("desktop:background-tasks-list", async (_event, request) => { await assertOptionalWorkspace(request?.workspacePath); return backgroundTaskStore.list(request); });
  ipcMain.handle("desktop:reusable-tasks-list", () => listReusableTasks());
  ipcMain.handle("desktop:reusable-task-save", (_event, request) => saveReusableTask(request));
  ipcMain.handle("desktop:reusable-task-run-prepare", async (_event, request) => { await assertOptionalWorkspace(request?.workspacePath); return prepareReusableTaskRun(request); });
  ipcMain.handle("desktop:background-task-enqueue", async (_event, request) => { await assertOptionalWorkspace(request?.workspacePath); return backgroundTaskStore.enqueue(request); });
  ipcMain.handle("desktop:background-task-update", async (_event, request) => {
    const task = await backgroundTaskStore.update(request);
    notifyBackgroundTaskCompleted(task, { kind: task.kind, targetId: task.targetId || task.id, ...(task.workspacePath ? { workspacePath: task.workspacePath } : {}) });
    return task;
  });
  ipcMain.handle("desktop:completion-notification-preference-set", (_event, preference) => setCompletionNotificationPreference(preference));
  ipcMain.handle("desktop:background-task-cancel", (_event, request) => backgroundTaskStore.cancel(request));
  ipcMain.handle("desktop:background-task-retry", (_event, request) => backgroundTaskStore.retry(request));
  ipcMain.handle("desktop:background-tasks-recover", () => backgroundTaskStore.recover());
  ipcMain.handle("desktop:scheduled-tasks-list", async (_event, request) => { await assertOptionalWorkspace(request?.workspacePath); return scheduledTaskStore.list(request); });
  ipcMain.handle("desktop:scheduled-task-create", async (_event, request) => { await assertOptionalWorkspace(request?.workspacePath); return scheduledTaskStore.create(request); });
  ipcMain.handle("desktop:scheduled-task-update", (_event, request) => scheduledTaskStore.update(request));
  ipcMain.handle("desktop:scheduled-task-delete", (_event, request) => scheduledTaskStore.delete(request));
  ipcMain.handle("desktop:scheduled-tasks-run-due", async (_event, request) => { await assertOptionalWorkspace(request?.workspacePath); return scheduledTaskStore.runDue(request, services.automation.scheduledTaskRuntime); });
  ipcMain.handle("desktop:scheduled-task-worker-status", () => services.automation.getScheduledTaskWorkerStatus());
}
