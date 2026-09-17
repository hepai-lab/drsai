import type { PersistentApprovalStore } from "../../../shared/main/approvalStore";
import type { ScheduledTaskRuntime } from "../../../shared/main/scheduledTasks";

export interface MacosServiceContainer {
  workspace: {
    assertPath(raw: unknown): Promise<string>;
    findByPath(path: string): Promise<{ path: string; location?: string } | undefined>;
    allowedRoots(): Promise<string[]>;
    isRemoteTarget(workspacePath?: string, workspaceId?: string): Promise<boolean>;
    isRemotePath(path: unknown): boolean;
  };
  approvals: Pick<PersistentApprovalStore, "propose" | "list" | "decide">;
  automation: {
    prepareWorkflowRun(request: { templateId: string; workspacePath?: string }, scheduledTriggerKey?: string): Promise<unknown>;
    scheduledTaskRuntime: ScheduledTaskRuntime;
    getScheduledTaskWorkerStatus(): unknown;
  };
}
