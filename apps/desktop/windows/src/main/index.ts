import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "fs";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import { is } from "@electron-toolkit/utils";
import { cancelInstall, startInstall } from "./install";
import {
  getGatewayStatus,
  shutdownGateway,
  startGateway,
  stopGateway,
} from "./gateway";
import { getDesktopHealth, getInstallStatus } from "./status";
import { DRSAI_HOME } from "./paths";
import { checkForUpdates, subscribeUpdateStatus } from "./updates";
import { abortChat, startChat } from "./chat";
import { abortAgentRun, startAgentRun } from "./agentRuns";
import { createThread, listThreads, updateThread } from "./threads";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "./workspaces";
import {
  getWorkspaceContextOverview,
  getWorkspaceGitDiff,
  listWorkspaceFiles,
  previewWorkspaceFile,
} from "./workspaceContext";
import { saveApiKey } from "./settings";
import {
  cancelOidcLogin,
  cancelDesktopSsoLogin,
  getAuthSession,
  login,
  logout,
  pollDesktopSsoLogin,
  refreshAuthSession,
  requireAuthContext,
  startDesktopSsoLogin,
  startOidcLogin,
  startWechatDesktopLogin,
} from "./auth";
import { maybeRunE2eSmoke } from "./e2eSmoke";
import {
  createTerminalSession,
  getTerminalBuffer,
  killAllTerminalSessions,
  killTerminalSession,
  listTerminalSessions,
  renameTerminalSession,
  resizeTerminalSession,
  writeTerminalSession,
} from "./terminal";
import type { TerminalCreateOptions } from "./terminal";

let mainWindow: BrowserWindow | null = null;
let browserWebContentsPolicyRegistered = false;

const rendererHtmlPath = join(__dirname, "../renderer/index.html");
const TRUSTED_DEV_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const TRUSTED_BROWSER_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

if (process.env.OPENDRSAI_E2E_DISABLE_GPU === "1") {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app.commandLine.appendSwitch("disable-features", "VizDisplayCompositor");
}

function createWindow(): void {
  const windowIcon = getWindowIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "OpenDrSai",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#fafafe",
      symbolColor: "#5f5870",
      height: 34,
    },
    backgroundColor: "#fafafe",
    show: false,
    ...(windowIcon ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      const check = checkBrowserUrlSync(params.src);
      if (!check.allowed) {
        event.preventDefault();
        return;
      }
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.allowRunningInsecureContent = false;
    },
  );
  registerBrowserWebContentsPolicy();

  maybeRunE2eSmoke(mainWindow);

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    if (!isAllowedDevRendererUrl(process.env.ELECTRON_RENDERER_URL)) {
      throw new Error(
        "ELECTRON_RENDERER_URL must point at localhost in development.",
      );
    }
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(rendererHtmlPath);
  }
}

function registerBrowserWebContentsPolicy(): void {
  if (browserWebContentsPolicyRegistered) return;
  browserWebContentsPolicyRegistered = true;
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() !== "webview") return;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!checkBrowserUrlSync(url).allowed) event.preventDefault();
    });
    contents.on("will-redirect", (event, url) => {
      if (!checkBrowserUrlSync(url).allowed) event.preventDefault();
    });
    contents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => {
        callback(false);
      },
    );
    contents.session.on("will-download", (event) => {
      event.preventDefault();
    });
  });
}

function getWindowIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "icon.png")]
    : [
        join(__dirname, "../../build/icon.png"),
        join(process.cwd(), "build", "icon.png"),
      ];

  return candidates.find((candidate) => existsSync(candidate));
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isAllowedDevRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "http:" &&
      TRUSTED_DEV_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function checkBrowserUrlSync(rawUrl: unknown): {
  allowed: boolean;
  reason: string;
  normalizedUrl?: string;
  scope: "local" | "workspace-file" | "public" | "blocked";
} {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      allowed: false,
      reason: "Enter a URL to preview.",
      scope: "blocked",
    };
  }

  try {
    const url = new URL(rawUrl.trim());
    if (url.username || url.password) {
      return {
        allowed: false,
        reason: "Browser preview does not allow credentials in URLs.",
        scope: "blocked",
      };
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (TRUSTED_BROWSER_HOSTS.has(url.hostname)) {
        return {
          allowed: true,
          reason: "Local development URL allowed.",
          normalizedUrl: url.toString(),
          scope: "local",
        };
      }
      if (url.protocol === "https:") {
        return {
          allowed: true,
          reason: "Public HTTPS URL allowed.",
          normalizedUrl: url.toString(),
          scope: "public",
        };
      }
      return {
        allowed: false,
        reason: "Public browser preview requires HTTPS.",
        normalizedUrl: url.toString(),
        scope: "public",
      };
    }
    if (url.protocol === "file:") {
      return {
        allowed: false,
        reason:
          "Use workspace file previews through the OpenDrSai file preview flow.",
        normalizedUrl: url.toString(),
        scope: "workspace-file",
      };
    }
    return {
      allowed: false,
      reason: "Only http, https, and workspace file previews are supported.",
      scope: "blocked",
    };
  } catch {
    return {
      allowed: false,
      reason: "The browser URL is not valid.",
      scope: "blocked",
    };
  }
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents) return false;
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) return false;
  if (frameUrl === mainWindow.webContents.getURL()) return true;
  if (is.dev) return isAllowedDevRendererUrl(frameUrl);
  return false;
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedSender(event)) {
    throw new Error("Blocked untrusted desktop IPC caller.");
  }
}

function secureHandle<T extends unknown[]>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: T) => {
    assertTrustedSender(event);
    return handler(event, ...args);
  });
}

function isAllowedLocalPath(rawPath: unknown): boolean {
  if (typeof rawPath !== "string" || !rawPath) return false;
  if (!existsSync(rawPath)) return false;
  const root = realpathSync.native(resolve(DRSAI_HOME));
  const target = realpathSync.native(resolve(rawPath));
  const localRelative = relative(root, target);
  return (
    localRelative === "" ||
    (!localRelative.startsWith("..") && !isAbsolute(localRelative))
  );
}

async function isAllowedOpenPath(rawPath: unknown): Promise<boolean> {
  if (isAllowedLocalPath(rawPath)) return true;
  if (typeof rawPath !== "string" || !rawPath || !existsSync(rawPath))
    return false;
  const target = realpathSync.native(resolve(rawPath));
  const workspaces = await listWorkspaces();
  return workspaces.some((workspace) => {
    if (!existsSync(workspace.path)) return false;
    const root = realpathSync.native(resolve(workspace.path));
    const relativePath = relative(root, target);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
  });
}

function registerIpc(): void {
  secureHandle("desktop:get-auth-session", () => getAuthSession());
  secureHandle("desktop:login", (_event, request) => login(request));
  secureHandle("desktop:start-oidc-login", (_event, request) =>
    startOidcLogin(request),
  );
  secureHandle("desktop:cancel-oidc-login", () => cancelOidcLogin());
  secureHandle("desktop:start-desktop-sso-login", () => startDesktopSsoLogin());
  secureHandle("desktop:start-wechat-desktop-login", () =>
    startWechatDesktopLogin(),
  );
  secureHandle("desktop:poll-desktop-sso-login", (_event, deviceCode: string) =>
    pollDesktopSsoLogin(deviceCode),
  );
  secureHandle(
    "desktop:cancel-desktop-sso-login",
    (_event, deviceCode: string) => cancelDesktopSsoLogin(deviceCode),
  );
  secureHandle("desktop:logout", (_event, options) => {
    stopGateway();
    return logout(options);
  });
  secureHandle("desktop:refresh-auth-session", () => refreshAuthSession());
  secureHandle("desktop:get-health", () => getDesktopHealth());
  secureHandle("desktop:get-install-status", () => getInstallStatus());
  secureHandle("desktop:get-gateway-status", () => getGatewayStatus());
  secureHandle("desktop:check-for-updates", (event) => {
    subscribeUpdateStatus(event.sender);
    return checkForUpdates();
  });

  secureHandle("desktop:open-external", async (_event, rawUrl: string) => {
    if (!isAllowedExternalUrl(rawUrl)) return;
    await shell.openExternal(rawUrl);
  });

  secureHandle("desktop:open-path", async (_event, rawPath: string) => {
    if (!(await isAllowedOpenPath(rawPath))) {
      return "Path is not registered as a DrSai or workspace path.";
    }
    return shell.openPath(rawPath);
  });

  secureHandle("desktop:start-install", async (event, options) => {
    await startInstall(event.sender, options ?? {});
  });
  secureHandle("desktop:cancel-install", () => cancelInstall());

  secureHandle("desktop:start-gateway", () => startGateway());
  secureHandle("desktop:stop-gateway", () => stopGateway());
  secureHandle(
    "desktop:terminal-create",
    (event, options: TerminalCreateOptions | undefined) =>
      createTerminalSession(event, options),
  );
  secureHandle("desktop:terminal-list", (event, workspaceKey?: string) =>
    listTerminalSessions(event, workspaceKey),
  );
  secureHandle("desktop:terminal-buffer", (event, id: string) =>
    getTerminalBuffer(event, id),
  );
  secureHandle("desktop:terminal-rename", (event, id: string, title: string) =>
    renameTerminalSession(event, id, title),
  );
  secureHandle("desktop:terminal-write", (event, id: string, data: string) =>
    writeTerminalSession(event, id, data),
  );
  secureHandle(
    "desktop:terminal-resize",
    (event, id: string, cols: number, rows: number) =>
      resizeTerminalSession(event, id, cols, rows),
  );
  secureHandle("desktop:terminal-kill", (event, id: string) =>
    killTerminalSession(event, id),
  );
  secureHandle("desktop:list-workspaces", () => listWorkspaces());
  secureHandle("desktop:create-workspace", (_event, request) =>
    createWorkspace(request),
  );
  secureHandle("desktop:update-workspace", (_event, request) =>
    updateWorkspace(request),
  );
  secureHandle("desktop:delete-workspace", (_event, id: string) =>
    deleteWorkspace(id),
  );
  secureHandle("desktop:workspace-context-overview", (_event, workspacePath: string) =>
    getWorkspaceContextOverview(workspacePath),
  );
  secureHandle("desktop:workspace-files", (_event, request) =>
    listWorkspaceFiles(request),
  );
  secureHandle("desktop:workspace-file-preview", (_event, request) =>
    previewWorkspaceFile(request),
  );
  secureHandle("desktop:workspace-git-diff", (_event, request) =>
    getWorkspaceGitDiff(request),
  );
  secureHandle("desktop:list-threads", () => listThreads());
  secureHandle("desktop:create-thread", (_event, request) =>
    createThread(request),
  );
  secureHandle("desktop:update-thread", (_event, request) =>
    updateThread(request),
  );
  secureHandle("desktop:start-chat", (event, request) =>
    startChat(event.sender, request),
  );
  secureHandle("desktop:abort-chat", (_event, requestId: string) =>
    abortChat(requestId),
  );
  secureHandle("desktop:start-agent-run", (event, request) =>
    startAgentRun(event.sender, request),
  );
  secureHandle("desktop:abort-agent-run", (_event, requestId: string) =>
    abortAgentRun(requestId),
  );
  secureHandle("desktop:save-api-key", (_event, apiKey: string) =>
    saveApiKey(apiKey),
  );
  secureHandle("desktop:pick-files", async () => {
    if (!mainWindow) return { canceled: true, paths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add files",
      properties: ["openFile", "multiSelections"],
    });
    return { canceled: result.canceled, paths: result.filePaths };
  });
  secureHandle("desktop:pick-folder", async () => {
    if (!mainWindow) return { canceled: true, paths: [] };
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Add folder",
      properties: ["openDirectory"],
    });
    return { canceled: result.canceled, paths: result.filePaths };
  });
  secureHandle("desktop:browser-check-url", (_event, rawUrl: string) =>
    checkBrowserUrlSync(rawUrl),
  );
  secureHandle("desktop:browser-action-request", (_event, request) => {
    if (!request || typeof request !== "object") {
      return {
        ok: false,
        action: "snapshot",
        message: "Invalid browser action request.",
      };
    }
    const action = String(
      (request as { action?: unknown }).action || "snapshot",
    );
    const allowedActions = new Set([
      "open",
      "snapshot",
      "screenshot",
      "read_text",
      "eval_readonly",
      "click",
      "type",
      "select",
      "key_press",
      "wait_for",
      "assert_text",
    ]);
    if (!allowedActions.has(action)) {
      return { ok: false, action, message: "Unsupported browser action." };
    }
    if (action === "open") {
      const check = checkBrowserUrlSync((request as { url?: unknown }).url);
      return {
        ok: check.allowed,
        action,
        message: check.reason,
        url: check.normalizedUrl,
      };
    }
    if (
      action === "click" ||
      action === "type" ||
      action === "select" ||
      action === "key_press"
    ) {
      const typedRequest = request as {
        approved?: unknown;
        selector?: unknown;
        text?: unknown;
        value?: unknown;
        key?: unknown;
      };
      if (typedRequest.approved !== true) {
        return {
          ok: false,
          action,
          message: "Interactive browser actions require explicit approval.",
        };
      }
      const selector = typedRequest.selector;
      if (
        action !== "key_press" &&
        (typeof selector !== "string" ||
          !selector.trim() ||
          selector.length > 500 ||
          /[\r\n]/.test(selector))
      ) {
        return {
          ok: false,
          action,
          message: "Interactive browser action selector is invalid.",
        };
      }
      if (
        (action === "type" || action === "select") &&
        (typeof typedRequest.text !== "string" ||
          typedRequest.text.length > 4000)
      ) {
        return {
          ok: false,
          action,
          message: "Interactive browser action text is invalid.",
        };
      }
      if (
        action === "key_press" &&
        (typeof typedRequest.key !== "string" ||
          !typedRequest.key.trim() ||
          typedRequest.key.length > 80)
      ) {
        return {
          ok: false,
          action,
          message: "Interactive browser action key is invalid.",
        };
      }
      return {
        ok: true,
        action,
        message: `Approved browser ${action} action accepted by the desktop bridge.`,
      };
    }
    return {
      ok: true,
      action,
      message: "Browser action accepted by the desktop bridge.",
    };
  });
}

async function autoStartGatewayWhenInstalled(): Promise<void> {
  try {
    const install = await getInstallStatus();
    if (!install.installed) return;
    await startGateway();
  } catch (error) {
    console.warn(
      "[desktop] Gateway autostart skipped:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

app.whenReady().then(() => {
  if (process.env.OPENDRSAI_E2E_OIDC_HEADLESS === "1") {
    void runHeadlessOidcSmoke();
    return;
  }
  registerIpc();
  createWindow();
  void autoStartGatewayWhenInstalled();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      void autoStartGatewayWhenInstalled();
    }
  });
});

async function runHeadlessOidcSmoke(): Promise<void> {
  const resultPath = process.env.OPENDRSAI_E2E_RESULT;
  if (!resultPath) {
    app.exit(1);
    return;
  }
  const result: {
    ok: boolean;
    checks: Record<string, boolean>;
    details: Record<string, unknown>;
    error?: string;
  } = { ok: false, checks: {}, details: {} };
  try {
    const loginResult = await startOidcLogin({ rememberMe: true });
    result.details.login = {
      ok: loginResult.ok,
      message: loginResult.message,
      session: loginResult.session,
    };
    result.checks.oidcLoginOk = Boolean(loginResult.ok);
    result.checks.oidcPublicSession = publicSessionLooksHeadlessOidc(
      loginResult.session,
    );

    const restored = await getAuthSession();
    result.details.restored = restored;
    result.checks.restoredSession = publicSessionLooksHeadlessOidc(restored);

    const refreshed = await refreshAuthSession();
    result.details.refreshed = refreshed;
    result.checks.refreshSession = publicSessionLooksHeadlessOidc(refreshed);

    const authContext = await requireAuthContext();
    result.details.authContext = {
      userId: authContext.userId,
      authMode: authContext.authMode,
      hasAccessToken: Boolean(authContext.accessToken),
      publicSession: authContext.session,
    };
    result.checks.authContextUsesOidc = authContext.authMode === "oidc";
    result.checks.authContextHasBearerToken = Boolean(authContext.accessToken);
    result.checks.authContextPublicSession = publicSessionLooksHeadlessOidc(
      authContext.session,
    );

    const storage = readHeadlessOidcStorage();
    result.details.storage = storage.details;
    result.checks.sessionFileExists = storage.checks.exists;
    result.checks.sessionUsesEncryptedTokens =
      storage.checks.usesEncryptedTokens;
    result.checks.sessionOmitsPlainTokens = storage.checks.omitsPlainTokens;

    const logoutResult = await logout({ clearLocalData: false });
    result.details.logout = logoutResult;
    result.checks.logoutOk = Boolean(logoutResult.ok);
    const afterLogout = await getAuthSession();
    result.details.afterLogout = afterLogout;
    result.checks.afterLogoutAnonymous = Boolean(
      afterLogout.authenticated === false,
    );
    result.checks.logoutClearsSessionFile = !existsSync(
      join(DRSAI_HOME, "auth", "session.json"),
    );

    result.ok = Object.values(result.checks).every(Boolean);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  app.exit(result.ok ? 0 : 1);
}

function publicSessionLooksHeadlessOidc(
  session: Awaited<ReturnType<typeof getAuthSession>> | null,
): boolean {
  if (!session) return false;
  const asRecord = session as unknown as Record<string, unknown>;
  return Boolean(
    session.authenticated === true &&
    session.authMode === "oidc" &&
    session.authProvider === "hai" &&
    session.user &&
    session.user.id === "e2e-hai-user" &&
    session.user.email === "e2e-hai-user@ihep.ac.cn" &&
    session.refreshable === true &&
    !("accessToken" in asRecord) &&
    !("refreshToken" in asRecord) &&
    !("idToken" in asRecord),
  );
}

function readHeadlessOidcStorage(): {
  checks: {
    exists: boolean;
    usesEncryptedTokens: boolean;
    omitsPlainTokens: boolean;
  };
  details: Record<string, unknown>;
} {
  const sessionPath = join(DRSAI_HOME, "auth", "session.json");
  if (!existsSync(sessionPath)) {
    return {
      checks: {
        exists: false,
        usesEncryptedTokens: false,
        omitsPlainTokens: false,
      },
      details: { sessionPath, exists: false },
    };
  }
  const parsed = JSON.parse(readFileSync(sessionPath, "utf8")) as Record<
    string,
    unknown
  >;
  return {
    checks: {
      exists: true,
      usesEncryptedTokens: Boolean(
        parsed.encryptedAccessToken &&
        parsed.encryptedRefreshToken &&
        parsed.encryptedIdToken,
      ),
      omitsPlainTokens:
        !("accessToken" in parsed) &&
        !("refreshToken" in parsed) &&
        !("idToken" in parsed),
    },
    details: {
      sessionPath,
      exists: true,
      keys: Object.keys(parsed).sort(),
      authMode: parsed.authMode,
      authProvider: parsed.authProvider,
      hasEncryptedAccessToken: Boolean(parsed.encryptedAccessToken),
      hasEncryptedRefreshToken: Boolean(parsed.encryptedRefreshToken),
      hasEncryptedIdToken: Boolean(parsed.encryptedIdToken),
      hasPlainAccessToken: "accessToken" in parsed,
      hasPlainRefreshToken: "refreshToken" in parsed,
      hasPlainIdToken: "idToken" in parsed,
    },
  };
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  killAllTerminalSessions();
  shutdownGateway();
});
