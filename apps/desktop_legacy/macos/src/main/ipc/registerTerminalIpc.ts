import { homedir } from "node:os";
import type { IpcMain } from "electron";
import { assertAllowedDesktopPath } from "../../../../shared/main/desktopPathPolicy";
import type { MacosServiceContainer } from "../serviceContainer";
import { createTerminalSession, getTerminalBuffer, killTerminalSession, listTerminalSessions, renameTerminalSession, resizeTerminalSession, writeTerminalSession } from "../terminal";

export function registerMacosTerminalIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: Pick<MacosServiceContainer, "workspace">,
): void {
  ipcMain.handle("desktop:terminal-create", async (event, options = {}) => {
    const rawCwd = options && typeof options === "object" ? (options as { cwd?: unknown }).cwd : undefined;
    const remote = options && typeof options === "object" && typeof (options as { remoteHostAlias?: unknown }).remoteHostAlias === "string";
    const cwd = remote ? (typeof rawCwd === "string" ? rawCwd : "~") : rawCwd === undefined ? homedir() : assertAllowedDesktopPath(rawCwd, await services.workspace.allowedRoots(), { directory: true });
    return createTerminalSession(event, { ...(options as object), cwd });
  });
  ipcMain.handle("desktop:terminal-list", (event, workspaceKey, workspaceId) => listTerminalSessions(event, workspaceKey, workspaceId));
  ipcMain.handle("desktop:terminal-buffer", (event, id) => getTerminalBuffer(event, id));
  ipcMain.handle("desktop:terminal-rename", (event, id, title) => renameTerminalSession(event, id, title));
  ipcMain.handle("desktop:terminal-write", (event, id, data) => writeTerminalSession(event, id, data));
  ipcMain.handle("desktop:terminal-resize", (event, id, cols, rows) => resizeTerminalSession(event, id, cols, rows));
  ipcMain.handle("desktop:terminal-kill", (event, id) => killTerminalSession(event, id));
}
