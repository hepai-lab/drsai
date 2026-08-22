import { shell, type IpcMain } from "electron";
import { assertThreadSharePath, createThreadShare } from "../../../../shared/main/threadShares";
import {
  addShareComment,
  completeShareCommentTask,
  continueSharedTask,
  createShare,
  createShareCommentTask,
  downloadSharedArtifact,
  inspectShare,
  inspectShareVersion,
  listIncomingShares,
  listOutgoingShares,
  listShareAudit,
  listShareComments,
  listShareCommentTasks,
  openSharedObject,
  previewShareCommentTask,
  publishShareVersion,
  revokeShare,
  updateShareCommentTask,
  updateSharePermission,
} from "../../../../shared/main/shares";

/** Registers the collaboration/share domain without retaining composition-root state. */
export function registerMacosSharingIpc(ipcMain: Pick<IpcMain, "handle">): void {
  ipcMain.handle("desktop:create-thread-share", (_event, request) => createThreadShare(request));
  ipcMain.handle("desktop:open-thread-share", async (_event, path) => { const error = await shell.openPath(assertThreadSharePath(path)); if (error) throw new Error(error); return true; });
  ipcMain.handle("desktop:reveal-thread-share", (_event, path) => { shell.showItemInFolder(assertThreadSharePath(path)); return true; });
  ipcMain.handle("desktop:share-create", (_event, request) => createShare(request));
  ipcMain.handle("desktop:share-inspect", (_event, request) => inspectShare(request));
  ipcMain.handle("desktop:share-permission-update", (_event, request) => updateSharePermission(request));
  ipcMain.handle("desktop:share-revoke", (_event, request) => revokeShare(request));
  ipcMain.handle("desktop:share-version-inspect", (_event, request) => inspectShareVersion(request));
  ipcMain.handle("desktop:share-version-publish", (_event, request) => publishShareVersion(request));
  ipcMain.handle("desktop:share-comments-list", (_event, request) => listShareComments(request));
  ipcMain.handle("desktop:share-comment-add", (_event, request) => addShareComment(request));
  ipcMain.handle("desktop:share-comment-task-preview", (_event, request) => previewShareCommentTask(request));
  ipcMain.handle("desktop:share-comment-task-create", (_event, request) => createShareCommentTask(request));
  ipcMain.handle("desktop:share-comment-task-update", (_event, request) => updateShareCommentTask(request));
  ipcMain.handle("desktop:share-comment-task-complete", (_event, request) => completeShareCommentTask(request));
  ipcMain.handle("desktop:share-comment-tasks-list", (_event, request) => listShareCommentTasks(request));
  ipcMain.handle("desktop:share-continue", (_event, request) => continueSharedTask(request));
  ipcMain.handle("desktop:share-audit-list", (_event, request) => listShareAudit(request));
  ipcMain.handle("desktop:shares-incoming-list", () => listIncomingShares());
  ipcMain.handle("desktop:shares-outgoing-list", () => listOutgoingShares());
  ipcMain.handle("desktop:shared-object-open", (_event, request) => openSharedObject(request));
  ipcMain.handle("desktop:shared-artifact-download", (_event, request) => downloadSharedArtifact(request));
}
