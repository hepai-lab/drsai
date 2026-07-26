import { createHash } from "node:crypto";
import type { IpcMain } from "electron";
import { assertAllowedDesktopPath } from "../../../../shared/main/desktopPathPolicy";
import {
  acceptWorkspaceCheckpoint,
  createWorkspaceCheckpoint,
  listWorkspaceCheckpoints,
  previewWorkspaceCheckpoint,
  restoreWorkspaceCheckpoint,
} from "../../../../shared/main/workspaceCheckpoints";
import { getWorktreeMigrationDiagnostics, listRuntimeWorktreeEvents, listRuntimeWorktrees, prepareForkWorktree } from "../../../../shared/main/worktrees";
import type { MacosServiceContainer } from "../serviceContainer";

export type MacosWorkspaceHistoryIpcServices = Pick<MacosServiceContainer, "workspace" | "approvals">;

/** Registers checkpoint and worktree history operations with path and approval boundaries intact. */
export function registerMacosWorkspaceHistoryIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: MacosWorkspaceHistoryIpcServices,
): void {
  const requestWorkspacePath = (request: unknown) => request && typeof request === "object" ? (request as { workspacePath?: unknown }).workspacePath : undefined;
  const assertDirectory = async (path: unknown) => assertAllowedDesktopPath(path, await services.workspace.allowedRoots(), { directory: true });

  ipcMain.handle("desktop:workspace-checkpoints-list", async (_event, workspacePath) => { await assertDirectory(workspacePath); return listWorkspaceCheckpoints(workspacePath); });
  ipcMain.handle("desktop:workspace-checkpoint-create", async (_event, request) => { await assertDirectory(requestWorkspacePath(request)); return createWorkspaceCheckpoint(request); });
  ipcMain.handle("desktop:workspace-checkpoint-accept", async (_event, request) => { await assertDirectory(requestWorkspacePath(request)); return acceptWorkspaceCheckpoint(request); });
  ipcMain.handle("desktop:workspace-checkpoint-preview", async (_event, request) => { await assertDirectory(requestWorkspacePath(request)); return previewWorkspaceCheckpoint(request); });
  ipcMain.handle("desktop:workspace-checkpoint-restore", async (_event, rawRequest) => {
    if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace checkpoint restore request is incomplete.");
    const value = rawRequest as { workspacePath?: unknown; checkpointId?: unknown; operationId?: unknown; includePaths?: unknown };
    const workspacePath = await assertDirectory(value.workspacePath);
    if (typeof value.checkpointId !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value.checkpointId)) throw new Error("Workspace checkpoint id is invalid.");
    const checkpoint = (await listWorkspaceCheckpoints(workspacePath)).find((item) => item.id === value.checkpointId);
    if (!checkpoint) throw new Error("Workspace checkpoint was not found for this workspace.");
    if (checkpoint.kind === "agent_run_baseline" && checkpoint.reviewStatus !== "pending") throw new Error("Agent run change set has already been reviewed.");
    const operationId = typeof value.operationId === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(value.operationId) ? value.operationId : `restore-${Date.now().toString(36)}`;
    const includePaths = Array.isArray(value.includePaths) ? value.includePaths.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 200) : undefined;
    const stableKey = createHash("sha256").update(`${workspacePath}\0${value.checkpointId}\0${operationId}\0${includePaths?.join("\0") ?? ""}`).digest("hex");
    const request = { workspacePath, checkpointId: value.checkpointId, operationId, ...(includePaths ? { includePaths } : {}) };
    const proposal = await services.approvals.propose({ source: "workspace", actionKind: "workspace.revert", title: "Restore workspace checkpoint", detail: includePaths ? `Restore ${includePaths.join(", ")} from checkpoint ${value.checkpointId}.` : `Restore checkpoint ${value.checkpointId}; captured files may be overwritten or removed.`, target: workspacePath, risk: "high", idempotencyKey: `checkpoint-restore:${stableKey}` }, async () => { await restoreWorkspaceCheckpoint(request); return true; });
    if (proposal.blocked || !proposal.allowed) throw new Error(proposal.reason);
    if (proposal.queued && proposal.approval) return { workspacePath, checkpointId: value.checkpointId, restored: false, restoredFileCount: 0, removedFileCount: 0, skippedFileCount: 0, approvalId: proposal.approval.id, approvalQueued: true, message: "Workspace checkpoint restore is waiting in Approval Center." };
    return { workspacePath, checkpointId: value.checkpointId, restored: true, restoredFileCount: 0, removedFileCount: 0, skippedFileCount: 0, approvalQueued: false, message: "This idempotent checkpoint restore was already executed." };
  });
  ipcMain.handle("desktop:prepare-fork-worktree", async (_event, request) => { await assertDirectory(requestWorkspacePath(request)); return prepareForkWorktree(request); });
  ipcMain.handle("desktop:list-worktrees", async (_event, request) => { await assertDirectory(requestWorkspacePath(request)); return listRuntimeWorktrees(request); });
  ipcMain.handle("desktop:list-worktree-events", async (_event, request) => { await assertDirectory(requestWorkspacePath(request)); return listRuntimeWorktreeEvents(request); });
  ipcMain.handle("desktop:worktree-migration-diagnostics", async (_event, request) => { await assertDirectory(requestWorkspacePath(request)); return getWorktreeMigrationDiagnostics(request); });
}
