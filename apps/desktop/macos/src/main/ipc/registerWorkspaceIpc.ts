import type { IpcMain } from "electron";
import { remoteWorkspaceController } from "../../../../shared/main/remoteWorkspaceController";
import {
  getWorkspaceContextOverview,
  getWorkspaceGitDiff,
  getWorkspaceGitFileAtRef,
  listWorkspaceFiles,
  previewWorkspaceFile,
  revertWorkspaceFile,
  revertWorkspaceHunk,
  stageWorkspaceFile,
  stageWorkspaceHunk,
  summarizeWorkspaceFolder,
} from "../../../../shared/main/workspaceContext";
import { saveWorkspaceFileAs, writeWorkspaceFile } from "../../../../shared/main/workspaceFileMutations";
import type { MacosServiceContainer } from "../serviceContainer";

export type MacosWorkspaceIpcServices = Pick<MacosServiceContainer, "workspace">;

/** Routes Workspace file and Git operations to local services or the active Remote Gateway. */
export function registerMacosWorkspaceIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: MacosWorkspaceIpcServices,
): void {
  const isRemote = (request: { workspacePath?: string; workspaceId?: string } | undefined) =>
    services.workspace.isRemoteTarget(request?.workspacePath, request?.workspaceId);

  ipcMain.handle("desktop:workspace-context-overview", async (_event, workspacePath) =>
    await services.workspace.isRemoteTarget(workspacePath) ? remoteWorkspaceController.contextOverview(workspacePath) : getWorkspaceContextOverview(workspacePath));
  ipcMain.handle("desktop:workspace-files", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.listFiles(request) : listWorkspaceFiles(request));
  ipcMain.handle("desktop:workspace-folder-summary", (_event, request) =>
    services.workspace.isRemotePath(request?.path) ? remoteWorkspaceController.folderSummary(request) : summarizeWorkspaceFolder(request));
  ipcMain.handle("desktop:workspace-file-preview", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.previewFile(request) : previewWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-file-save-as", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.writeFile(request) : saveWorkspaceFileAs(request));
  ipcMain.handle("desktop:workspace-file-write", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.writeFile(request) : writeWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-git-diff", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.gitDiff(request) : getWorkspaceGitDiff(request));
  ipcMain.handle("desktop:workspace-git-file-at-ref", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.gitFileAtRef(request) : getWorkspaceGitFileAtRef(request));
  ipcMain.handle("desktop:workspace-stage-file", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.mutateGit("stage-file", request) : stageWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-revert-file", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.mutateGit("revert-file", request) : revertWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-stage-hunk", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.mutateGit("stage-hunk", request) : stageWorkspaceHunk(request));
  ipcMain.handle("desktop:workspace-revert-hunk", async (_event, request) =>
    await isRemote(request) ? remoteWorkspaceController.mutateGit("revert-hunk", request) : revertWorkspaceHunk(request));
}
