import type {
  AuthSession,
  AgentRunEvent,
  ChatEvent,
  DesktopApi,
  DesktopHealth,
  DesktopThread,
  InstallProgress,
  TerminalSessionInfo,
  UpdateStatus,
  WorkspaceContextOverview,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceFileTreeResult,
  WorkspaceGitDiffResult,
  WorkspaceProject,
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
    pythonPath:
      "C:\\Users\\Demo\\.drsai\\drsai-agent\\venv\\Scripts\\python.exe",
    scriptPath:
      "C:\\Users\\Demo\\.drsai\\drsai-agent\\venv\\Scripts\\drsai.cmd",
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
      pythonCommand:
        "C:\\Users\\Demo\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
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
  let workspaces: WorkspaceProject[] = [];
  let terminalSessions: TerminalSessionInfo[] = [];
  let terminalCounter = 0;
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
          expiresAt: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          authMode: "offline",
        };
        return {
          ok: true,
          session: authSession,
          message: "Mock developer workspace unlocked.",
        };
      }
      const apiKey = request.apiKey?.trim();
      const email = request.email?.trim();
      if (!apiKey && !(email && request.password)) {
        return {
          ok: false,
          session: null,
          message: "Enter an API key, or an email and password.",
        };
      }
      authSession = {
        authenticated: true,
        user: {
          id: apiKey ? "mock-api-user" : "mock-password-user",
          email: email || "local@opendrsai.desktop",
          name: email ? email.split("@")[0] : "Local API Key User",
          role: "user",
        },
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
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
      return {
        ok: true,
        session: authSession,
        message: "Mock sign-in complete.",
      };
    },
    startOidcLogin: async () => {
      authSession = {
        authenticated: true,
        user: {
          id: "mock-hai-user",
          email: "mock-sso@ihep.ac.cn",
          name: "Mock HAI User",
          role: "user",
        },
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        accessTokenExpiresAt: new Date(
          Date.now() + 60 * 60 * 1000,
        ).toISOString(),
        refreshable: true,
        authMode: "oidc",
        authProvider: "hai",
      };
      return {
        ok: true,
        session: authSession,
        message: "Mock HAI OIDC sign-in complete.",
      };
    },
    cancelOidcLogin: async () => true,
    startDesktopSsoLogin: async () => {
      pendingAuthProvider = "ihep";
      return {
        ok: true,
        message: "Mock browser SSO started.",
        deviceCode: "mock-device-code",
        loginUrl:
          "https://opendrsai.ihep.ac.cn/api/desktop-auth/login?device_code=mock",
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
        loginUrl:
          "https://opendrsai.ihep.ac.cn/api/desktop-auth/wechat/callback?code=mock&state=mock",
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
          email:
            provider === "wechat"
              ? "wechat:mock-openid"
              : "mock-sso@ihep.ac.cn",
          name:
            provider === "wechat" ? "Mock WeChat User" : "mock-sso@ihep.ac.cn",
          role: "user",
        },
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        accessTokenExpiresAt: new Date(
          Date.now() + 30 * 60 * 1000,
        ).toISOString(),
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
      health = {
        ...health,
        gatewayReady: false,
        gateway: { ...health.gateway, ready: false },
      };
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
      health = {
        ...health,
        gatewayReady: true,
        gateway: { ...health.gateway, ready: true },
      };
      return true;
    },
    stopGateway: async () => {
      health = {
        ...health,
        gatewayReady: false,
        gateway: { ...health.gateway, ready: false },
      };
      return true;
    },
    listWorkspaces: async () => workspaces,
    createWorkspace: async (request) => {
      const now = new Date().toISOString();
      const source = request.source ?? "existing";
      const path =
        source === "existing"
          ? request.path || "C:\\Users\\Demo\\Documents\\research-folder"
          : `${request.parentPath || "C:\\Users\\Demo\\Projects"}\\${request.name || "workspace"}`;
      const workspace: WorkspaceProject = {
        id: `workspace-${crypto.randomUUID()}`,
        name:
          request.name ||
          path.split(/[\\/]/).filter(Boolean).at(-1) ||
          "Workspace",
        path,
        type: "local",
        description: request.description,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        trusted: request.trusted ?? false,
        pinned: request.pinned,
        hasAgentInstructions: false,
        metadata: {
          ...(request.metadata || {}),
          source,
          repoUrl: request.repoUrl,
        },
      };
      workspaces = [
        workspace,
        ...workspaces.filter((item) => item.path !== workspace.path),
      ];
      return workspace;
    },
    updateWorkspace: async (request) => {
      const existing = workspaces.find(
        (workspace) => workspace.id === request.id,
      );
      if (!existing) throw new Error("Workspace not found.");
      const workspace: WorkspaceProject = {
        ...existing,
        name: request.name ?? existing.name,
        description: request.description ?? existing.description,
        trusted: request.trusted ?? existing.trusted,
        pinned: request.pinned ?? existing.pinned,
        lastOpenedAt: request.lastOpenedAt ?? existing.lastOpenedAt,
        metadata: request.metadata ?? existing.metadata,
        updatedAt: new Date().toISOString(),
      };
      workspaces = [
        workspace,
        ...workspaces.filter((item) => item.id !== workspace.id),
      ];
      return workspace;
    },
    deleteWorkspace: async (id) => {
      const next = workspaces.filter((workspace) => workspace.id !== id);
      const deleted = next.length !== workspaces.length;
      workspaces = next;
      return deleted;
    },
    listThreads: async () => threads,
    createThread: async (request) => {
      const now = new Date().toISOString();
      const thread = {
        id: `thread-${crypto.randomUUID()}`,
        kind: request.kind,
        title:
          request.title ||
          (request.kind === "agent_run" ? "Agent run" : "New chat"),
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
        emit(agentRunListeners, {
          requestId,
          sessionId,
          runId,
          type: "chunk",
          content,
        });
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
            apiKeyConfigured:
              ok || health.install.prerequisites.apiKeyConfigured,
            problems: ok ? [] : health.install.prerequisites.problems,
          },
        },
      };
      return {
        ok,
        message: ok ? "Mock API key saved." : "API key must be a single line.",
      };
    },
    pickFiles: async () => ({
      canceled: false,
      paths: ["C:\\Users\\Demo\\Documents\\example.pdf"],
    }),
    pickFolder: async () => ({
      canceled: false,
      paths: ["C:\\Users\\Demo\\Documents\\research-folder"],
    }),
    getWorkspaceContextOverview: async (workspacePath) =>
      createMockWorkspaceOverview(workspacePath),
    listWorkspaceFiles: async (request) =>
      createMockWorkspaceFiles(request.workspacePath, request.query),
    previewWorkspaceFile: async (request) =>
      createMockWorkspacePreview(request.workspacePath, request.path),
    getWorkspaceGitDiff: async (request) =>
      createMockWorkspaceDiff(request.workspacePath, request.path),
    checkBrowserUrl: async (rawUrl) => {
      try {
        const url = new URL(rawUrl);
        const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
        return {
          allowed:
            local && (url.protocol === "http:" || url.protocol === "https:"),
          reason: local
            ? "Mock local development URL allowed."
            : "Mock Preview Browser only allows local development URLs.",
          normalizedUrl: url.toString(),
          scope: local ? "local" : "public",
        };
      } catch {
        return {
          allowed: false,
          reason: "The browser URL is not valid.",
          scope: "blocked",
        };
      }
    },
    requestBrowserAction: async (request) => ({
      ok:
        !["click", "type", "select", "key_press"].includes(request.action)
          ? true
          : request.approved === true,
      action: request.action,
      message:
        ["click", "type", "select", "key_press"].includes(request.action) &&
        request.approved !== true
          ? "Interactive browser actions require an explicit later approval flow."
          : "Mock browser action accepted.",
      url: request.url,
    }),
    openExternal: async () => undefined,
    openPath: async () => "",
    createTerminal: async (options) => {
      terminalCounter += 1;
      const session: TerminalSessionInfo = {
        id: `mock-terminal-${terminalCounter}`,
        pid: 1000 + terminalCounter,
        shell: options?.shellProfile || "powershell",
        shellProfile: options?.shellProfile || "powershell",
        cwd: options?.cwd || "C:\\Users\\Demo",
        title: options?.title || `Terminal ${terminalCounter}`,
        workspaceKey: options?.workspaceKey || options?.cwd || "default",
        createdAt: new Date().toISOString(),
      };
      terminalSessions = [...terminalSessions, session];
      return session;
    },
    listTerminalSessions: async (workspaceKey) =>
      terminalSessions.filter(
        (session) => !workspaceKey || session.workspaceKey === workspaceKey,
      ),
    getTerminalBuffer: async () => "",
    renameTerminal: async (id, title) => {
      const session = terminalSessions.find((item) => item.id === id);
      if (!session) return null;
      const renamed = { ...session, title };
      terminalSessions = terminalSessions.map((item) =>
        item.id === id ? renamed : item,
      );
      return renamed;
    },
    writeTerminal: async () => true,
    resizeTerminal: async () => true,
    killTerminal: async (id) => {
      terminalSessions = terminalSessions.filter(
        (session) => session.id !== id,
      );
      return true;
    },
    onInstallProgress: (callback) => subscribe(installListeners, callback),
    onChatEvent: (callback) => subscribe(chatListeners, callback),
    onAgentRunEvent: (callback) => subscribe(agentRunListeners, callback),
    onUpdateStatus: (callback) => subscribe(updateListeners, callback),
    onTerminalData: () => () => undefined,
    onTerminalExit: () => () => undefined,
  };

  window.openDrSai = api;
}

function subscribe<T>(
  listeners: Set<Listener<T>>,
  callback: Listener<T>,
): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function emit<T>(listeners: Set<Listener<T>>, value: T): void {
  listeners.forEach((listener) => listener(value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockWorkspaceOverview(
  workspacePath: string,
): WorkspaceContextOverview {
  return {
    workspacePath,
    trusted: true,
    git: {
      repoRoot: workspacePath,
      branch: "main",
      hasChanges: true,
      changedFiles: [
        { path: "src/App.tsx", status: "modified" },
        { path: "data/results.csv", status: "added" },
        { path: "docs/workspace-context.md", status: "untracked" },
      ],
    },
    instructions: [
      {
        name: "AGENTS.md",
        path: `${workspacePath}\\AGENTS.md`,
        content:
          "Prefer small, reviewed changes. Show the user what context is attached before sending it to the agent.",
        truncated: false,
      },
      {
        name: "DRSAI.md",
        path: `${workspacePath}\\DRSAI.md`,
        content:
          "Scientific workflows should keep provenance, input files, and generated outputs explicit.",
        truncated: false,
      },
    ],
    stats: {
      instructionCount: 2,
      changedFileCount: 3,
    },
  };
}

function createMockWorkspaceFiles(
  workspacePath: string,
  query?: string,
): WorkspaceFileTreeResult {
  const nodes = createMockWorkspaceNodes(workspacePath);
  const normalizedQuery = query?.trim().toLowerCase();
  const filteredNodes = normalizedQuery
    ? filterMockNodes(nodes, normalizedQuery)
    : nodes;
  return {
    workspacePath,
    nodes: filteredNodes,
    totalEntries: countMockNodes(filteredNodes),
    truncated: false,
  };
}

function createMockWorkspaceNodes(workspacePath: string): WorkspaceFileNode[] {
  const now = new Date().toISOString();
  return [
    {
      name: "AGENTS.md",
      path: `${workspacePath}\\AGENTS.md`,
      relativePath: "AGENTS.md",
      type: "file",
      extension: ".md",
      size: 1420,
      modifiedAt: now,
      gitStatus: "clean",
      previewKind: "markdown",
    },
    {
      name: "src",
      path: `${workspacePath}\\src`,
      relativePath: "src",
      type: "directory",
      modifiedAt: now,
      gitStatus: "clean",
      children: [
        {
          name: "App.tsx",
          path: `${workspacePath}\\src\\App.tsx`,
          relativePath: "src/App.tsx",
          type: "file",
          extension: ".tsx",
          size: 18420,
          modifiedAt: now,
          gitStatus: "modified",
          previewKind: "code",
        },
        {
          name: "config.json",
          path: `${workspacePath}\\src\\config.json`,
          relativePath: "src/config.json",
          type: "file",
          extension: ".json",
          size: 640,
          modifiedAt: now,
          gitStatus: "clean",
          previewKind: "json",
        },
      ],
    },
    {
      name: "data",
      path: `${workspacePath}\\data`,
      relativePath: "data",
      type: "directory",
      modifiedAt: now,
      gitStatus: "clean",
      children: [
        {
          name: "results.csv",
          path: `${workspacePath}\\data\\results.csv`,
          relativePath: "data/results.csv",
          type: "file",
          extension: ".csv",
          size: 920,
          modifiedAt: now,
          gitStatus: "added",
          previewKind: "table",
        },
      ],
    },
    {
      name: "docs",
      path: `${workspacePath}\\docs`,
      relativePath: "docs",
      type: "directory",
      modifiedAt: now,
      gitStatus: "clean",
      children: [
        {
          name: "workspace-context.md",
          path: `${workspacePath}\\docs\\workspace-context.md`,
          relativePath: "docs/workspace-context.md",
          type: "file",
          extension: ".md",
          size: 2250,
          modifiedAt: now,
          gitStatus: "untracked",
          previewKind: "markdown",
        },
        {
          name: "paper.pdf",
          path: `${workspacePath}\\docs\\paper.pdf`,
          relativePath: "docs/paper.pdf",
          type: "file",
          extension: ".pdf",
          size: 1_240_000,
          modifiedAt: now,
          gitStatus: "clean",
          previewKind: "pdf",
        },
      ],
    },
    {
      name: "assets",
      path: `${workspacePath}\\assets`,
      relativePath: "assets",
      type: "directory",
      modifiedAt: now,
      gitStatus: "clean",
      children: [
        {
          name: "plot.svg",
          path: `${workspacePath}\\assets\\plot.svg`,
          relativePath: "assets/plot.svg",
          type: "file",
          extension: ".svg",
          size: 420,
          modifiedAt: now,
          gitStatus: "clean",
          previewKind: "image",
        },
      ],
    },
  ];
}

function createMockWorkspacePreview(
  workspacePath: string,
  path: string,
): WorkspaceFilePreview {
  const relativePath = path.replace(workspacePath, "").replace(/^[/\\]+/, "").replace(/\\/g, "/");
  const name = relativePath.split("/").filter(Boolean).at(-1) || path;
  const base = {
    workspacePath,
    path,
    relativePath,
    name,
    size: 920,
    modifiedAt: new Date().toISOString(),
    truncated: false,
  };
  if (name.endsWith(".tsx")) {
    return {
      ...base,
      kind: "code",
      mime: "text/plain",
      content:
        "export function WorkspaceContextPanel() {\n  return <section>Human-visible, agent-ready context.</section>;\n}\n",
    };
  }
  if (name.endsWith(".json")) {
    return {
      ...base,
      kind: "json",
      mime: "application/json",
      content: JSON.stringify({ mode: "context-controller", version: 2 }, null, 2),
    };
  }
  if (name.endsWith(".csv")) {
    return {
      ...base,
      kind: "table",
      mime: "text/csv",
      columns: ["run", "metric", "value"],
      rows: [
        ["baseline", "accuracy", "0.91"],
        ["candidate", "accuracy", "0.94"],
      ],
      content: "run,metric,value\nbaseline,accuracy,0.91\ncandidate,accuracy,0.94\n",
    };
  }
  if (name.endsWith(".svg")) {
    return {
      ...base,
      kind: "image",
      mime: "image/svg+xml",
      dataUrl:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2Y4ZmFmYyIvPjxwb2x5bGluZSBwb2ludHM9IjIwLDkwIDgwLDYwIDEzMCw3MCAyMDAsMzAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzI1NjNlYiIgc3Ryb2tlLXdpZHRoPSI2Ii8+PC9zdmc+",
    };
  }
  if (name.endsWith(".pdf")) {
    return {
      ...base,
      kind: "pdf",
      mime: "application/pdf",
      size: 1_240_000,
      message: "PDF preview is metadata-only in this version.",
    };
  }
  return {
    ...base,
    kind: "markdown",
    mime: "text/markdown",
    content:
      "# Workspace context\n\nThis file is shown to the human first, then attached explicitly for the agent when selected.",
  };
}

function createMockWorkspaceDiff(
  workspacePath: string,
  path?: string,
): WorkspaceGitDiffResult {
  const target = path?.replace(workspacePath, "").replace(/^[/\\]+/, "").replace(/\\/g, "/") || "src/App.tsx";
  return {
    workspacePath,
    path: target,
    truncated: false,
    diff: [
      `diff --git a/${target} b/${target}`,
      "index 1a2b3c4..5d6e7f8 100644",
      `--- a/${target}`,
      `+++ b/${target}`,
      "@@ -12,6 +12,8 @@",
      "+ const contextMode = 'human-visible-agent-ready';",
      "+ const previewKinds = ['code', 'markdown', 'table', 'image'];",
    ].join("\n"),
  };
}

function filterMockNodes(
  nodes: WorkspaceFileNode[],
  query: string,
): WorkspaceFileNode[] {
  return nodes
    .map((node) => {
      const children = node.children ? filterMockNodes(node.children, query) : undefined;
      const matched = node.relativePath.toLowerCase().includes(query);
      if (!matched && (!children || children.length === 0)) return null;
      return { ...node, children };
    })
    .filter(Boolean) as WorkspaceFileNode[];
}

function countMockNodes(nodes: WorkspaceFileNode[]): number {
  return nodes.reduce(
    (count, node) => count + 1 + (node.children ? countMockNodes(node.children) : 0),
    0,
  );
}
