import type {
  AuthSession,
  AgentRunEvent,
  ChatEvent,
  DesktopApi,
  DesktopHealth,
  DesktopThread,
  InstallProgress,
  UpdateStatus,
} from "@shared/desktopApi";

type Listener<T> = (value: T) => void;

const initialHealth: DesktopHealth = {
  installed: true,
  gatewayReady: true,
  mode: "local",
  version: "0.1.0-dev",
  install: {
    installed: true,
    home: "C:\\Users\\Demo\\.drsai",
    repoPath: "C:\\Users\\Demo\\.drsai\\drsai-agent",
    pythonPath: "C:\\Users\\Demo\\.drsai\\drsai-agent\\venv\\Scripts\\python.exe",
    scriptPath: "C:\\Users\\Demo\\.drsai\\drsai-agent\\venv\\Scripts\\drsai.cmd",
    version: "0.1.0-dev",
    expectedVersion: null,
    backendNeedsRepair: false,
    bundledBackendAvailable: true,
    configExists: true,
    envExists: true,
    apiKeyConfigured: true,
    prerequisites: {
      pythonOnPath: true,
      pythonVersion: "3.11",
      pythonCommand: "C:\\Users\\Demo\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
      gitOnPath: true,
      gitVersion: "git version 2.45.0.windows.1",
      gitCommand: "C:\\Program Files\\Git\\cmd\\git.exe",
      apiKeyConfigured: true,
      problems: [],
    },
    missing: [],
  },
  gateway: {
    ready: true,
    managed: true,
    externalReady: true,
    externalConflict: false,
    baseUrl: "http://127.0.0.1:8642",
    pid: 4242,
    lastLog: "",
  },
  update: {
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: null,
    version: null,
    error: null,
  },
};

const anonymousSession: AuthSession = {
  authenticated: false,
  user: null,
  expiresAt: null,
  authMode: null,
};

export function installMockDesktopApi(): void {
  if (window.openDrSai) return;
  let health = structuredClone(initialHealth);
  let authSession = structuredClone(anonymousSession);
  let pendingAuthProvider: AuthSession["authProvider"] = "ihep";
  let threads: DesktopThread[] = [];
  const chatListeners = new Set<Listener<ChatEvent>>();
  const agentRunListeners = new Set<Listener<AgentRunEvent>>();
  const installListeners = new Set<Listener<InstallProgress>>();
  const updateListeners = new Set<Listener<UpdateStatus>>();

  const api: DesktopApi = {
    getAuthSession: async () => authSession,
    login: async (request) => {
      if (request.developerBypass) {
        authSession = {
          authenticated: true,
          user: {
            id: "mock-developer",
            email: "developer@opendrsai.local",
            name: "Developer",
            role: "admin",
          },
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          authMode: "offline",
        };
        return { ok: true, session: authSession, message: "Mock developer workspace unlocked." };
      }
      const apiKey = request.apiKey?.trim();
      const email = request.email?.trim();
      if (!apiKey && !(email && request.password)) {
        return { ok: false, session: null, message: "Enter an API key, or an email and password." };
      }
      authSession = {
        authenticated: true,
        user: {
          id: apiKey ? "mock-api-user" : "mock-password-user",
          email: email || "local@opendrsai.desktop",
          name: email ? email.split("@")[0] : "Local API Key User",
          role: "user",
        },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        authMode: apiKey ? "api_key" : "password",
      };
      if (apiKey) {
        health = {
          ...health,
          install: {
            ...health.install,
            apiKeyConfigured: true,
            prerequisites: {
              ...health.install.prerequisites,
              apiKeyConfigured: true,
            },
          },
        };
      }
      return { ok: true, session: authSession, message: "Mock sign-in complete." };
    },
    startDesktopSsoLogin: async () => {
      pendingAuthProvider = "ihep";
      return {
        ok: true,
        message: "Mock browser SSO started.",
        deviceCode: "mock-device-code",
        loginUrl: "https://opendrsai.ihep.ac.cn/api/desktop-auth/login?device_code=mock",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        intervalSeconds: 1,
      };
    },
    startWechatDesktopLogin: async () => {
      pendingAuthProvider = "wechat";
      return {
        ok: true,
        message: "Mock WeChat login started.",
        deviceCode: "mock-wechat-device-code",
        loginUrl: "https://opendrsai.ihep.ac.cn/api/desktop-auth/wechat/callback?code=mock&state=mock",
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        intervalSeconds: 1,
      };
    },
    pollDesktopSsoLogin: async () => {
      const provider = pendingAuthProvider || "ihep";
      authSession = {
        authenticated: true,
        user: {
          id: provider === "wechat" ? "wechat:mock-openid" : "mock-sso-user",
          email: provider === "wechat" ? "wechat:mock-openid" : "mock-sso@ihep.ac.cn",
          name: provider === "wechat" ? "Mock WeChat User" : "mock-sso@ihep.ac.cn",
          role: "user",
        },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        accessTokenExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        refreshable: true,
        authMode: "sso",
        authProvider: provider,
      };
      pendingAuthProvider = "ihep";
      return {
        ok: true,
        state: "authorized",
        message: "Mock SSO complete.",
        session: authSession,
      };
    },
    cancelDesktopSsoLogin: async () => true,
    logout: async () => {
      authSession = structuredClone(anonymousSession);
      health = { ...health, gatewayReady: false, gateway: { ...health.gateway, ready: false } };
      return { ok: true, message: "Mock sign-out complete." };
    },
    refreshAuthSession: async () => authSession,
    getHealth: async () => health,
    getInstallStatus: async () => health.install,
    getGatewayStatus: async () => health.gateway,
    checkForUpdates: async () => {
      health = {
        ...health,
        update: {
          checking: false,
          available: true,
          downloading: false,
          downloaded: false,
          progress: null,
          version: "0.1.1",
          error: null,
        },
      };
      emit(updateListeners, health.update);
      return health.update;
    },
    downloadUpdate: async () => {
      for (const progress of [20, 55, 100]) {
        health = {
          ...health,
          update: {
            checking: false,
            available: true,
            downloading: progress < 100,
            downloaded: progress === 100,
            progress,
            version: "0.1.1",
            error: null,
          },
        };
        emit(updateListeners, health.update);
        await delay(120);
      }
      return health.update;
    },
    installUpdate: async () => {
      health = {
        ...health,
        update: { ...health.update, error: "Mock install requested." },
      };
      emit(updateListeners, health.update);
    },
    startInstall: async (options) => {
      emit(installListeners, {
        phase: "complete",
        message: options?.installPrerequisites
          ? "Mock installation complete with prerequisites."
          : "Mock installation complete.",
        log: "Validated renderer install-progress state.",
        logFile: "C:\\Users\\Demo\\.drsai\\logs\\desktop-install-mock.log",
        exitCode: 0,
      });
    },
    cancelInstall: async () => {
      emit(installListeners, {
        phase: "error",
        message: "Mock installation cancelled.",
        log: "Cancelled by renderer.",
        exitCode: 1,
      });
      return true;
    },
    startGateway: async () => {
      health = { ...health, gatewayReady: true, gateway: { ...health.gateway, ready: true } };
      return true;
    },
    stopGateway: async () => {
      health = { ...health, gatewayReady: false, gateway: { ...health.gateway, ready: false } };
      return true;
    },
    listThreads: async () => threads,
    createThread: async (request) => {
      const now = new Date().toISOString();
      const thread = {
        id: `thread-${crypto.randomUUID()}`,
        kind: request.kind,
        title: request.title || (request.kind === "agent_run" ? "Agent run" : "New chat"),
        workspacePath: request.workspacePath,
        createdAt: now,
        updatedAt: now,
        status: "idle" as const,
        messageCount: 0,
      };
      threads = [thread, ...threads];
      return thread;
    },
    updateThread: async (request) => {
      const now = new Date().toISOString();
      const existing = threads.find((thread) => thread.id === request.id);
      const thread = {
        id: request.id,
        kind: request.kind || existing?.kind || "chat",
        title: request.title || existing?.title || "New chat",
        workspacePath: request.workspacePath ?? existing?.workspacePath,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        lastRunId: request.lastRunId ?? existing?.lastRunId,
        lastRequestId: request.lastRequestId ?? existing?.lastRequestId,
        status: request.status ?? existing?.status ?? "idle",
        messageCount: request.messageCount ?? existing?.messageCount,
      };
      threads = [thread, ...threads.filter((item) => item.id !== request.id)];
      return thread;
    },
    startChat: async () => {
      const requestId = crypto.randomUUID();
      emit(chatListeners, { requestId, type: "start" });
      for (const content of [
        "Mock **desktop** chat stream.\n\n",
        "| item | status |\n| --- | --- |\n| renderer | ok |\n\n",
        "[OpenDrSai](https://github.com/hepai-lab/drsai)",
      ]) {
        await delay(90);
        emit(chatListeners, { requestId, type: "chunk", content });
      }
      emit(chatListeners, { requestId, type: "done" });
      return requestId;
    },
    abortChat: async (requestId) => {
      emit(chatListeners, { requestId, type: "aborted" });
      return true;
    },
    startAgentRun: async (request) => {
      const requestId = request.requestId || crypto.randomUUID();
      const sessionId = request.sessionId || requestId;
      const runId = request.runId || requestId;
      emit(agentRunListeners, { requestId, sessionId, runId, type: "start" });
      for (const content of [
        "Mock agent run started.\n\n",
        request.task,
        "\n\nMock agent run complete.",
      ]) {
        await delay(90);
        emit(agentRunListeners, { requestId, sessionId, runId, type: "chunk", content });
      }
      emit(agentRunListeners, { requestId, sessionId, runId, type: "done" });
      return { requestId, sessionId, runId };
    },
    abortAgentRun: async (requestId) => {
      emit(agentRunListeners, {
        requestId,
        sessionId: requestId,
        runId: requestId,
        type: "aborted",
      });
      return true;
    },
    saveApiKey: async (apiKey) => {
      const ok = Boolean(apiKey.trim()) && !/[\r\n]/.test(apiKey);
      health = {
        ...health,
        install: {
          ...health.install,
          apiKeyConfigured: ok || health.install.apiKeyConfigured,
          missing: ok ? [] : health.install.missing,
          prerequisites: {
            ...health.install.prerequisites,
            apiKeyConfigured: ok || health.install.prerequisites.apiKeyConfigured,
            problems: ok ? [] : health.install.prerequisites.problems,
          },
        },
      };
      return { ok, message: ok ? "Mock API key saved." : "API key must be a single line." };
    },
    pickFiles: async () => ({
      canceled: false,
      paths: ["C:\\Users\\Demo\\Documents\\example.pdf"],
    }),
    pickFolder: async () => ({
      canceled: false,
      paths: ["C:\\Users\\Demo\\Documents\\research-folder"],
    }),
    openExternal: async () => undefined,
    openPath: async () => "",
    onInstallProgress: (callback) => subscribe(installListeners, callback),
    onChatEvent: (callback) => subscribe(chatListeners, callback),
    onAgentRunEvent: (callback) => subscribe(agentRunListeners, callback),
    onUpdateStatus: (callback) => subscribe(updateListeners, callback),
  };

  window.openDrSai = api;
}

function subscribe<T>(listeners: Set<Listener<T>>, callback: Listener<T>): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emit<T>(listeners: Set<Listener<T>>, value: T): void {
  listeners.forEach((listener) => listener(value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
