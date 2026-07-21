import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { join } from "node:path";
import { MACOS_PLATFORM_DESCRIPTOR } from "./platform";
import { MACOS_PLATFORM_SERVICES } from "./platformServices";
import { getGatewayStatus, startGateway, stopGateway } from "./gateway";
import {
  createThread,
  getThreadSnapshot,
  listThreads,
  searchThreadMessages,
  updateThread,
  updateThreadSnapshot,
} from "../../../shared/main/threads";
import { configureRuntimeWorkspaceRouting } from "../../../shared/main/runtimeClient";
import {
  createWorkspace,
  deleteWorkspace,
  findWorkspaceById,
  listWorkspaces,
  updateWorkspace,
} from "../../../shared/main/workspaces";
import { abortAgentRun, startAgentRun } from "../../../shared/main/agentRuns";
import { abortChat, startChat } from "../../../shared/main/chat";
import { bootstrapDesktop, getHealth, getInstallStatus, installBundledRuntime } from "./desktopLifecycle";
import { cancelUpdate, checkForUpdates, downloadUpdate, installUpdate, markUpdateHealthy } from "./updater";
import {
  analyzeMaterialConsistency, analyzeMaterialRoles, getWorkspaceContextOverview,
  getWorkspaceGitDiff, getWorkspaceGitFileAtRef, listWorkspaceFiles, previewWorkspaceFile,
  queryMaterials, revertWorkspaceFile, revertWorkspaceHunk, stageWorkspaceFile,
  stageWorkspaceHunk, summarizeWorkspaceFolder,
} from "../../../shared/main/workspaceContext";
import { configureWorkspaceFileDialogs, saveWorkspaceFileAs, writeWorkspaceFile } from "../../../shared/main/workspaceFileMutations";
import { cancelVoiceTranscription, cleanupAllVoiceTempFiles, getVoiceRuntimeStatus, startVoiceTranscription, writeVoiceTranscriptHandoff } from "../../../shared/main/voice";
import { cancelVoiceSynthesis, getVoiceSynthesisRuntimeStatus, startVoiceSynthesis } from "../../../shared/main/voiceTts";
import { runPackagedSmokeIfRequested } from "./packagedSmoke";
import {
  createTerminalSession, getTerminalBuffer, killAllTerminalSessions, killTerminalSession,
  killTerminalSessionsForOwner, listTerminalSessions, renameTerminalSession,
  resizeTerminalSession, writeTerminalSession,
} from "./terminal";
import {
  getPlatformAgentStatus,
  listAgents,
  recordAgentUsage,
  setDefaultAgent,
} from "../../../shared/main/agents";
import {
  cancelDesktopSsoLogin,
  cancelOidcLogin,
  configureAuthPlatform,
  getAuthSession,
  login,
  logout,
  pollDesktopSsoLogin,
  refreshAuthSession,
  startDesktopSsoLogin,
  startOidcLogin,
  startWechatDesktopLogin,
} from "../../../shared/main/auth";

configureAuthPlatform({
  credentials: MACOS_PLATFORM_SERVICES.credentials,
  openExternal: (url) => shell.openExternal(url),
});
configureRuntimeWorkspaceRouting({
  getRemoteGatewayAccess: () => undefined,
  findWorkspaceById,
});
configureWorkspaceFileDialogs({
  selectSavePath: async ({ title, suggestedName, extension }) => {
    const result = await dialog.showSaveDialog({
      title,
      defaultPath: join(app.getPath("downloads"), suggestedName),
      ...(extension ? { filters: [{ name: `${extension.slice(1).toUpperCase()} file`, extensions: [extension.slice(1)] }] } : {}),
    });
    return result.canceled ? null : result.filePath || null;
  },
});

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.once("did-finish-load", () => { void markUpdateHealthy(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  const terminalOwnerId = window.webContents.id;
  window.webContents.once("destroyed", () => killTerminalSessionsForOwner(terminalOwnerId));
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

app.whenReady().then(() => {
  app.setName("OpenDrSai");
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
  ipcMain.handle("desktop:platform-descriptor", () => MACOS_PLATFORM_DESCRIPTOR);
  ipcMain.handle("desktop:bootstrap", () => bootstrapDesktop());
  ipcMain.handle("desktop:get-health", () => getHealth());
  ipcMain.handle("desktop:get-install-status", () => getInstallStatus());
  ipcMain.handle("desktop:start-install", () => installBundledRuntime());
  ipcMain.handle("desktop:cancel-install", () => false);
  ipcMain.handle("desktop:check-for-updates", () => checkForUpdates());
  ipcMain.handle("desktop:download-update", () => downloadUpdate());
  ipcMain.handle("desktop:cancel-update", () => cancelUpdate());
  ipcMain.handle("desktop:install-update", () => installUpdate());
  ipcMain.handle("desktop:terminal-shells", () => MACOS_PLATFORM_SERVICES.terminal.availableShells());
  ipcMain.handle("desktop:clipboard-copy-text", (_event, text) => {
    if (typeof text !== "string" || text.length > 50_000) return false;
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle("desktop:open-external", (_event, url) => typeof url === "string" && url.startsWith("https://") ? shell.openExternal(url).then(() => true) : false);
  ipcMain.handle("desktop:open-path", (_event, path) => typeof path === "string" ? shell.openPath(path).then((error) => !error) : false);
  ipcMain.handle("desktop:pick-files", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("desktop:pick-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle("desktop:terminal-create", (event, options) => createTerminalSession(event, options));
  ipcMain.handle("desktop:terminal-list", (event, workspaceKey, workspaceId) => listTerminalSessions(event, workspaceKey, workspaceId));
  ipcMain.handle("desktop:terminal-buffer", (event, id) => getTerminalBuffer(event, id));
  ipcMain.handle("desktop:terminal-rename", (event, id, title) => renameTerminalSession(event, id, title));
  ipcMain.handle("desktop:terminal-write", (event, id, data) => writeTerminalSession(event, id, data));
  ipcMain.handle("desktop:terminal-resize", (event, id, cols, rows) => resizeTerminalSession(event, id, cols, rows));
  ipcMain.handle("desktop:terminal-kill", (event, id) => killTerminalSession(event, id));
  ipcMain.handle("desktop:get-auth-session", () => getAuthSession());
  ipcMain.handle("desktop:login", (_event, request) => login(request));
  ipcMain.handle("desktop:start-oidc-login", (event, request) =>
    startOidcLogin(request, (debugEvent) => event.sender.send("desktop:oidc-login-debug", debugEvent)),
  );
  ipcMain.handle("desktop:cancel-oidc-login", () => cancelOidcLogin());
  ipcMain.handle("desktop:start-desktop-sso-login", () => startDesktopSsoLogin());
  ipcMain.handle("desktop:start-wechat-desktop-login", () => startWechatDesktopLogin());
  ipcMain.handle("desktop:poll-desktop-sso-login", (_event, deviceCode) => pollDesktopSsoLogin(deviceCode));
  ipcMain.handle("desktop:cancel-desktop-sso-login", (_event, deviceCode) => cancelDesktopSsoLogin(deviceCode));
  ipcMain.handle("desktop:refresh-auth-session", () => refreshAuthSession());
  ipcMain.handle("desktop:logout", (_event, options) => logout(options));
  ipcMain.handle("desktop:get-gateway-status", () => getGatewayStatus());
  ipcMain.handle("desktop:start-gateway", () => startGateway());
  ipcMain.handle("desktop:stop-gateway", () => stopGateway());
  ipcMain.handle("desktop:list-threads", () => listThreads());
  ipcMain.handle("desktop:list-agents", (_event, options) => listAgents(
    options && typeof options === "object" && (options as { refresh?: unknown }).refresh === true
      ? { refresh: true }
      : {},
  ));
  ipcMain.handle("desktop:get-platform-agent-status", () => getPlatformAgentStatus());
  ipcMain.handle("desktop:set-default-agent", (_event, agentId) =>
    setDefaultAgent(typeof agentId === "string" ? agentId : ""));
  ipcMain.handle("desktop:record-agent-usage", (_event, agentId) =>
    recordAgentUsage(typeof agentId === "string" ? agentId : ""));
  ipcMain.handle("desktop:create-thread", (_event, request) => createThread(request));
  ipcMain.handle("desktop:update-thread", (_event, request) => updateThread(request));
  ipcMain.handle("desktop:set-thread-archived", (_event, request: { threadId: string; archived: boolean }) =>
    updateThread({ id: request.threadId, archived: request.archived }),
  );
  ipcMain.handle("desktop:get-thread-snapshot", (_event, threadId) => getThreadSnapshot(threadId));
  ipcMain.handle("desktop:search-thread-messages", (_event, request) => searchThreadMessages(request));
  ipcMain.handle("desktop:update-thread-snapshot", (_event, request) => updateThreadSnapshot(request));
  ipcMain.handle("desktop:list-workspaces", () => listWorkspaces());
  ipcMain.handle("desktop:create-workspace", (_event, request) => createWorkspace(request));
  ipcMain.handle("desktop:update-workspace", (_event, request) => updateWorkspace(request));
  ipcMain.handle("desktop:delete-workspace", (_event, id) => deleteWorkspace(id));
  ipcMain.handle("desktop:workspace-context-overview", (_event, workspacePath) => getWorkspaceContextOverview(workspacePath));
  ipcMain.handle("desktop:workspace-files", (_event, request) => listWorkspaceFiles(request));
  ipcMain.handle("desktop:workspace-folder-summary", (_event, request) => summarizeWorkspaceFolder(request));
  ipcMain.handle("desktop:workspace-file-preview", (_event, request) => previewWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-file-save-as", (_event, request) => saveWorkspaceFileAs(request));
  ipcMain.handle("desktop:workspace-file-write", (_event, request) => writeWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-git-diff", (_event, request) => getWorkspaceGitDiff(request));
  ipcMain.handle("desktop:workspace-git-file-at-ref", (_event, request) => getWorkspaceGitFileAtRef(request));
  ipcMain.handle("desktop:workspace-stage-file", (_event, request) => stageWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-revert-file", (_event, request) => revertWorkspaceFile(request));
  ipcMain.handle("desktop:workspace-stage-hunk", (_event, request) => stageWorkspaceHunk(request));
  ipcMain.handle("desktop:workspace-revert-hunk", (_event, request) => revertWorkspaceHunk(request));
  ipcMain.handle("desktop:material-role-analysis", (_event, request) => analyzeMaterialRoles(request));
  ipcMain.handle("desktop:material-consistency-analysis", (_event, request) => analyzeMaterialConsistency(request));
  ipcMain.handle("desktop:material-query", (_event, request) => queryMaterials(request));
  ipcMain.handle("desktop:voice-transcription-start", (event, request) => startVoiceTranscription(event.sender, request));
  ipcMain.handle("desktop:voice-transcription-cancel", (_event, requestId) => cancelVoiceTranscription(requestId));
  ipcMain.handle("desktop:voice-runtime-status", () => getVoiceRuntimeStatus());
  ipcMain.handle("desktop:voice-synthesis-start", (event, request) => startVoiceSynthesis(event.sender, request));
  ipcMain.handle("desktop:voice-synthesis-cancel", (_event, requestId) => cancelVoiceSynthesis(requestId));
  ipcMain.handle("desktop:voice-synthesis-runtime-status", () => getVoiceSynthesisRuntimeStatus());
  ipcMain.handle("desktop:voice-handoff-write", (_event, request) => writeVoiceTranscriptHandoff(request));
  ipcMain.handle("desktop:start-agent-run", (event, request) => startAgentRun(event.sender, request));
  ipcMain.handle("desktop:abort-agent-run", (_event, requestId) => abortAgentRun(requestId));
  ipcMain.handle("desktop:start-chat", (event, request) => startChat(event.sender, request));
  ipcMain.handle("desktop:abort-chat", (_event, requestId) => abortChat(requestId));
  const window = createWindow();
  runPackagedSmokeIfRequested(window);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  killAllTerminalSessions();
  cleanupAllVoiceTempFiles();
});
app.on("window-all-closed", () => app.quit());
