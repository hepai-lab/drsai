import type {
  AuthSession,
  AgentRunEvent,
  ChatEvent,
  DesktopAgent,
  DesktopBackgroundTask,
  DesktopBackgroundTaskStatus,
  DesktopChannelAdapterConfigureResult,
  DesktopChannelAdapterAuthStartResult,
  DesktopChannelAdapterListResult,
  DesktopChannelContextImportResult,
  DesktopChannelInboundEvent,
  DesktopChannelInboundEventRouteResult,
  DesktopChannelOutboundDelivery,
  DesktopChannelOutboundDraftResult,
  DesktopChannelSnapshotSyncResult,
  DesktopApi,
  DesktopCustomCommand,
  DesktopForkQueueDispatchStartedRun,
  DesktopHealth,
  DesktopIdeContextSnapshot,
  DesktopMcpContextResult,
  DesktopMcpActiveSession,
  DesktopMcpReusableSession,
  DesktopMcpLiveEnumerationResult,
  DesktopMcpSessionAuditEntry,
  DesktopMcpToolExecutionAuditEntry,
  DesktopMcpToolExecutionApprovalResult,
  DesktopProjectMemoryEntry,
  DesktopProjectSkillDraft,
  DesktopWorkflowTemplate,
  DesktopThread,
  DesktopThreadSnapshot,
  DesktopVoiceTranscriptHandoffResult,
  DesktopVoiceTranscriptionResult,
  DesktopWorkflowRun,
  DesktopWorkflowMarketplaceListResult,
  DesktopWorkflowRunStepCompleteResult,
  DesktopWorkflowRunPrepareResult,
  DesktopWorkflowRunStepDispatchResult,
  DesktopWorkflowRunStepStatus,
  DesktopWorkflowRunStartResult,
  MyDrSaiCliConfig,
  MyDrSaiConfig,
  OidcLoginDebugEvent,
  BrowserTaskEvent,
  DesktopPendingApproval,
  DesktopScheduledTask,
  DesktopScheduledTaskRunItem,
  DesktopScheduledTaskWorkerStatus,
  InstallProgress,
  TerminalSessionInfo,
  UpdateStatus,
  WorkspaceCheckpoint,
  WorkspaceCheckpointPreviewEntry,
  WorkspaceContextOverview,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceFileTreeResult,
  WorkspaceFolderSummaryResult,
  WorkspaceGitFileAtRefResult,
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

const mockChannelAdapters: DesktopChannelAdapterListResult = {
  generatedAt: new Date().toISOString(),
  configuredCount: 5,
  availableCount: 5,
  adapters: [
    {
      id: "mobile-chat",
      name: "Mobile chat entry",
      provider: "mobile",
      kind: "chat",
      status: "available",
      direction: "bidirectional",
      configured: true,
      requiresApproval: true,
      capabilities: [
        "Import local mobile handoff",
        "Continue desktop threads from phone",
        "Attach mobile context",
      ],
      description: "Mobile entry contract for reviewed phone-originated messages and approval-aware outbound drafts.",
      setupHint:
        "Local .drsai/mobile-context.json handoff is available now; live device pairing and notification routing remain pending.",
    },
    {
      id: "slack-chat",
      name: "Slack channel adapter",
      provider: "slack",
      kind: "chat",
      status: "config_required",
      direction: "bidirectional",
      configured: false,
      requiresApproval: true,
      capabilities: [
        "Read workspace-local Slack snapshots",
        "Draft replies",
        "Route approvals",
      ],
      description:
        "Connector contract for Slack conversations, workspace-local message snapshots, and approval-aware outbound drafts.",
      setupHint:
        "Local .drsai/slack-context.json handoff is available now; live OAuth reads and sends remain pending.",
    },
    {
      id: "github-connector",
      name: "GitHub connector",
      provider: "github",
      kind: "connector",
      status: "config_required",
      direction: "bidirectional",
      configured: false,
      requiresApproval: true,
      capabilities: [
        "Read local Git remote context",
        "Read issue and PR snapshots",
        "Create review context",
        "Open follow-up tasks",
      ],
      description:
        "Connector contract for repository conversations, PR review, issue triage, read-only local Git remote context, and bounded issue/PR snapshot imports.",
      setupHint:
        "Use local Git remote now; live OAuth issue/PR sync can hand off a workspace-local .drsai/github-context.json snapshot.",
    },
    {
      id: "docs-connector",
      name: "Docs connector",
      provider: "docs",
      kind: "connector",
      status: "config_required",
      direction: "bidirectional",
      configured: false,
      requiresApproval: true,
      capabilities: [
        "Read selected docs",
        "Read workspace-local doc snapshots",
        "Draft edits",
        "Attach document context",
      ],
      description:
        "Connector contract for document context, workspace-local doc snapshot imports, and approval-gated edits.",
      setupHint:
        "Live provider access needs authorization; local handoff can use .drsai/docs-context.json now.",
    },
    {
      id: "calendar-connector",
      name: "Calendar connector",
      provider: "calendar",
      kind: "connector",
      status: "config_required",
      direction: "inbound",
      configured: false,
      requiresApproval: true,
      capabilities: [
        "Summarize agenda",
        "Read workspace-local agenda snapshots",
        "Create task context",
        "Schedule follow-up",
      ],
      description:
        "Connector contract for meeting context, workspace-local agenda snapshot imports, and scheduled follow-up tasks.",
      setupHint:
        "Live provider access needs authorization; local handoff can use .drsai/calendar-context.json now.",
    },
    {
      id: "database-connector",
      name: "Database snapshot connector",
      provider: "database",
      kind: "connector",
      status: "available",
      direction: "inbound",
      configured: true,
      requiresApproval: false,
      capabilities: [
        "Read workspace-local database snapshots",
        "Attach table and query previews",
        "Review schema context",
      ],
      description:
        "Connector contract for reviewed database table/query snapshots without live database connections.",
      setupHint:
        "Local .drsai/database-context.json handoff and heuristic relationship hints are available now; live database connections remain pending.",
    },
    {
      id: "logs-monitor",
      name: "Workspace log monitor",
      provider: "file_upload",
      kind: "connector",
      status: "available",
      direction: "inbound",
      configured: true,
      requiresApproval: false,
      capabilities: [
        "Read workspace-local log monitor config",
        "Import incremental log snapshots",
        "Attach new warning/error context",
      ],
      description:
        "Connector contract for reviewed workspace-local log deltas using a durable cursor, without starting a live tailing process.",
      setupHint:
        "Local .drsai/log-monitor.json handoff is available now; live log streaming remains pending.",
    },
    {
      id: "voice-input",
      name: "Voice input",
      provider: "voice",
      kind: "input",
      status: "available",
      direction: "inbound",
      configured: true,
      requiresApproval: false,
      capabilities: [
        "Import local transcript handoff",
        "Transcribe into composer",
        "Attach reviewed transcript",
      ],
      description: "Input adapter contract for local voice prompts and reviewed transcript attachments.",
      setupHint:
        "Live capture still needs device selection and transcription runtime; local .drsai/voice-context.json handoff is available now.",
    },
    {
      id: "file-input",
      name: "File and image input",
      provider: "file_upload",
      kind: "input",
      status: "available",
      direction: "inbound",
      configured: true,
      requiresApproval: false,
      capabilities: ["Attach files", "Attach folders", "Preview images, audio, video, and documents"],
      description: "Existing visible attachment path for explicit file, folder, image, audio, video, and document context.",
    },
  ],
};

const mockWorkflowMarketplace: DesktopWorkflowMarketplaceListResult = {
  generatedAt: new Date().toISOString(),
  availableCount: 3,
  approvalRequiredCount: 3,
  templates: [
    {
      id: "plan-review-fix",
      name: "Plan, review, fix",
      category: "review",
      status: "available",
      summary:
        "Turn a request into a scoped plan, review pass, implementation, and verification notes.",
      trigger: "/plan followed by /review or /fix",
      steps: [
        "Read project instructions and git status.",
        "Write a short design plan.",
        "Apply the scoped code change.",
        "Run focused verification.",
      ],
      requiredCapabilities: ["runtime modes", "workspace context", "diff visibility"],
      approvalRequired: false,
      verification: "Use verify:chat-commands and the feature verifier.",
      risk: "low",
    },
    {
      id: "test-and-commit",
      name: "Test and commit",
      category: "testing",
      status: "available",
      summary:
        "Collect test evidence and staged diff context before policy-gated commit approval.",
      trigger: "/test followed by /commit <message>",
      steps: [
        "Run the inferred test command.",
        "Capture terminal test result.",
        "Inspect staged diff and unstaged risk.",
        "Queue the commit approval.",
      ],
      requiredCapabilities: ["terminal verification", "git diff preflight", "approval center"],
      approvalRequired: true,
      verification: "Use verify:approval-center and verify:execution-policy.",
      risk: "high",
    },
    {
      id: "memory-to-skill",
      name: "Memory to skill",
      category: "automation",
      status: "preview",
      summary:
        "Promote a repeated project lesson into a reviewable local skill draft.",
      trigger: "/memory retrospective <lesson>",
      steps: [
        "Save a project retrospective.",
        "Mark it as a skill-promotion candidate.",
        "Generate a SKILL.md draft.",
        "Install after review.",
      ],
      requiredCapabilities: ["project memory", "skill drafts"],
      approvalRequired: false,
      verification: "Use verify:project-memory.",
      risk: "medium",
    },
    {
      id: "connector-digest",
      name: "Connector digest",
      category: "research",
      status: "planned",
      summary:
        "Import read-only connector context and prepare a task brief for the active thread.",
      trigger: "Channels view connector import",
      steps: [
        "Check configured connector accounts.",
        "Request read-only import approval.",
        "Normalize imported context.",
        "Insert a task brief.",
      ],
      requiredCapabilities: ["channel adapters", "approval center", "context injection"],
      approvalRequired: true,
      verification: "Add connector runtime verifier after live OAuth is wired.",
      risk: "high",
    },
    {
      id: "external-runtime-reconnect",
      name: "External runtime reconnect",
      category: "automation",
      status: "available",
      summary:
        "Mock workflow for recovering provider-owned runtime steps after app restart without auto-running the process.",
      trigger: "Scheduled monitor or workflow recipe with external runtime handoff",
      steps: [
        "Prepare restart context.",
        "Reconnect external runtime.",
        "Confirm provider-owned runtime output.",
      ],
      requiredCapabilities: ["background tasks", "scheduled monitors", "restart resume plan"],
      approvalRequired: true,
      verification:
        "Use verify:workflow-marketplace, verify:background-tasks, and verify:scheduled-tasks.",
      risk: "high",
    },
  ],
};

export function installMockDesktopApi(): void {
  if (window.openDrSai) return;
  let health = structuredClone(initialHealth);
  let authSession = structuredClone(anonymousSession);
  let pendingAuthProvider: AuthSession["authProvider"] = "ihep";
  let threads: DesktopThread[] = [];
  let threadSnapshots: Record<string, DesktopThreadSnapshot> = {};
  let workspaces: WorkspaceProject[] = [];
  let terminalSessions: TerminalSessionInfo[] = [];
  let myDrSaiCliConfig: MyDrSaiCliConfig = {
    user_id: "desktop",
    defult_config_name: "hepai/deepseek-v4-flash",
    plan_mode: false,
    workspace_enabled: true,
    dangerous_allowed: false,
    max_agent_concurrent: 4,
    context_type: "auto",
  };
  let terminalCounter = 0;
  const chatListeners = new Set<Listener<ChatEvent>>();
  const agentRunListeners = new Set<Listener<AgentRunEvent>>();
  const installListeners = new Set<Listener<InstallProgress>>();
  const oidcLoginDebugListeners = new Set<Listener<OidcLoginDebugEvent>>();
  const updateListeners = new Set<Listener<UpdateStatus>>();
  const browserTaskListeners = new Set<Listener<BrowserTaskEvent>>();
  let pendingApprovals: DesktopPendingApproval[] = [];
  let mockChannelOutboundDeliveries: DesktopChannelOutboundDelivery[] = [];
  let mockChannelInboundEvents: DesktopChannelInboundEvent[] = [];
  let mockMcpExecutionAudits: DesktopMcpToolExecutionAuditEntry[] = [];
  let mockMcpSessionAudits: DesktopMcpSessionAuditEntry[] = [];
  let mockMcpActiveSessions: DesktopMcpActiveSession[] = [
    {
      sessionId: "mock-mcp-session:running-tools-call",
      workspacePath: "C:\\Users\\Demo\\Projects\\workspace",
      phase: "tool_execution",
      server: "mock-mcp",
      tool: "search",
      startedAt: new Date().toISOString(),
      approvalId: "mock-mcp-tool:mock-mcp:search",
      command: "node mock-mcp-server.js",
      reusable: true,
      sessionReuseKey: "mcp-reuse:mock",
    },
  ];
  let mockMcpReusableSessions: DesktopMcpReusableSession[] = [
    {
      sessionReuseKey: "mcp-reuse:mock",
      workspacePath: "C:\\Users\\Demo\\Projects\\workspace",
      server: "mock-mcp",
      command: "node mock-mcp-server.js",
      startedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      status: "busy",
      pendingRequestCount: 1,
      idleExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      idleExpiresInMs: 120_000,
      stderrPreview: "Mock MCP reusable session is healthy.",
    },
  ];
  let pendingChannelOutboundDraftApprovals: Record<
    string,
    {
      adapterId: string;
      provider: DesktopChannelOutboundDelivery["provider"];
      workspacePath?: string;
      target: string;
      subject?: string;
    }
  > = {};
  let pendingMcpToolExecutionApprovals: Record<
    string,
    { workspacePath: string; server: string; tool: string; input?: string; reuseSession?: boolean }
  > = {};
  let pendingMcpLiveEnumerationApprovals: Record<
    string,
    { workspacePath: string; server: string; reuseSession?: boolean }
  > = {};

  function recordMockChannelInboundImport(
    result: DesktopChannelContextImportResult,
    options?: { stableEventId?: boolean },
  ): DesktopChannelContextImportResult {
    if (result.items.length === 0) return result;
    const now = result.importedAt || new Date().toISOString();
    const id = [
      "mock-channel-inbound",
      result.adapterId,
      options?.stableEventId ? "snapshot-sync" : now,
      result.items.map((item) => item.id).join("|"),
    ].join(":");
    const existing = mockChannelInboundEvents.find((event) => event.id === id);
    const event: DesktopChannelInboundEvent = {
      id,
      adapterId: result.adapterId,
      provider: result.items[0]?.provider || "file_upload",
      workspacePath: result.workspacePath,
      status: options?.stableEventId && existing ? existing.status : "queued",
      title: `Mock ${result.adapterId} inbound context`,
      summary: result.items
        .slice(0, 3)
        .map((item) => `${item.title}: ${item.summary}`)
        .join("\n"),
      receivedAt: options?.stableEventId && existing ? existing.receivedAt : now,
      updatedAt: now,
      itemCount: result.items.length,
      items: result.items,
      verification:
        "Mock inbound channel event is a local reviewed context handoff; routing to chat performs no provider call.",
    };
    mockChannelInboundEvents = [
      event,
      ...mockChannelInboundEvents.filter((item) => item.id !== event.id),
    ].slice(0, 80);
    return result;
  }

  function mockInboundEventRouteResult(
    event: DesktopChannelInboundEvent,
  ): DesktopChannelInboundEventRouteResult {
    const dismissed = event.status === "dismissed";
    return {
      event,
      importResult: {
        adapterId: event.adapterId,
        workspacePath: event.workspacePath,
        importedAt: event.receivedAt,
        items: event.items,
        truncated: false,
        message: `${event.title} contains ${event.itemCount} reviewed context item(s).`,
        verification: event.verification,
      },
      message: dismissed
        ? `${event.title} was dismissed from the inbound channel queue.`
        : `${event.title} was routed to the chat context handoff.`,
      verification:
        dismissed
          ? "Mock dismiss only updates the local inbound event ledger and performs no external provider call."
          : "Mock routing reuses the reviewed channel context handoff and performs no external provider call.",
    };
  }
  let workspaceCheckpoints: WorkspaceCheckpoint[] = [];
  let pendingShellWorkflowApprovals: Record<
    string,
    { workflowRunId: string; workflowStepId: string }
  > = {};
  let pendingForkLifecycleApprovals: Record<
    string,
    { threadId: string; action: "merge_back" | "discard" }
  > = {};
  let pendingForkQueueStartApprovals: Record<
    string,
    { threadIds: string[] }
  > = {};
  let projectMemory: DesktopProjectMemoryEntry[] = [];
  let customCommands: DesktopCustomCommand[] = [];
  let projectSkillDrafts: DesktopProjectSkillDraft[] = [];
  let mockSyncedWorkflowTemplates: DesktopWorkflowTemplate[] = [];
  let workflowRuns: DesktopWorkflowRun[] = [];
  let backgroundTasks: DesktopBackgroundTask[] = [];
  let scheduledTasks: DesktopScheduledTask[] = [
    {
      id: "mock-scheduled-task-daily-health",
      kind: "monitor",
      title: "Daily workspace health monitor",
      status: "enabled",
      cadence: "daily",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspacePath: "C:\\Users\\Demo\\Projects\\workspace",
      target: "Summarize task status, tests, and unresolved risks.",
      workflowTemplateId: "plan-review-fix",
      approvalRequired: true,
      message: "Mock scheduled monitor is configured for future trigger wiring.",
      verification: "Mock scheduler state is visible in Skills Square.",
    },
  ];
  let mockScheduledWorkerStatus: DesktopScheduledTaskWorkerStatus = {
    enabled: true,
    running: false,
    stopped: false,
    intervalMs: 300000,
    initialDelayMs: 15000,
    nextRunAt: new Date(Date.now() + 300000).toISOString(),
    message: "Mock scheduled task worker is waiting for the next due scan.",
  };

  function markMockWorkflowTerminalStepRunning(
    workflow?: { workflowRunId: string; workflowStepId: string },
  ): void {
    if (!workflow) return;
    const now = new Date().toISOString();
    workflowRuns = workflowRuns.map((run) => {
      if (run.id !== workflow.workflowRunId) return run;
      const steps = run.steps.map((step) =>
        step.id === workflow.workflowStepId &&
        step.kind === "terminal_command" &&
        step.status !== "completed"
          ? {
              ...step,
              status: "running" as const,
              message: "Mock terminal command is running after shell approval.",
            }
          : step,
      );
      return {
        ...run,
        steps,
        status: steps.some((step) => step.status === "blocked")
          ? "blocked"
          : steps.every((step) => step.status === "completed")
            ? "complete"
            : "running",
        currentStepId: workflow.workflowStepId,
        updatedAt: now,
        message: "Mock workflow terminal command is running.",
      };
    });
    const run = workflowRuns.find((item) => item.id === workflow.workflowRunId);
    if (run) {
      upsertMockBackgroundTaskForWorkflowRun(run);
    }
  }

  function upsertMockBackgroundTaskForWorkflowRun(run: DesktopWorkflowRun): void {
    const now = new Date().toISOString();
    const existingIndex = backgroundTasks.findIndex(
      (task) => task.kind === "workflow_run" && task.targetId === run.id,
    );
    const task: DesktopBackgroundTask = {
      id:
        existingIndex >= 0
          ? backgroundTasks[existingIndex].id
          : `mock-background-task-${crypto.randomUUID()}`,
      kind: "workflow_run",
      source: "workflow",
      title: run.name,
      status: mapMockWorkflowStatus(run.status),
      createdAt: existingIndex >= 0 ? backgroundTasks[existingIndex].createdAt : now,
      updatedAt: now,
      ...(run.workspacePath ? { workspacePath: run.workspacePath } : {}),
      targetId: run.id,
      ...(run.approvalId ? { approvalId: run.approvalId } : {}),
      ...(run.currentStepId ? { currentStep: run.currentStepId } : {}),
      message: run.message,
      verification: run.verification,
    };
    backgroundTasks =
      existingIndex >= 0
        ? backgroundTasks.map((item, index) => (index === existingIndex ? task : item))
        : [task, ...backgroundTasks];
    backgroundTasks = backgroundTasks
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 50);
  }

  function mapMockWorkflowStatus(
    status: DesktopWorkflowRun["status"],
  ): DesktopBackgroundTaskStatus {
    if (status === "complete") return "completed";
    if (status === "waiting_approval") return "waiting_approval";
    if (status === "blocked") return "blocked";
    return "running";
  }

  function applyMockRestartResumePlan(run: DesktopWorkflowRun): DesktopWorkflowRun {
    if (run.status === "complete" || run.status === "blocked" || run.resumePlan) {
      return run;
    }
    const recoveredAt = new Date().toISOString();
    const steps = run.steps.map((step) => {
      if (step.status === "completed" || step.status === "blocked") return step;
      if (step.status === "waiting_approval" || step.kind === "approval") {
        return {
          ...step,
          status: "waiting_approval" as const,
          resumableAfterRestart: false,
          resumeAction: "wait_approval" as const,
          resumeMessage:
            "Mock Approval Center still owns this step after restart.",
          lastResumedAt: recoveredAt,
        };
      }
      if (step.kind === "chat_command") {
        return {
          ...step,
          status: "ready" as const,
          resumableAfterRestart: true,
          resumeAction: "dispatch_chat" as const,
          resumeMessage: "Mock resume sends this command into the chat bar.",
          lastResumedAt: recoveredAt,
          message: step.command
            ? `Mock recovered chat step: ${step.command}`
            : "Mock recovered chat step.",
        };
      }
      if (step.kind === "terminal_command") {
        return {
          ...step,
          status: "ready" as const,
          resumableAfterRestart: true,
          resumeAction: "prepare_terminal" as const,
          resumeMessage:
            "Mock resume prepares this command through terminal approval.",
          lastResumedAt: recoveredAt,
          message: step.command
            ? `Mock recovered terminal step: ${step.command}`
            : "Mock recovered terminal step.",
          };
      }
      if (step.kind === "external_runtime") {
        return {
          ...step,
          status: "ready" as const,
          resumableAfterRestart: true,
          resumeAction: "reconnect_external" as const,
          resumeMessage:
            "Mock resume requires explicit provider runtime reconnect; no external process is auto-started.",
          lastResumedAt: recoveredAt,
          message: "Mock recovered external runtime step.",
        };
      }
      return {
        ...step,
        status: "ready" as const,
        resumableAfterRestart: true,
        resumeAction: "confirm_manual" as const,
        resumeMessage: "Mock resume confirms this manual checkpoint.",
        lastResumedAt: recoveredAt,
        message: "Mock recovered manual checkpoint.",
      };
    });
    const resumableStepIds = steps
      .filter((step) => step.resumableAfterRestart)
      .map((step) => step.id);
    const waitingApprovalStepIds = steps
      .filter((step) => step.status === "waiting_approval")
      .map((step) => step.id);
    return {
      ...run,
      steps,
      status: waitingApprovalStepIds.length > 0 ? "waiting_approval" : "running",
      updatedAt: recoveredAt,
      currentStepId: steps.find((step) => step.status !== "completed")?.id,
      resumePlan: {
        restartDetectedAt: recoveredAt,
        pendingStepCount: steps.filter((step) => step.status !== "completed").length,
        resumableStepIds,
        waitingApprovalStepIds,
        message:
          resumableStepIds.length > 0
            ? `Mock recovered after app restart; ${resumableStepIds.length} step(s) can be resumed.`
            : "Mock recovered after app restart and is waiting for Approval Center.",
      },
      message:
        resumableStepIds.length > 0
          ? "Mock workflow run recovered after app restart."
          : "Mock workflow run is waiting after restart recovery.",
    };
  }

  function getMockNextScheduledRunAt(
    fromIso: string,
    cadence: DesktopScheduledTask["cadence"],
  ): string | undefined {
    if (cadence === "manual") return undefined;
    const from = new Date(fromIso);
    if (Number.isNaN(from.getTime())) return undefined;
    const next = new Date(from.getTime());
    if (cadence === "hourly") next.setHours(next.getHours() + 1);
    if (cadence === "daily") next.setDate(next.getDate() + 1);
    if (cadence === "weekly") next.setDate(next.getDate() + 7);
    return next.toISOString();
  }

  function emitOidcLoginDebug(
    stage: OidcLoginDebugEvent["stage"],
    message: string,
    status: OidcLoginDebugEvent["status"] = "info",
    url?: string,
  ): void {
    emit(oidcLoginDebugListeners, {
      stage,
      status,
      message,
      url,
      at: new Date().toISOString(),
    });
  }

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
      emitOidcLoginDebug("started", "Starting mock HepAI OIDC login.");
      emitOidcLoginDebug(
        "discovery",
        "Loaded mock discovery from https://aitest.ihep.ac.cn/api.",
        "success",
        "https://aitest.ihep.ac.cn/api/.well-known/openid-configuration",
      );
      emitOidcLoginDebug(
        "browser-opened",
        "Mock browser open request was sent.",
        "success",
        "http://localhost:3000/#/",
      );
      emitOidcLoginDebug(
        "waiting-callback",
        "Waiting for mock loopback callback.",
      );
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
      emitOidcLoginDebug("session-created", "Mock HepAI session was created.", "success");
      return {
        ok: true,
        session: authSession,
        message: "Mock HAI OIDC sign-in complete.",
      };
    },
    cancelOidcLogin: async () => {
      emitOidcLoginDebug(
        "cancelled",
        "Mock browser sign-in was cancelled by the user.",
      );
      return true;
    },
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
    listAgents: async (): Promise<DesktopAgent[]> => [
      {
        id: "my-drsai",
        name: "My DrSai",
        description: "运行在本机的智能体。",
        owner: "运行在本机的智能体。",
        source: "local",
        status: health.gatewayReady ? "running" : "stopped",
        url: health.gateway.baseUrl,
        examples: [
          { zh: "你可以做什么？", en: "What can you do?" },
          {
            zh: "帮我分析当前工作区的项目结构",
            en: "Analyze the current workspace structure.",
          },
          {
            zh: "总结最近一次会话的关键结论",
            en: "Summarize the key takeaways from the latest session.",
          },
        ],
      },
      {
        id: "mock-hepai-agent",
        name: "HepAI Online Agent",
        description: "通过 HepAI 平台 API Key 获取的在线智能体。",
        owner: "HepAI",
        source: "remote",
        status: "running",
        url: "https://aiapi.ihep.ac.cn/apiv2",
        examples: [
          {
            zh: "帮我整理今天的科研任务。",
            en: "Help me organize today's research tasks.",
          },
        ],
      },
    ],
    getMyDrSaiConfig: async (workspacePath?: string): Promise<MyDrSaiConfig> => ({
      ready: health.gatewayReady,
      baseUrl: health.gateway.baseUrl,
      cliPath: "C:\\Users\\Demo\\.drsai\\cli_config.json",
      config: myDrSaiCliConfig,
      defaultModelAlias: myDrSaiCliConfig.defult_config_name,
      models: [
        {
          alias: "hepai/deepseek-v4-flash",
          display_name: "DeepSeek V4 Flash",
          client_type: "hepai",
          model: "deepseek-v4-flash",
          token_limit: 128000,
          max_tokens: 8192,
          tokenizer_calibration: [
            {
              sample: "Attachment preview: README.md\nKind: file\nContent:\nOpenDrSai Windows desktop context preview.",
              tokens: 23,
            },
            {
              sample: `Workspace tokenizer calibration sample pack: ${workspacePath || "mock workspace"}`,
              tokens: 9,
            },
          ],
          vision: false,
        },
        {
          alias: "openai/gpt-4.1",
          display_name: "GPT-4.1",
          client_type: "openai",
          model: "gpt-4.1",
          token_limit: 1047576,
          max_tokens: 32768,
          tokenizer_calibration: [
            {
              sample: "Workspace instruction: AGENTS.md\nContent:\nUse bounded context and explicit verification before sending.",
              tokens: 21,
            },
          ],
          vision: true,
        },
      ],
    }),
    updateMyDrSaiConfig: async (request): Promise<MyDrSaiConfig> => {
      myDrSaiCliConfig = { ...myDrSaiCliConfig, ...request };
      return api.getMyDrSaiConfig();
    },
    createThread: async (request) => {
      const now = new Date().toISOString();
      const thread = {
        id: `thread-${crypto.randomUUID()}`,
        kind: request.kind,
        title:
          request.title ||
          (request.kind === "agent_run" ? "Agent run" : "New chat"),
        workspacePath: request.workspacePath,
        fork: request.fork,
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
        fork: request.fork ?? existing?.fork,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        lastRunId: request.lastRunId ?? existing?.lastRunId,
        lastRequestId: request.lastRequestId ?? existing?.lastRequestId,
        status: request.status ?? existing?.status ?? "idle",
        messageCount: request.messageCount ?? existing?.messageCount,
        pinned: request.pinned ?? existing?.pinned,
        archived: request.archived ?? existing?.archived,
        unread: request.unread ?? existing?.unread,
      };
      threads = [thread, ...threads.filter((item) => item.id !== request.id)].sort((left, right) => {
        if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      });
      return thread;
    },
    getThreadSnapshot: async (threadId) => threadSnapshots[threadId] ?? null,
    updateThreadSnapshot: async (snapshot) => {
      threadSnapshots = {
        ...threadSnapshots,
        [snapshot.threadId]: snapshot,
      };
      return snapshot;
    },
    prepareForkWorktree: async (request) => {
      const slug = (request.intent || "subtask")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "subtask";
      return {
        sourceWorkspacePath: request.workspacePath,
        repoRoot: request.workspacePath,
        worktreePath: `${request.workspacePath}\\.drsai-forks\\${slug}`,
        branch: `drsai/fork/${slug}-mock`,
        baseRef: "mock-head",
        sourceHasChanges: false,
      };
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
    transcribeVoiceRecording: async (request): Promise<DesktopVoiceTranscriptionResult> => {
      const durationSeconds = Math.max(0, Math.round(request.durationSeconds || 0));
      const transcript =
        request.mockTranscriptText ||
        [
          "[Voice recording captured]",
          `Source: ${request.sourceLabel || "Mock desktop microphone"}.`,
          `Duration: ${formatMockVoiceDuration(durationSeconds)}.`,
          "Mock-local transcription is active; no audio left this machine.",
        ].join("\n");
      return {
        ok: true,
        transcript,
        language: request.languageHint,
        durationSeconds,
        runtimeId: "mock-local",
        sourceId: `mock-voice-${Date.now()}`,
        createdAt: new Date().toISOString(),
        truncated: false,
        providerDisclosure:
          "Voice transcription used the mock desktop runtime; no network request, provider upload, or raw-audio persistence occurred.",
        message:
          "Mock voice recording was normalized into reviewed text for composer insertion.",
      };
    },
    writeVoiceTranscriptHandoff: async (request): Promise<DesktopVoiceTranscriptHandoffResult> => ({
      ok: true,
      transcriptPath: `${request.workspacePath}\\.drsai\\voice-context.json`,
      relativePath: ".drsai/voice-context.json",
      recordId: `mock-voice-${Date.now()}`,
      itemCount: 1,
      importRequest: {
        adapterId: "voice-input",
        workspacePath: request.workspacePath,
        voiceTranscriptPath: ".drsai/voice-context.json",
        limit: 1,
      },
      message:
        "Mock voice transcript handoff was written for explicit Channels review.",
    }),
    startAgentRun: async (request) => {
      const requestId = request.requestId || crypto.randomUUID();
      const sessionId = request.sessionId || requestId;
      const runId = request.runId || requestId;
      emit(agentRunListeners, { requestId, sessionId, runId, type: "start" });
      emit(agentRunListeners, {
        requestId,
        sessionId,
        runId,
        type: "file_event",
        fileEvent: {
          action: "read",
          path: `${request.workspacePath || "C:\\Mock"}\\src\\App.tsx`,
          name: "src/App.tsx",
          hash: "sha256:mock-src-app",
          source: "mock-agent-run",
        },
      });
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
      emit(agentRunListeners, {
        requestId,
        sessionId,
        runId,
        type: "file_event",
        fileEvent: {
          action: "artifact",
          path: `${request.workspacePath || "C:\\Mock"}\\reports\\agent-output.md`,
          name: "reports/agent-output.md",
          hash: "sha256:mock-artifact",
          source: "mock-agent-run",
        },
      });
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
    summarizeWorkspaceFolder: async (request) =>
      createMockWorkspaceFolderSummary(request.path),
    previewWorkspaceFile: async (request) =>
      createMockWorkspacePreview(request.workspacePath, request.path, request.mode),
    getWorkspaceGitDiff: async (request) =>
      createMockWorkspaceDiff(request.workspacePath, request.path, request.staged),
    getWorkspaceGitFileAtRef: async (request) =>
      createMockWorkspaceGitFileAtRef(request.workspacePath, request.ref, request.path),
    revertWorkspaceFile: async (request) => ({
      workspacePath: request.workspacePath,
      path: request.path,
      reverted: request.expectedDiffHash.length > 0,
      message: "Mock reverted unstaged file changes.",
    }),
    stageWorkspaceFile: async (request) => ({
      workspacePath: request.workspacePath,
      path: request.path,
      staged: request.expectedDiffHash.length > 0,
      message: "Mock staged file changes.",
    }),
    stageWorkspaceHunk: async (request) => ({
      workspacePath: request.workspacePath,
      path: request.path,
      applied: request.patch.includes("@@"),
      message: "Mock staged hunk.",
    }),
    revertWorkspaceHunk: async (request) => ({
      workspacePath: request.workspacePath,
      path: request.path,
      applied: request.patch.includes("@@"),
      message: "Mock reverted hunk.",
    }),
    listWorkspaceCheckpoints: async (workspacePath) =>
      workspaceCheckpoints
        .filter((checkpoint) => checkpoint.workspacePath === workspacePath)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    createWorkspaceCheckpoint: async (request) => {
      const workspacePath = request.workspacePath;
      const checkpoint: WorkspaceCheckpoint = {
        id: `wcp-mock-${Date.now().toString(36)}`,
        workspacePath,
        label: request.label?.trim() || "Mock manual workspace checkpoint",
        createdAt: new Date().toISOString(),
        baseRef: "mock-head",
        changedFileCount: 2,
        storedFileCount: 2,
        skippedFileCount: 0,
        entries: [
          {
            path: `${workspacePath}\\src\\App.tsx`,
            relativePath: "src/App.tsx",
            status: "modified",
            size: 1200,
            fileHash: "sha256:mock-app",
            stored: true,
            existed: true,
          },
          {
            path: `${workspacePath}\\docs\\workspace-context.md`,
            relativePath: "docs/workspace-context.md",
            status: "untracked",
            size: 800,
            fileHash: "sha256:mock-doc",
            stored: true,
            existed: true,
          },
        ],
      };
      workspaceCheckpoints = [
        checkpoint,
        ...workspaceCheckpoints.filter((item) => item.id !== checkpoint.id),
      ];
      return checkpoint;
    },
    previewWorkspaceCheckpoint: async (request) => {
      const checkpoint = workspaceCheckpoints.find(
        (item) => item.workspacePath === request.workspacePath && item.id === request.checkpointId,
      );
      const entries: WorkspaceCheckpointPreviewEntry[] = (checkpoint?.entries ?? [])
        .slice(0, request.maxFiles ?? 20)
        .map((entry, index) => ({
        path: entry.path,
        relativePath: entry.relativePath,
        checkpointStatus: entry.status,
        change: index === 0 ? "modified" as const : "unchanged" as const,
        stored: entry.stored,
        existedAtCheckpoint: entry.existed,
        currentExists: true,
        checkpointHash: entry.fileHash,
        currentHash: index === 0 ? "sha256:mock-current-diff" : entry.fileHash,
        checkpointSize: entry.size,
        currentSize: entry.size + (index === 0 ? 32 : 0),
        checkpointSnippet: `Checkpoint snapshot for ${entry.relativePath}`,
        currentSnippet: index === 0
          ? `Current workspace content differs for ${entry.relativePath}`
          : `Current workspace content matches ${entry.relativePath}`,
        message: index === 0
          ? "Current file differs from the checkpoint snapshot."
          : "Current file matches the checkpoint snapshot.",
      }));
      return {
        workspacePath: request.workspacePath,
        checkpointId: request.checkpointId,
        label: checkpoint?.label ?? "Mock checkpoint preview",
        createdAt: checkpoint?.createdAt ?? new Date().toISOString(),
        totalEntries: checkpoint?.entries.length ?? 0,
        changedEntryCount: entries.filter((entry) => entry.change !== "unchanged").length,
        skippedEntryCount: entries.filter((entry) => entry.change === "skipped").length,
        truncated: Boolean(checkpoint && checkpoint.entries.length > entries.length),
        entries,
        message: "Mock checkpoint diff preview prepared.",
      };
    },
    restoreWorkspaceCheckpoint: async (request) => {
      const approval: DesktopPendingApproval = {
        id: `workspace:checkpoint:${request.checkpointId}`,
        source: "workspace",
        actionKind: "workspace.revert",
        title: "Restore workspace checkpoint",
        detail: `Restore checkpoint ${request.checkpointId}`,
        target: request.workspacePath,
        createdAt: new Date().toISOString(),
        risk: "medium",
      };
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      return {
        workspacePath: request.workspacePath,
        checkpointId: request.checkpointId,
        restored: false,
        restoredFileCount: 0,
        removedFileCount: 0,
        skippedFileCount: 0,
        approvalId: approval.id,
        approvalQueued: true,
        message: "Mock checkpoint restore is waiting in Approval Center.",
      };
    },
    writeForkConflictDraft: async (request) => {
      const approval: DesktopPendingApproval = {
        id: `workspace:fork-conflict-draft:${request.threadId}:${Date.now().toString(36)}`,
        source: "workspace",
        actionKind: "workspace.revert",
        title: "Write resolved conflict draft",
        detail: `Write resolved draft for ${request.path}`,
        target: request.path,
        createdAt: new Date().toISOString(),
        risk: "medium",
      };
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      return {
        threadId: request.threadId,
        workspacePath: request.workspacePath,
        path: request.path,
        written: false,
        approvalId: approval.id,
        approvalQueued: true,
        message: "Mock resolved draft write-back is waiting in Approval Center.",
      };
    },
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
    startBrowserTask: async (request) => {
      const taskId = request.taskId || `mock-browser-task-${Date.now()}`;
      emit(browserTaskListeners, {
        type: "task.started",
        taskId,
        engine: "browser-use",
        timestamp: new Date().toISOString(),
      });
      return { taskId };
    },
    stopBrowserTask: async () => true,
    proposeApproval: async (request) => {
      const approval: DesktopPendingApproval = {
        id: `${request.source}:${request.actionKind}:${request.idempotencyKey || crypto.randomUUID()}`,
        source: request.source,
        actionKind: request.actionKind,
        title: request.title,
        detail: request.detail,
        target: request.target,
        createdAt: new Date().toISOString(),
        risk: request.risk || "medium",
        ...(request.checklist ? { checklist: request.checklist } : {}),
      };
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      return {
        queued: true,
        approval,
        allowed: true,
        requiresApproval: true,
        blocked: false,
        reason: "Mock approval proposal queued.",
      };
    },
    requestShellCommandApproval: async (request) => {
      const approval: DesktopPendingApproval = {
        id: `shell:shell.command:terminal:${request.terminalSessionId}:${request.commandId}`,
        source: "shell",
        actionKind: "shell.command",
        title: "Run shell command",
        detail: request.command,
        target: request.terminalSessionId,
        createdAt: new Date().toISOString(),
        risk: request.risk || "medium",
      };
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      if (request.workflowRunId && request.workflowStepId) {
        pendingShellWorkflowApprovals[approval.id] = {
          workflowRunId: request.workflowRunId,
          workflowStepId: request.workflowStepId,
        };
      }
      return {
        queued: true,
        approval,
        allowed: true,
        requiresApproval: true,
        blocked: false,
        reason: "Mock shell command approval queued.",
      };
    },
    requestGitCommitApproval: async (request) => {
      const approval: DesktopPendingApproval = {
        id: `git:git.commit:${request.requestId || crypto.randomUUID()}`,
        source: "git",
        actionKind: "git.commit",
        title: "Create git commit",
        detail: request.body
          ? `git commit -m "${request.message}"\n\n${request.body}`
          : `git commit -m "${request.message}"`,
        target: request.workspacePath,
        createdAt: new Date().toISOString(),
        risk: "high",
        ...(request.checklist ? { checklist: request.checklist } : {}),
      };
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      return {
        queued: true,
        approval,
        allowed: true,
        requiresApproval: true,
        blocked: false,
        reason: "Mock git commit approval queued.",
      };
    },
    requestForkLifecycleApproval: async (request) => {
      const thread = threads.find((item) => item.id === request.threadId);
      if (!thread?.fork) {
        return {
          queued: false,
          allowed: false,
          blocked: true,
          reason: "Mock fork lifecycle request requires a fork thread.",
        };
      }
      const approval: DesktopPendingApproval = {
        id: `fork:fork.lifecycle:${request.threadId}:${request.action}`,
        source: "fork",
        actionKind: "fork.lifecycle",
        title:
          request.action === "merge_back"
            ? "Review fork merge back"
            : "Review fork discard",
        detail: [
          request.action === "merge_back"
            ? "Mock approval merges this fork and marks it merged."
            : "Mock approval removes the controlled fork worktree and marks it closed. Merged branches are deleted with git branch -d; unmerged branches are archived under drsai/archive.",
          `Branch: ${thread.fork.branch}`,
          `Worktree: ${thread.fork.worktreePath}`,
        ].join("\n"),
        target: thread.fork.worktreePath,
        createdAt: new Date().toISOString(),
        risk: "high",
      };
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      pendingForkLifecycleApprovals[approval.id] = {
        threadId: request.threadId,
        action: request.action,
      };
      return {
        queued: true,
        approval,
        allowed: true,
        blocked: false,
        reason: "Mock fork lifecycle approval queued.",
      };
    },
    requestForkQueueStartApproval: async (request) => {
      const forkThreads = request.threadIds
        .map((threadId) => threads.find((item) => item.id === threadId))
        .filter((thread): thread is DesktopThread => Boolean(thread?.fork));
      if (forkThreads.length !== request.threadIds.length) {
        return {
          queued: false,
          threads: [],
          allowed: false,
          blocked: true,
          reason: "Mock fork queue approval requires existing fork threads.",
        };
      }
      const approval: DesktopPendingApproval = {
        id: `fork:fork.queue_start:${request.threadIds.join(":")}`,
        source: "fork",
        actionKind: "fork.queue_start",
        title: `Start fork queue (${forkThreads.length})`,
        detail: [
          "Mock approval marks queued fork subtasks ready for explicit agent dispatch.",
          ...forkThreads.map((thread, index) =>
            `${index + 1}. ${thread.title}\nWorktree: ${thread.fork?.worktreePath}`,
          ),
        ].join("\n\n"),
        target: forkThreads[0]?.fork?.sourceWorkspacePath,
        createdAt: new Date().toISOString(),
        risk: "high",
      };
      const now = new Date().toISOString();
      threads = threads.map((thread) =>
        request.threadIds.includes(thread.id) && thread.fork
          ? {
              ...thread,
              updatedAt: now,
              fork: {
                ...thread.fork,
                queueStatus: "waiting_approval",
                queueApprovalId: approval.id,
                queueMessage: `Mock fork queue start is waiting in Approval Center: ${approval.title}.`,
                queueUpdatedAt: now,
              },
            }
          : thread,
      );
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      pendingForkQueueStartApprovals[approval.id] = {
        threadIds: request.threadIds,
      };
      return {
        queued: true,
        approval,
        threads: threads.filter((thread) => request.threadIds.includes(thread.id)),
        allowed: true,
        blocked: false,
        reason: "Mock fork queue start approval queued.",
      };
    },
    dispatchForkQueue: async (request) => {
      const now = new Date().toISOString();
      const readyThreads = request.threadIds
        .map((threadId) => threads.find((item) => item.id === threadId))
        .filter((thread): thread is DesktopThread => Boolean(thread?.fork));
      const startedRuns: DesktopForkQueueDispatchStartedRun[] = [];
      const blockedThreadIds: string[] = [];
      for (const thread of readyThreads) {
        const assignment = request.threadAgentAssignments?.[thread.id];
        const assignedAgentName = assignment?.agentName ?? thread.fork?.queueAgentName ?? request.selectedAgentName;
        const assignedAgentId = assignment?.agentId ?? thread.fork?.queueAgentId ?? request.selectedAgentId;
        if (thread.fork?.queueStatus !== "ready") {
          blockedThreadIds.push(thread.id);
          threads = threads.map((item) =>
            item.id === thread.id && item.fork
              ? {
                  ...item,
                  updatedAt: now,
                  fork: {
                    ...item.fork,
                    queueStatus: "blocked",
                    queueMessage: "Mock fork queue dispatch was blocked because the subtask is not ready.",
                    queueUpdatedAt: now,
                  },
                }
              : item,
          );
          continue;
        }
        threads = threads.map((item) =>
          item.id === thread.id && item.fork
            ? {
                ...item,
                status: "running",
                updatedAt: now,
                fork: {
                  ...item.fork,
                  queueStatus: "running",
                  queueMessage: assignedAgentName
                    ? `Mock fork queue subtask is running with ${assignedAgentName}.`
                    : "Mock fork queue subtask is running.",
                  queueUpdatedAt: now,
                },
              }
            : item,
        );
        const run = await api.startAgentRun({
          threadId: thread.id,
          sessionId: thread.id,
          runId: `mock-fork-queue-${thread.id}`,
          task: `Mock fork queue dispatch: ${thread.title}`,
          workspacePath: thread.fork.worktreePath,
          model: request.model,
          metadata: {
            fork_queue_dispatch: true,
            selected_agent_id: assignedAgentId,
            selected_agent_name: assignedAgentName,
          },
        });
        startedRuns.push({
          threadId: thread.id,
          requestId: run.requestId,
          runId: run.runId,
        });
        const completedAt = new Date().toISOString();
        threads = threads.map((item) =>
          item.id === thread.id && item.fork
            ? {
                ...item,
                status: "idle",
                updatedAt: completedAt,
                fork: {
                  ...item.fork,
                  queueStatus: "completed",
                  queueMessage: "Mock fork queue subtask completed.",
                  queueUpdatedAt: completedAt,
                },
              }
            : item,
        );
      }
      return {
        startedRuns,
        threads: threads.filter((thread) => request.threadIds.includes(thread.id)),
        blockedThreadIds,
        reason: startedRuns.length
          ? `Mock dispatched ${startedRuns.length} fork queue subtask${startedRuns.length === 1 ? "" : "s"}.`
          : "Mock did not dispatch any fork queue subtasks.",
      };
    },
    listProjectMemory: async (request) =>
      projectMemory
        .filter((entry) => entry.workspacePath === request.workspacePath)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, request.limit ?? 20),
    addProjectMemory: async (request) => {
      const now = new Date().toISOString();
      const entry: DesktopProjectMemoryEntry = {
        id: `memory-${crypto.randomUUID()}`,
        workspacePath: request.workspacePath,
        content: request.content,
        createdAt: now,
        updatedAt: now,
        source: request.source ?? "manual",
      };
      projectMemory = [entry, ...projectMemory].slice(0, 200);
      return entry;
    },
    updateProjectMemory: async (request) => {
      const entry = projectMemory.find(
        (item) =>
          item.workspacePath === request.workspacePath &&
          item.id === request.entryId,
      );
      if (!entry) throw new Error("Project memory entry was not found.");
      const updated: DesktopProjectMemoryEntry = {
        ...entry,
        content: request.content,
        source: request.source ?? entry.source,
        updatedAt: new Date().toISOString(),
      };
      projectMemory = [
        updated,
        ...projectMemory.filter((item) => item.id !== request.entryId),
      ].slice(0, 200);
      return updated;
    },
    clearProjectMemory: async (request) => {
      const before = projectMemory.length;
      projectMemory = projectMemory.filter((entry) =>
        request.entryId
          ? entry.id !== request.entryId
          : entry.workspacePath !== request.workspacePath,
      );
      return {
        workspacePath: request.workspacePath,
        removedCount: before - projectMemory.length,
      };
    },
    listCustomCommands: async (request) =>
      customCommands
        .filter((entry) => entry.workspacePath === request.workspacePath)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, request.limit ?? 50),
    upsertCustomCommand: async (request) => {
      const now = new Date().toISOString();
      const normalizedName = request.name.trim().toLowerCase();
      const existing = customCommands.find(
        (entry) =>
          entry.workspacePath === request.workspacePath &&
          entry.name === normalizedName,
      );
      const entry: DesktopCustomCommand = {
        id: existing?.id ?? `command-${crypto.randomUUID()}`,
        workspacePath: request.workspacePath,
        name: normalizedName,
        title: request.title?.trim() || existing?.title || normalizedName,
        prompt: request.prompt.trim(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        source: request.source ?? existing?.source ?? "manual",
      };
      customCommands = [
        entry,
        ...customCommands.filter((item) => item.id !== entry.id),
      ].slice(0, 100);
      return entry;
    },
    deleteCustomCommand: async (request) => {
      const before = customCommands.length;
      const selector = request.commandIdOrName.trim().toLowerCase();
      customCommands = customCommands.filter(
        (entry) =>
          entry.workspacePath !== request.workspacePath ||
          (entry.id !== request.commandIdOrName && entry.name !== selector),
      );
      return {
        workspacePath: request.workspacePath,
        removedCount: before - customCommands.length,
      };
    },
    listProjectSkillDrafts: async (request) =>
      projectSkillDrafts
        .filter((draft) => draft.workspacePath === request.workspacePath)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, request.limit ?? 20),
    createProjectSkillDraft: async (request) => {
      const now = new Date().toISOString();
      const title =
        request.title?.trim() ||
        request.content.replace(/^Skill promotion candidate:\s*/i, "").split(/\r?\n/)[0] ||
        "Project memory skill";
      const slug = `${title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "project-memory-skill"}-${crypto.randomUUID().slice(0, 8)}`;
      const draft: DesktopProjectSkillDraft = {
        id: `skill-draft-${crypto.randomUUID()}`,
        workspacePath: request.workspacePath,
        title: title.slice(0, 80),
        slug,
        summary: request.content.replace(/\s+/g, " ").trim().slice(0, 220),
        skillMarkdown: `# ${title.slice(0, 80)}\n\nUse this skill when a future OpenDrSai task matches this project lesson.\n\n## Project Lesson\n\n${request.content}\n`,
        draftPath: `C:\\Users\\Demo\\.drsai\\desktop\\skill-drafts\\${slug}\\SKILL.md`,
        createdAt: now,
        updatedAt: now,
        source: request.source ?? "project_memory",
        ...(request.memoryEntryId ? { memoryEntryId: request.memoryEntryId } : {}),
      };
      projectSkillDrafts = [draft, ...projectSkillDrafts].slice(0, 100);
      return draft;
    },
    installProjectSkillDraft: async (request) => {
      const draft = projectSkillDrafts.find(
        (item) =>
          item.workspacePath === request.workspacePath &&
          item.id === request.draftId,
      );
      if (!draft) throw new Error("Project skill draft was not found.");
      const installedAt = draft.installedAt ?? new Date().toISOString();
      const installPath = `C:\\Users\\Demo\\.drsai\\desktop\\installed-skills\\${draft.slug}\\SKILL.md`;
      projectSkillDrafts = projectSkillDrafts.map((item) =>
        item.id === draft.id
          ? {
              ...item,
              installedAt,
              installPath,
              updatedAt: installedAt,
            }
          : item,
      );
      return {
        workspacePath: request.workspacePath,
        draftId: draft.id,
        title: draft.title,
        slug: draft.slug,
        target: "desktop_local",
        installedAt,
        installPath,
        alreadyInstalled: Boolean(draft.installedAt),
      };
    },
    publishProjectSkillDraft: async (request) => {
      const draft = projectSkillDrafts.find(
        (item) =>
          item.workspacePath === request.workspacePath &&
          item.id === request.draftId,
      );
      if (!draft) throw new Error("Project skill draft was not found.");
      const publishedAt = draft.publishedAt ?? new Date().toISOString();
      const submissionPath = `C:\\Users\\Demo\\.drsai\\desktop\\skill-marketplace-submissions\\${draft.slug}\\submission.json`;
      projectSkillDrafts = projectSkillDrafts.map((item) =>
        item.id === draft.id
          ? {
              ...item,
              publishedAt,
              marketplaceSubmissionPath: submissionPath,
              updatedAt: publishedAt,
            }
          : item,
      );
      return {
        workspacePath: request.workspacePath,
        draftId: draft.id,
        title: draft.title,
        slug: draft.slug,
        target: "marketplace_submission",
        publishedAt,
        submissionPath,
        alreadyPublished: Boolean(draft.publishedAt),
        verification:
          "Review submission.json and SKILL.md before uploading to a curated marketplace.",
      };
    },
    listWorkflowMarketplace: async () => ({
      ...mockWorkflowMarketplace,
      generatedAt: new Date().toISOString(),
      syncedCount: mockSyncedWorkflowTemplates.length,
      lastSyncedAt: mockSyncedWorkflowTemplates.length
        ? new Date().toISOString()
        : undefined,
      templates: [...mockWorkflowMarketplace.templates, ...mockSyncedWorkflowTemplates].map((template) => ({
        ...template,
        steps: [...template.steps],
        requiredCapabilities: [...template.requiredCapabilities],
      })),
    }),
    syncWorkflowMarketplace: async (request) => {
      const syncedAt = new Date().toISOString();
      const template: DesktopWorkflowTemplate = {
        id: "synced-workspace-status-digest",
        name: "Workspace status digest",
        category: "automation",
        status: "available",
        summary:
          "Synced local marketplace workflow that prepares a status digest from reviewed workspace context.",
        trigger: "/status",
        steps: [
          "Review current project memory and recent task status.",
          "Prepare a concise status digest.",
          "Record verification and unresolved risks.",
        ],
        requiredCapabilities: [
          "project memory",
          "workflow marketplace sync",
          "status command",
        ],
        approvalRequired: false,
        verification:
          "Use verify:workflow-marketplace after syncing local marketplace templates.",
        risk: "low",
      };
      mockSyncedWorkflowTemplates = [template];
      return {
        workspacePath: request.workspacePath,
        sourcePath:
          request.sourcePath ??
          `${request.workspacePath}\\.drsai\\workflow-marketplace.json`,
        syncedAt,
        importedCount: 1,
        ignoredCount: 0,
        templates: [template],
        message:
          "Synced reviewed workspace-local workflow templates; no network marketplace call was made.",
      };
    },
    prepareWorkflowRun: async (request) => {
      const template = [...mockWorkflowMarketplace.templates, ...mockSyncedWorkflowTemplates].find(
        (item) => item.id === request.templateId,
      );
      const createdAt = new Date().toISOString();
      const baseRecipe: DesktopWorkflowRunPrepareResult["recipe"] = {
        id: `workflow:${request.templateId}:${Date.now().toString(36)}`,
        templateId: request.templateId,
        name: template?.name ?? request.templateId,
        ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
        status: "blocked",
        createdAt,
        steps:
          template?.id === "external-runtime-reconnect"
            ? [
                {
                  id: "prepare",
                  kind: "chat_command",
                  title: "Prepare runtime context",
                  detail: "Gather restart and provider-runtime scope.",
                  command: "/plan external runtime reconnect",
                  requiresApproval: false,
                },
                {
                  id: "runtime",
                  kind: "external_runtime",
                  title: "Reconnect external runtime",
                  detail:
                    "Reconnect or restart the provider-owned runtime without automatic execution after restart.",
                  requiresApproval: true,
                },
                {
                  id: "verify",
                  kind: "manual_review",
                  title: "Confirm runtime result",
                  detail: "Review runtime output and background task state.",
                  requiresApproval: false,
                },
              ]
            : (template?.steps ?? []).map((step, index) => ({
                id: `step-${index + 1}`,
                kind: index === 0 ? "chat_command" : "manual_review",
                title: `Step ${index + 1}`,
                detail: step,
                command: index === 0 ? template?.trigger : undefined,
                requiresApproval: Boolean(template?.approvalRequired),
              })),
        verification: template?.verification ?? "No verifier is available.",
        message: "Workflow template is not available.",
      };
      if (!template || template.status !== "available") {
        return {
          recipe: baseRecipe,
          blocked: true,
          queued: false,
          reason: baseRecipe.message,
        };
      }
      if (!template.approvalRequired) {
        return {
          recipe: {
            ...baseRecipe,
            status: "ready",
            message: "Workflow recipe is ready to run from the chat bar.",
          },
          blocked: false,
          queued: false,
          reason: "Mock workflow recipe prepared.",
        };
      }
      const approval: DesktopPendingApproval = {
        id: `workflow:workflow.run:${template.id}`,
        source: "workflow",
        actionKind: "workflow.run",
        title: `Run workflow: ${template.name}`,
        detail: `${template.summary}\nVerification: ${template.verification}`,
        target: request.workspacePath,
        createdAt,
        risk: template.risk,
      };
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      return {
        recipe: {
          ...baseRecipe,
          status: "approval_queued",
          approvalId: approval.id,
          message: "Workflow recipe is waiting in Approval Center.",
        },
        approval,
        blocked: false,
        queued: true,
        reason: "Mock workflow approval queued.",
      };
    },
    startWorkflowRun: async (request): Promise<DesktopWorkflowRunStartResult> => {
      const now = new Date().toISOString();
      const recipe = request.recipe;
      const steps = recipe.steps.map((step) => {
        const waitingForApproval =
          recipe.status === "approval_queued" &&
          (step.requiresApproval || step.kind === "approval");
        const blocked = recipe.status === "blocked";
        const status: DesktopWorkflowRunStepStatus = blocked
          ? "blocked"
          : waitingForApproval
            ? "waiting_approval"
            : step.kind === "chat_command" ||
                step.kind === "terminal_command" ||
                step.kind === "external_runtime"
              ? "ready"
              : "pending";
        return {
          ...step,
          status,
          message: blocked
            ? recipe.message
            : status === "waiting_approval"
              ? "Waiting for Approval Center or terminal approval."
              : step.command
                ? `Ready command: ${step.command}`
                : "Manual checkpoint queued.",
        };
      });
      const run: DesktopWorkflowRun = {
        id: `mock-workflow-run-${crypto.randomUUID()}`,
        recipeId: recipe.id,
        templateId: recipe.templateId,
        name: recipe.name,
        ...(recipe.workspacePath ? { workspacePath: recipe.workspacePath } : {}),
        status:
          recipe.status === "blocked"
            ? "blocked"
            : steps.some((step) => step.status === "waiting_approval")
              ? "waiting_approval"
              : "running",
        createdAt: now,
        updatedAt: now,
        currentStepId: steps[0]?.id,
        ...(recipe.approvalId ? { approvalId: recipe.approvalId } : {}),
        steps,
        verification: recipe.verification,
        message:
          recipe.status === "approval_queued"
            ? "Mock workflow run is waiting for Approval Center."
            : "Mock workflow run started.",
      };
      workflowRuns = [run, ...workflowRuns].slice(0, 20);
      upsertMockBackgroundTaskForWorkflowRun(run);
      return {
        run,
        chatCommands: steps
          .filter((step) => step.kind === "chat_command" && step.command)
          .map((step) => step.command as string),
        terminalCommands: steps
          .filter((step) => step.kind === "terminal_command" && step.command)
          .map((step) => step.command as string),
        approvalIds: recipe.approvalId ? [recipe.approvalId] : [],
        manualCheckpoints: steps
          .filter((step) => step.kind === "manual_review")
          .map((step) => step.title),
      };
    },
    listWorkflowRuns: async (workspacePath) =>
      workflowRuns
        .map(applyMockRestartResumePlan)
        .filter((run) => !workspacePath || run.workspacePath === workspacePath),
    dispatchWorkflowRunStep: async (
      request,
    ): Promise<DesktopWorkflowRunStepDispatchResult> => {
      const runIndex = workflowRuns.findIndex((run) => run.id === request.runId);
      if (runIndex < 0) throw new Error("Mock workflow run was not found.");
      const run = structuredClone(workflowRuns[runIndex]);
      const stepIndex = run.steps.findIndex((step) => step.id === request.stepId);
      if (stepIndex < 0) throw new Error("Mock workflow run step was not found.");
      const step = run.steps[stepIndex];
      const base = {
        kind: step.kind,
        command: step.command,
        requiresApproval: step.requiresApproval,
      };
      if (step.status === "waiting_approval" || step.kind === "approval") {
        return {
          run,
          dispatched: false,
          ...base,
          message: "Mock workflow step is waiting for Approval Center.",
        };
      }
      if (step.status === "completed") {
        return {
          run,
          dispatched: false,
          ...base,
          message: "Mock workflow step is already complete.",
        };
      }
      if (step.kind === "terminal_command") {
        return {
          run,
          dispatched: Boolean(step.command),
          ...base,
          message: step.requiresApproval
            ? "Mock terminal command is ready for terminal approval."
            : "Mock terminal command is ready.",
          };
      }
      if (step.kind === "external_runtime") {
        return {
          run,
          dispatched: false,
          ...base,
          message:
            "Mock external runtime step needs provider-specific reconnect; no process was started automatically.",
        };
      }
      const now = new Date().toISOString();
      run.steps[stepIndex] = {
        ...step,
        status: "completed",
        completedAt: now,
        message:
          step.kind === "chat_command" && step.command
            ? `Mock dispatched to the chat bar: ${step.command}`
            : "Mock manual checkpoint completed.",
      };
      run.updatedAt = now;
      run.currentStepId = run.steps.find((item) => item.status !== "completed")?.id;
      run.status = run.steps.every((item) => item.status === "completed")
        ? "complete"
        : run.steps.some((item) => item.status === "waiting_approval")
          ? "waiting_approval"
          : "running";
      run.message =
        run.status === "complete"
          ? "Mock workflow run completed."
          : "Mock workflow run step dispatched.";
      workflowRuns = workflowRuns.map((item, index) =>
        index === runIndex ? run : item,
      );
      upsertMockBackgroundTaskForWorkflowRun(run);
      return {
        run,
        dispatched: true,
        ...base,
        message: run.steps[stepIndex].message,
      };
    },
    completeWorkflowRunStep: async (
      request,
    ): Promise<DesktopWorkflowRunStepCompleteResult> => {
      const runIndex = workflowRuns.findIndex((run) => run.id === request.runId);
      if (runIndex < 0) throw new Error("Mock workflow run was not found.");
      const run = structuredClone(workflowRuns[runIndex]);
      const stepIndex = run.steps.findIndex((step) => step.id === request.stepId);
      if (stepIndex < 0) throw new Error("Mock workflow run step was not found.");
      const step = run.steps[stepIndex];
      if (step.kind !== "terminal_command") {
        throw new Error("Mock workflow step completion only accepts terminal commands.");
      }
      const now = new Date().toISOString();
      const succeeded = request.exitCode === 0;
      run.steps[stepIndex] = {
        ...step,
        status: succeeded ? "completed" : "blocked",
        ...(succeeded ? { completedAt: now } : {}),
        message: succeeded
          ? "Mock terminal workflow command completed."
          : `Mock terminal workflow command failed with exit code ${request.exitCode}.`,
      };
      run.updatedAt = now;
      run.currentStepId = run.steps.find((item) => item.status !== "completed")?.id;
      run.status = run.steps.every((item) => item.status === "completed")
        ? "complete"
        : run.steps.some((item) => item.status === "blocked")
          ? "blocked"
          : run.steps.some((item) => item.status === "waiting_approval")
            ? "waiting_approval"
            : "running";
      run.message =
        run.status === "complete"
          ? "Mock workflow run completed."
          : run.status === "blocked"
            ? "Mock workflow run is blocked by a failed terminal command."
            : "Mock terminal workflow command completed.";
      workflowRuns = workflowRuns.map((item, index) =>
        index === runIndex ? run : item,
      );
      upsertMockBackgroundTaskForWorkflowRun(run);
      return {
        run,
        completed: succeeded,
        blocked: !succeeded,
        message: run.steps[stepIndex].message,
      };
    },
    listBackgroundTasks: async (request) =>
      backgroundTasks
        .filter(
          (task) =>
            !request?.workspacePath || task.workspacePath === request.workspacePath,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, request?.limit ?? 50),
    enqueueBackgroundTask: async (request) => {
      const now = new Date().toISOString();
      const task: DesktopBackgroundTask = {
        id: `mock-background-task-${crypto.randomUUID()}`,
        kind: request.kind,
        source: request.source,
        title: request.title,
        status: request.status ?? "queued",
        createdAt: now,
        updatedAt: now,
        ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
        ...(request.targetId ? { targetId: request.targetId } : {}),
        ...(request.approvalId ? { approvalId: request.approvalId } : {}),
        ...(request.currentStep ? { currentStep: request.currentStep } : {}),
        message: request.message ?? "Mock background task is queued.",
        verification:
          request.verification ??
          "Mock background task status is verified through the queue panel.",
      };
      backgroundTasks = [task, ...backgroundTasks].slice(0, 50);
      return task;
    },
    updateBackgroundTask: async (request) => {
      const task = backgroundTasks.find((item) => item.id === request.taskId);
      if (!task) throw new Error("Mock background task was not found.");
      const updated: DesktopBackgroundTask = {
        ...task,
        status: request.status,
        updatedAt: new Date().toISOString(),
        ...(request.currentStep !== undefined
          ? { currentStep: request.currentStep }
          : {}),
        message: request.message ?? task.message,
        verification: request.verification ?? task.verification,
      };
      backgroundTasks = backgroundTasks.map((item) =>
        item.id === updated.id ? updated : item,
      );
      return updated;
    },
    listScheduledTasks: async (request) =>
      scheduledTasks
        .filter(
          (task) =>
            !request?.workspacePath || task.workspacePath === request.workspacePath,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, request?.limit ?? 50),
    createScheduledTask: async (request) => {
      const now = new Date().toISOString();
      const task: DesktopScheduledTask = {
        id: `mock-scheduled-task-${crypto.randomUUID()}`,
        kind: request.kind,
        title: request.title,
        status: request.status ?? "enabled",
        cadence: request.cadence,
        createdAt: now,
        updatedAt: now,
        ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
        target: request.target,
        ...(request.workflowTemplateId
          ? { workflowTemplateId: request.workflowTemplateId }
          : {}),
        ...(request.nextRunAt ? { nextRunAt: request.nextRunAt } : {}),
        approvalRequired: request.approvalRequired ?? true,
        message:
          request.message ??
          "Mock scheduled task is configured for future trigger wiring.",
        verification:
          request.verification ??
          "Mock scheduled task state is verified through the scheduler panel.",
      };
      scheduledTasks = [task, ...scheduledTasks].slice(0, 50);
      return task;
    },
    updateScheduledTask: async (request) => {
      const task = scheduledTasks.find((item) => item.id === request.taskId);
      if (!task) throw new Error("Mock scheduled task was not found.");
      const updated: DesktopScheduledTask = {
        ...task,
        status: request.status,
        updatedAt: new Date().toISOString(),
        ...(request.nextRunAt !== undefined ? { nextRunAt: request.nextRunAt } : {}),
        message: request.message ?? task.message,
        verification: request.verification ?? task.verification,
      };
      scheduledTasks = scheduledTasks.map((item) =>
        item.id === updated.id ? updated : item,
      );
      return updated;
    },
    runDueScheduledTasks: async (request) => {
      const now = new Date(request?.now ?? new Date().toISOString());
      const generatedAt = Number.isNaN(now.getTime())
        ? new Date().toISOString()
        : now.toISOString();
      const { lastError: _lastError, ...workerStatusWithoutError } =
        mockScheduledWorkerStatus;
      mockScheduledWorkerStatus = {
        ...workerStatusWithoutError,
        running: true,
        stopped: false,
        lastStartedAt: generatedAt,
        message: "Mock scheduled task worker is scanning due monitors.",
      };
      const limit = request?.limit ?? 50;
      const items: DesktopScheduledTaskRunItem[] = [];
      const runs: DesktopWorkflowRun[] = [];
      for (const task of scheduledTasks) {
        if (items.length >= limit) break;
        if (request?.workspacePath && task.workspacePath !== request.workspacePath) {
          continue;
        }
        if (
          task.status !== "enabled" ||
          task.cadence === "manual" ||
          !task.nextRunAt ||
          Date.parse(task.nextRunAt) > Date.parse(generatedAt)
        ) {
          continue;
        }
        const nextRunAt = getMockNextScheduledRunAt(generatedAt, task.cadence);
        const activeRun = task.activeWorkflowRunId
          ? workflowRuns
              .map(applyMockRestartResumePlan)
              .find((run) => run.id === task.activeWorkflowRunId)
          : null;
        if (
          activeRun &&
          (activeRun.status === "running" || activeRun.status === "waiting_approval")
        ) {
          runs.push(activeRun);
          items.push({
            taskId: task.id,
            title: task.title,
            status: "reconnected",
            message: activeRun.message,
            workflowRunId: activeRun.id,
            ...(activeRun.approvalId ? { approvalId: activeRun.approvalId } : {}),
            reason: "active_workflow_run",
          });
          scheduledTasks = scheduledTasks.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  updatedAt: generatedAt,
                  activeWorkflowRunId: activeRun.id,
                  activeWorkflowRunStatus: activeRun.status,
                  activeWorkflowRunUpdatedAt: activeRun.updatedAt,
                  message:
                    activeRun.resumePlan
                      ? "Mock scheduled monitor reconnected to a restart-recovered workflow run."
                      : activeRun.status === "waiting_approval"
                      ? "Mock scheduled monitor reconnected to an active workflow waiting in Approval Center."
                      : "Mock scheduled monitor reconnected to an active workflow run.",
                  verification: activeRun.verification,
                }
              : item,
          );
          continue;
        }
        if (activeRun?.status === "blocked") {
          runs.push(activeRun);
          items.push({
            taskId: task.id,
            title: task.title,
            status: "blocked",
            message: activeRun.message,
            workflowRunId: activeRun.id,
            reason: "active_workflow_blocked",
          });
          scheduledTasks = scheduledTasks.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  status: "blocked",
                  updatedAt: generatedAt,
                  activeWorkflowRunId: activeRun.id,
                  activeWorkflowRunStatus: activeRun.status,
                  activeWorkflowRunUpdatedAt: activeRun.updatedAt,
                  message: "Mock scheduled monitor is blocked by its active workflow run.",
                  verification: activeRun.verification,
                }
              : item,
          );
          continue;
        }
        if (task.activeWorkflowRunId) {
          scheduledTasks = scheduledTasks.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  updatedAt: generatedAt,
                  activeWorkflowRunId: undefined,
                  activeWorkflowRunStatus: undefined,
                  activeWorkflowRunUpdatedAt: undefined,
                  message:
                    "Mock scheduled monitor cleared its completed or missing workflow link.",
                }
              : item,
          );
        }
        if (!task.workflowTemplateId) {
          items.push({
            taskId: task.id,
            title: task.title,
            status: "skipped",
            message: "No workflow template is bound to this scheduled task.",
            ...(nextRunAt ? { nextRunAt } : {}),
            reason: "missing_workflow_template",
          });
          scheduledTasks = scheduledTasks.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  updatedAt: generatedAt,
                  ...(nextRunAt ? { nextRunAt } : {}),
                  message:
                    "Scheduled task was due but has no workflow template to dispatch.",
                }
              : item,
          );
          continue;
        }
        const template = mockWorkflowMarketplace.templates.find(
          (item) => item.id === task.workflowTemplateId,
        );
        if (!template || template.status !== "available") {
          items.push({
            taskId: task.id,
            title: task.title,
            status: "blocked",
            message: "Workflow template is unavailable.",
            reason: "workflow_template_unavailable",
          });
          scheduledTasks = scheduledTasks.map((item) =>
            item.id === task.id
              ? {
                  ...item,
                  status: "blocked",
                  updatedAt: generatedAt,
                  message: "Workflow template is unavailable.",
                }
              : item,
          );
          continue;
        }
        const approvalId = template.approvalRequired
          ? `workflow:workflow.run:${template.id}`
          : undefined;
        if (approvalId) {
          pendingApprovals = [
            {
              id: approvalId,
              source: "workflow",
              actionKind: "workflow.run",
              title: `Run workflow: ${template.name}`,
              detail: `${template.summary}\nVerification: ${template.verification}`,
              target: task.workspacePath,
              createdAt: generatedAt,
              risk: template.risk,
            },
            ...pendingApprovals.filter((item) => item.id !== approvalId),
          ];
        }
        const run: DesktopWorkflowRun = {
          id: `mock-workflow-run-${crypto.randomUUID()}`,
          recipeId: `mock-scheduled-recipe-${crypto.randomUUID()}`,
          templateId: template.id,
          name: template.name,
          ...(task.workspacePath ? { workspacePath: task.workspacePath } : {}),
          status: approvalId ? "waiting_approval" : "running",
          createdAt: generatedAt,
          updatedAt: generatedAt,
          ...(approvalId ? { approvalId } : {}),
          steps: [],
          verification: template.verification,
          message: approvalId
            ? "Mock scheduled workflow run is waiting for Approval Center."
            : "Mock scheduled workflow run started.",
        };
        workflowRuns = [run, ...workflowRuns].slice(0, 20);
        upsertMockBackgroundTaskForWorkflowRun(run);
        runs.push(run);
        items.push({
          taskId: task.id,
          title: task.title,
          status: approvalId ? "queued_approval" : "started",
          message: run.message,
          ...(nextRunAt ? { nextRunAt } : {}),
          workflowRunId: run.id,
          ...(approvalId ? { approvalId } : {}),
        });
        scheduledTasks = scheduledTasks.map((item) =>
          item.id === task.id
            ? {
                ...item,
                updatedAt: generatedAt,
                lastRunAt: generatedAt,
                ...(nextRunAt ? { nextRunAt } : {}),
                activeWorkflowRunId: run.id,
                activeWorkflowRunStatus: run.status,
                activeWorkflowRunUpdatedAt: run.updatedAt,
                message: approvalId
                  ? "Scheduled task queued a workflow run that is waiting in Approval Center."
                  : "Scheduled task started an approval-gated workflow run.",
                verification: template.verification,
              }
            : item,
        );
      }
      const result = {
        generatedAt,
        checked: items.length,
        triggered: items.filter(
          (item) => item.status === "started" || item.status === "queued_approval",
        ).length,
        reconnected: items.filter((item) => item.status === "reconnected").length,
        skipped: items.filter((item) => item.status === "skipped").length,
        blocked: items.filter((item) => item.status === "blocked").length,
        items,
        runs,
      };
      mockScheduledWorkerStatus = {
        ...mockScheduledWorkerStatus,
        running: false,
        stopped: false,
        lastFinishedAt: generatedAt,
        nextRunAt: new Date(Date.parse(generatedAt) + 300000).toISOString(),
        lastResult: {
          generatedAt: result.generatedAt,
          checked: result.checked,
          triggered: result.triggered,
          reconnected: result.reconnected,
          skipped: result.skipped,
          blocked: result.blocked,
        },
        message: "Mock scheduled task worker is waiting for the next due scan.",
      };
      return result;
    },
    getScheduledTaskWorkerStatus: async () => ({ ...mockScheduledWorkerStatus }),
    listChannelAdapters: async (_workspacePath?: string) => ({
      ...mockChannelAdapters,
      generatedAt: new Date().toISOString(),
      adapters: mockChannelAdapters.adapters.map((adapter) => ({ ...adapter })),
    }),
    configureChannelAdapter: async (request): Promise<DesktopChannelAdapterConfigureResult> => {
      const adapter = mockChannelAdapters.adapters.find(
        (item) => item.id === request.adapterId,
      );
      if (!adapter) {
        throw new Error("Mock channel adapter was not found.");
      }
      const now = new Date().toISOString();
      if (request.mode === "session_stub") {
        if (!["slack-chat", "github-connector", "docs-connector", "calendar-connector"].includes(adapter.id)) {
          throw new Error("Mock channel session configuration only supports chat and connector adapters.");
        }
        const accountLabel = request.accountLabel || `${adapter.name} account`;
        const scopeLabel = request.scopeLabel || `${adapter.provider}:workspace`;
        const credentialState = request.credentialState || "placeholder";
        adapter.status = "available";
        adapter.configured = true;
        adapter.authMode = "session_stub";
        adapter.accountLabel = accountLabel;
        adapter.scopeLabel = scopeLabel;
        adapter.credentialState = credentialState;
        adapter.configuredAt = now;
        mockChannelAdapters.configuredCount = mockChannelAdapters.adapters.filter(
          (item) => item.configured,
        ).length;
        mockChannelAdapters.availableCount = mockChannelAdapters.adapters.filter(
          (item) => item.status === "available",
        ).length;
        return {
          adapter: { ...adapter },
          connection: {
            adapterId: adapter.id,
            workspacePath: request.workspacePath,
            provider: adapter.provider,
            mode: "session_stub",
            configuredAt: now,
            updatedAt: now,
            accountLabel,
            scopeLabel,
            credentialState,
            readOnly: adapter.direction === "inbound",
          },
          message: `Mock configured ${adapter.name} session stub for ${scopeLabel}.`,
          verification:
            "Mock session configuration stores workspace-scoped metadata only and performs no OAuth or network call.",
        };
      }
      if (adapter.id !== "github-connector") {
        throw new Error("Mock channel adapter only configures github-connector for local Git remote.");
      }
      adapter.status = "available";
      adapter.configured = true;
      adapter.authMode = "local_git_remote";
      adapter.accountLabel = "hepai-lab";
      adapter.scopeLabel = "hepai-lab/drsai";
      adapter.configuredAt = now;
      mockChannelAdapters.configuredCount = mockChannelAdapters.adapters.filter(
        (item) => item.configured,
      ).length;
      mockChannelAdapters.availableCount = mockChannelAdapters.adapters.filter(
        (item) => item.status === "available",
      ).length;
      return {
        adapter: { ...adapter },
        connection: {
          adapterId: "github-connector",
          workspacePath: request.workspacePath,
          provider: "github",
          mode: "local_git_remote",
          configuredAt: now,
          updatedAt: now,
          accountLabel: "hepai-lab",
          scopeLabel: "hepai-lab/drsai",
          repository: "hepai-lab/drsai",
          remoteUrl: "https://github.com/hepai-lab/drsai.git",
          readOnly: true,
        },
        message: "Mock configured GitHub connector for hepai-lab/drsai from the local Git remote.",
        verification:
          "Mock connector configuration is workspace-scoped, read-only, and performs no network call.",
      };
    },
    startChannelAdapterAuth: async (request): Promise<DesktopChannelAdapterAuthStartResult> => {
      const adapter = mockChannelAdapters.adapters.find(
        (item) => item.id === request.adapterId,
      );
      if (!adapter) {
        throw new Error("Mock channel adapter was not found.");
      }
      if (!["mobile-chat", "slack-chat", "github-connector", "docs-connector", "calendar-connector"].includes(adapter.id)) {
        throw new Error("Mock channel authorization only supports connector and mobile adapters.");
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const userCode = `${adapter.provider.slice(0, 3).toUpperCase()}-MOCK-0001`;
      const scopes = request.scopes?.length
        ? request.scopes
        : adapter.provider === "github"
          ? ["repo:read", "issues:read", "pull_requests:read"]
          : adapter.provider === "slack"
            ? ["channels:history", "chat:write"]
            : adapter.provider === "mobile"
              ? ["mobile:chat", "mobile:notify"]
              : [`${adapter.provider}:readonly`];
      adapter.status = "available";
      adapter.configured = true;
      adapter.authMode = "session_stub";
      adapter.accountLabel = `${adapter.name} authorization pending`;
      adapter.scopeLabel = scopes.join(" ");
      adapter.credentialState = "placeholder";
      adapter.sessionExpiresAt = expiresAt;
      adapter.authPreparedAt = now.toISOString();
      mockChannelAdapters.configuredCount = mockChannelAdapters.adapters.filter(
        (item) => item.configured,
      ).length;
      mockChannelAdapters.availableCount = mockChannelAdapters.adapters.filter(
        (item) => item.status === "available",
      ).length;
      return {
        adapterId: adapter.id,
        provider: adapter.provider,
        workspacePath: request.workspacePath,
        authMode: adapter.provider === "mobile" ? "device_pairing" : "oauth",
        authorizationUrl: `mock://channel-auth/${adapter.id}?user_code=${userCode}`,
        userCode,
        verificationUri: `mock://channel-auth/${adapter.provider}`,
        expiresAt,
        intervalSeconds: 5,
        scopes,
        message: `Mock prepared ${adapter.name} authorization for review.`,
        verification:
          "Mock connector authorization preparation stores workspace-scoped metadata only and performs no browser launch, provider network call, token storage, or live send.",
      };
    },
    importChannelContext: async (request): Promise<DesktopChannelContextImportResult> => {
      const workspacePath = request.workspacePath || "C:\\Users\\Demo\\Projects\\workspace";
      if (request.adapterId === "mobile-chat") {
        return recordMockChannelInboundImport({
          adapterId: request.adapterId,
          workspacePath,
          importedAt: new Date().toISOString(),
          items: [
            {
              id: "mobile-chat:mobile-1",
              adapterId: "mobile-chat",
              provider: "mobile" as const,
              kind: "mobile_message" as const,
              title: "Mock mobile follow-up",
              path: `${workspacePath}\\.drsai\\mobile-context.json#mobile-1`,
              relativePath: ".drsai/mobile-context.json#mobile-1",
              summary:
                "Mobile message: Mock mobile follow-up\nSender: phone-user\nThread: active-desktop-thread\n\nMock mobile chat handoff imported from a workspace-local JSON file for explicit chat attachment.",
              mime: "application/json",
              truncated: false,
            },
          ],
          truncated: false,
          message: "Mock prepared 1 read-only mobile chat handoff item(s).",
          verification:
            "Mock mobile chat import reads a bounded workspace-local handoff and performs no device pairing, push notification, network call, or provider send.",
        });
      }
      if (request.adapterId === "slack-chat") {
        return recordMockChannelInboundImport({
          adapterId: request.adapterId,
          workspacePath,
          importedAt: new Date().toISOString(),
          items: [
            {
              id: "slack-chat:message-1",
              adapterId: "slack-chat",
              provider: "slack" as const,
              kind: "slack_message" as const,
              title: "Mock Slack review request",
              path: `${workspacePath}\\.drsai\\slack-context.json#message-1`,
              relativePath: ".drsai/slack-context.json#message-1",
              summary:
                "Slack message: Mock Slack review request\nChannel: #desktop-dev\nSender: product-demo\nThread: 1720000000.000000\n\nMock Slack message imported from a workspace-local JSON snapshot for explicit chat attachment.",
              mime: "application/json",
              truncated: false,
            },
          ],
          truncated: false,
          message: "Mock prepared 1 read-only Slack snapshot message(s).",
          verification:
            "Mock Slack import reads a bounded workspace-local handoff and performs no OAuth flow, Slack API call, network call, or provider send.",
        });
      }
      if (request.adapterId === "github-connector") {
        return recordMockChannelInboundImport({
          adapterId: request.adapterId,
          workspacePath,
          importedAt: new Date().toISOString(),
          items: [
            {
              id: "github-connector:hepai-lab/drsai",
              adapterId: "github-connector",
              provider: "github" as const,
              kind: "file" as const,
              title: "hepai-lab/drsai",
              path: `${workspacePath}\\.git`,
              relativePath: "hepai-lab/drsai",
              summary:
                "Repository: hepai-lab/drsai\nBranch: main\nHEAD: mock123\nWorkspace status: clean",
              mime: "text/plain",
              truncated: false,
            },
            {
              id: "github-connector:issue-42",
              adapterId: "github-connector",
              provider: "github" as const,
              kind: "issue" as const,
              title: "Issue #42: Mock connector triage",
              path: `${workspacePath}\\.drsai\\github-context.json#issue-42`,
              relativePath: ".drsai/github-context.json#issue-42",
              summary:
                "Issue #42: Mock connector triage\nState: open\nAuthor: demo-user\nLabels: desktop, connector\n\nMock issue snapshot imported from a workspace-local JSON file.",
              mime: "application/json",
              truncated: false,
            },
            {
              id: "github-connector:pull_request-17",
              adapterId: "github-connector",
              provider: "github" as const,
              kind: "pull_request" as const,
              title: "PR #17: Mock approval center sync",
              path: `${workspacePath}\\.drsai\\github-context.json#pull_request-17`,
              relativePath: ".drsai/github-context.json#pull_request-17",
              summary:
                "Pull request #17: Mock approval center sync\nState: review_required\nAuthor: demo-reviewer\n\nMock PR snapshot imported without a live GitHub network call.",
              mime: "application/json",
              truncated: false,
            },
          ],
          truncated: false,
          message:
            "Mock prepared read-only GitHub connector context for hepai-lab/drsai with 2 issue/PR snapshot item(s).",
          verification:
            "Mock GitHub import reads local Git metadata plus a bounded workspace-local issue/PR snapshot and does not contact GitHub.",
        });
      }
      if (request.adapterId === "docs-connector") {
        return recordMockChannelInboundImport({
          adapterId: request.adapterId,
          workspacePath,
          importedAt: new Date().toISOString(),
          items: [
            {
              id: "docs-connector:doc-1",
              adapterId: "docs-connector",
              provider: "docs" as const,
              kind: "document" as const,
              title: "Mock design brief",
              path: `${workspacePath}\\.drsai\\docs-context.json#doc-1`,
              relativePath: ".drsai/docs-context.json#doc-1",
              summary:
                "Document: Mock design brief\nOwner: docs-demo\nUpdated: 2026-07-07\n\nWorkspace-local docs snapshot for planned connector context review.",
              mime: "application/json",
              truncated: false,
            },
          ],
          truncated: false,
          message: "Mock prepared 1 read-only Docs snapshot context item(s).",
          verification:
            "Mock Docs import reads a bounded workspace-local snapshot and performs no provider call.",
        });
      }
      if (request.adapterId === "calendar-connector") {
        return recordMockChannelInboundImport({
          adapterId: request.adapterId,
          workspacePath,
          importedAt: new Date().toISOString(),
          items: [
            {
              id: "calendar-connector:meeting-1",
              adapterId: "calendar-connector",
              provider: "calendar" as const,
              kind: "meeting" as const,
              title: "Mock planning sync",
              path: `${workspacePath}\\.drsai\\calendar-context.json#meeting-1`,
              relativePath: ".drsai/calendar-context.json#meeting-1",
              summary:
                "Meeting: Mock planning sync\nStarts: 2026-07-07T10:00:00Z\nAttendees: product, desktop\n\nWorkspace-local agenda snapshot for chat context handoff.",
              mime: "application/json",
              truncated: false,
            },
          ],
          truncated: false,
          message: "Mock prepared 1 read-only Calendar snapshot context item(s).",
          verification:
            "Mock Calendar import reads a bounded workspace-local snapshot and performs no provider call.",
        });
      }
      if (request.adapterId === "database-connector") {
        return recordMockChannelInboundImport({
          adapterId: request.adapterId,
          workspacePath,
          importedAt: new Date().toISOString(),
          items: [
            {
              id: "database-connector:database-1",
              adapterId: "database-connector",
              provider: "database" as const,
              kind: "database_table" as const,
              title: "Mock orders table",
              path: `${workspacePath}\\.drsai\\database-context.json#database-1`,
              relativePath: ".drsai/database-context.json#database-1",
              summary:
                "Database snapshot: Mock orders table\nDatabase: analytics\nType: table\nRows: 128\nColumns: id, customer_id, total, status\n\nWorkspace-local database snapshot imported for chat context review.\nLocal schema relationship hints:\nPossible relationship: Mock orders table.customer_id -> customers.id\nRead-only database snapshot handoff with local heuristic schema relationship hints; no database connection, credentials, SQL execution, network call, external schema inference service, or provider send was performed.",
              mime: "application/json",
              truncated: false,
            },
          ],
          truncated: false,
          message: "Mock prepared 1 read-only Database snapshot context item(s).",
          verification:
            "Mock Database import reads a bounded workspace-local snapshot and performs no database connection, SQL execution, network call, or provider send.",
        });
      }
      if (request.adapterId === "logs-monitor") {
        return recordMockChannelInboundImport({
          adapterId: request.adapterId,
          workspacePath,
          importedAt: new Date().toISOString(),
          items: [
            {
              id: "logs-monitor:logs/app.log:1024-1408",
              adapterId: "logs-monitor",
              provider: "file_upload" as const,
              kind: "file" as const,
              title: "Mock app log",
              path: `${workspacePath}\\logs\\app.log`,
              relativePath: "logs/app.log",
              summary:
                "Log monitor delta (2 KB).\nIncremental cursor snapshot for Mock app log; previous byte offset 1024, read from byte 1024 to 1408.\nDelta lines in bounded window: 4; notable warning/error/failure lines: 1.\nWARN retrying connector snapshot import after local fixture update.\nReady for explicit attachment after visible review; no tailing process, command execution, credential lookup, network call, external log service, or provider send was performed.",
              size: 1408,
              mime: "text/plain",
              truncated: false,
            },
          ],
          truncated: false,
          message: "Mock prepared 1 reviewed workspace log delta context item(s).",
          verification:
            "Mock logs monitor import reads bounded workspace-local log deltas with a durable cursor and performs no tailing process, command execution, network call, external log service, or provider send.",
        });
      }
      if (request.adapterId === "voice-input") {
        return recordMockChannelInboundImport({
          adapterId: request.adapterId,
          workspacePath,
          importedAt: new Date().toISOString(),
          items: [
            {
              id: "voice-input:voice-1",
              adapterId: "voice-input",
              provider: "voice" as const,
              kind: "voice_transcript" as const,
              title: "Mock voice prompt",
              path: `${workspacePath}\\.drsai\\voice-context.json#voice-1`,
              relativePath: ".drsai/voice-context.json#voice-1",
              summary:
                "Voice transcript: Mock voice prompt\nSpeaker: desktop-user\nLanguage: zh-CN\n\nMock voice transcript imported from a workspace-local handoff file for explicit chat attachment.",
              mime: "application/json",
              truncated: false,
            },
          ],
          truncated: false,
          message: "Mock prepared 1 read-only voice transcript context item(s).",
          verification:
            "Mock voice import reads a bounded workspace-local transcript handoff and performs no microphone capture, transcription service call, or provider send.",
        });
      }
      if (request.adapterId !== "file-input") {
        throw new Error("Mock channel import only supports mobile-chat, slack-chat, file-input, github-connector, docs-connector, calendar-connector, database-connector, logs-monitor, and voice-input.");
      }
      const limit = Math.max(1, Math.min(request.limit ?? 3, 6));
      const selectedPaths = Array.isArray(request.paths) ? request.paths.filter(Boolean).slice(0, limit) : [];
      const items = selectedPaths.length > 0
        ? selectedPaths.map((path, index) => {
            const normalizedPath = path.replace(/\//g, "\\");
            const title = normalizedPath.split("\\").filter(Boolean).pop() || `selected-${index + 1}.md`;
            const relativePath = title;
            const isNotebook = title.toLowerCase().endsWith(".ipynb");
            const isDocument = isNotebook || title.toLowerCase().endsWith(".pdf") || title.toLowerCase().endsWith(".docx");
            const lowerTitle = title.toLowerCase();
            const isAudio = [".flac", ".m4a", ".mp3", ".ogg", ".wav"].some((extension) => lowerTitle.endsWith(extension));
            const isVideo = title.toLowerCase().endsWith(".mp4") || title.toLowerCase().endsWith(".mov") || title.toLowerCase().endsWith(".webm");
            return {
              id: `file-input:selected-${index + 1}`,
              adapterId: "file-input",
              provider: "file_upload" as const,
              kind: isAudio ? "audio" as const : isVideo ? "video" as const : isDocument ? "document" as const : "file" as const,
              title,
              path: normalizedPath,
              relativePath,
              summary: isAudio
                ? "Audio metadata preview (mock). Format: WAV/MP3/FLAC/M4A/OGG. Ready for explicit attachment after visible review; no microphone capture, transcription service, network call, or provider send was performed."
                : isVideo
                ? "Video metadata preview (mock). Format: MP4/MOV/WebM. Ready for explicit attachment after visible review; no video player startup, media decoding, frame extraction, network call, or provider send was performed."
                : isNotebook
                ? "Notebook document with visible markdown/code cell summaries for explicit chat attachment."
                : `Selected file context imported for visible review: ${title}`,
              size: 1024 + index,
              mime: isAudio ? mockAudioMimeForTitle(lowerTitle) : isVideo ? "video/mp4" : isNotebook ? "application/x-ipynb+json" : "text/plain",
              truncated: false,
            };
          })
        : [
        {
          id: "file-input:AGENTS.md",
          adapterId: "file-input",
          provider: "file_upload" as const,
          kind: "file" as const,
          title: "AGENTS.md",
          path: `${workspacePath}\\AGENTS.md`,
          relativePath: "AGENTS.md",
          summary:
            "Prefer small, reviewed changes. Show visible context before sending it to the agent.",
          size: 1420,
          mime: "text/markdown",
          truncated: false,
        },
        {
          id: "file-input:docs/workspace-context.md",
          adapterId: "file-input",
          provider: "file_upload" as const,
          kind: "file" as const,
          title: "workspace-context.md",
          path: `${workspacePath}\\docs\\workspace-context.md`,
          relativePath: "docs/workspace-context.md",
          summary:
            "Workspace context preview can become an explicit chat attachment after human review.",
          size: 2250,
          mime: "text/markdown",
          truncated: false,
        },
        {
          id: "file-input:assets/plot.svg",
          adapterId: "file-input",
          provider: "file_upload" as const,
          kind: "image" as const,
          title: "plot.svg",
          path: `${workspacePath}\\assets\\plot.svg`,
          relativePath: "assets/plot.svg",
          summary: "Image file ready for explicit attachment (420 B).",
          size: 420,
          mime: "image/svg+xml",
          truncated: false,
        },
        {
          id: "file-input:assets/meeting-audio.mp3",
          adapterId: "file-input",
          provider: "file_upload" as const,
          kind: "audio" as const,
          title: "meeting-audio.mp3",
          path: `${workspacePath}\\assets\\meeting-audio.mp3`,
          relativePath: "assets/meeting-audio.mp3",
          summary:
            "Audio metadata preview (2.4 MB).\nFormat: MP3.\nDuration: 3m 12s.\nReady for explicit attachment after visible review; no microphone capture, transcription service, network call, or provider send was performed.",
          size: 2400000,
          mime: "audio/mpeg",
          truncated: false,
        },
        {
          id: "file-input:assets/demo-recording.mp4",
          adapterId: "file-input",
          provider: "file_upload" as const,
          kind: "video" as const,
          title: "demo-recording.mp4",
          path: `${workspacePath}\\assets\\demo-recording.mp4`,
          relativePath: "assets/demo-recording.mp4",
          summary:
            "Video metadata preview (5.8 MB).\nFormat: ISO BMFF video.\nBrands: mp42, isom.\nDuration: 1m 8s.\nDimensions: 1280 x 720 px.\nReady for explicit attachment after visible review; no video player startup, media decoding, frame extraction, network call, or provider send was performed.",
          size: 5800000,
          mime: "video/mp4",
          truncated: false,
        },
      ].slice(0, limit);
      return recordMockChannelInboundImport({
        adapterId: request.adapterId,
        workspacePath,
        importedAt: new Date().toISOString(),
        items,
        truncated: items.length >= limit,
        message: selectedPaths.length > 0
          ? `Mock prepared ${items.length} selected file/image/audio/video/document context item(s).`
          : `Mock prepared ${items.length} read-only file/image/audio/video context item(s).`,
        verification:
          "Mock read-only channel import keeps selected file context explicit before chat send.",
      });
    },
    syncChannelSnapshots: async (request): Promise<DesktopChannelSnapshotSyncResult> => {
      const workspacePath = request.workspacePath || "C:\\Users\\Demo\\Projects\\workspace";
      const adapterIds = (request.adapterIds?.length
        ? request.adapterIds
        : ["mobile-chat", "slack-chat", "github-connector", "docs-connector", "calendar-connector", "database-connector", "logs-monitor"]
      ).filter((adapterId, index, all) => all.indexOf(adapterId) === index);
      const results: DesktopChannelContextImportResult[] = [];
      const skippedAdapterIds: string[] = [];
      const syncedAt = new Date().toISOString();

      for (const adapterId of adapterIds) {
        if (!["mobile-chat", "slack-chat", "github-connector", "docs-connector", "calendar-connector", "database-connector", "logs-monitor"].includes(adapterId)) {
          skippedAdapterIds.push(adapterId);
          continue;
        }
        const provider =
          adapterId === "mobile-chat"
            ? "mobile"
            : adapterId === "slack-chat"
            ? "slack"
            : adapterId === "github-connector"
            ? "github"
            : adapterId === "docs-connector"
            ? "docs"
            : adapterId === "database-connector"
            ? "database"
            : adapterId === "logs-monitor"
            ? "file_upload"
            : "calendar";
        const kind =
          adapterId === "mobile-chat"
            ? "mobile_message"
            : adapterId === "slack-chat"
            ? "slack_message"
            : adapterId === "github-connector"
            ? "issue"
            : adapterId === "docs-connector"
              ? "document"
              : adapterId === "database-connector"
                ? "database_table"
                : adapterId === "logs-monitor"
                ? "file"
              : "meeting";
        const title =
          adapterId === "mobile-chat"
            ? "Mock mobile follow-up"
            : adapterId === "slack-chat"
            ? "Mock Slack review request"
            : adapterId === "github-connector"
            ? "Issue #42: Mock connector triage"
            : adapterId === "docs-connector"
              ? "Mock design brief"
              : adapterId === "database-connector"
                ? "Mock orders table"
                : adapterId === "logs-monitor"
                ? "Mock app log"
              : "Mock planning sync";
        const snapshotFile =
          adapterId === "mobile-chat"
            ? "mobile-context.json"
            : adapterId === "logs-monitor"
              ? "log-monitor.json"
              : `${provider}-context.json`;
        const result = recordMockChannelInboundImport(
          {
            adapterId,
            workspacePath,
            importedAt: syncedAt,
            items: [
              {
                id: `${adapterId}:snapshot-sync-1`,
                adapterId,
                provider,
                kind,
                title,
                path: `${workspacePath}\\.drsai\\${snapshotFile}#sync-1`,
                relativePath: `.drsai/${snapshotFile}#sync-1`,
                summary:
                  "Mock snapshot sync imported reviewed workspace-local channel context without a live provider call.",
                mime: "application/json",
                truncated: false,
              },
            ],
            truncated: false,
            message: `Mock synced 1 workspace-local ${provider} snapshot item into the inbound queue.`,
            verification:
              "Mock snapshot sync only polls workspace-local channel handoff files and performs no OAuth, device pairing, secret access, network call, or outbound send.",
          },
          { stableEventId: true },
        );
        results.push(result);
      }

      return {
        workspacePath,
        syncedAt,
        adapterIds,
        results,
        queuedEventCount: results.filter((result) => result.items.length > 0).length,
        skippedAdapterIds,
        message:
          results.length > 0
            ? `Mock synced ${results.length} workspace-local connector snapshot(s).`
            : "Mock found no workspace-local connector snapshot updates.",
        verification:
          "Mock snapshot sync only records reviewed inbound events from local fixtures; no provider or mobile runtime is contacted.",
      };
    },
    listChannelInboundEvents: async (request) => {
      const limit = Math.max(1, Math.min(80, Math.floor(Number(request?.limit) || 8)));
      return mockChannelInboundEvents
        .filter((event) => !request?.workspacePath || event.workspacePath === request.workspacePath)
        .filter((event) => !request?.status || event.status === request.status)
        .slice(0, limit);
    },
    routeChannelInboundEvent: async (request) => {
      const index = mockChannelInboundEvents.findIndex(
        (event) =>
          event.id === request.eventId &&
          (!request.workspacePath || event.workspacePath === request.workspacePath),
      );
      if (index < 0) {
        throw new Error("Mock channel inbound event was not found.");
      }
      const now = new Date().toISOString();
      const updated: DesktopChannelInboundEvent = {
        ...mockChannelInboundEvents[index],
        status: request.action === "dismiss" ? "dismissed" : "routed",
        updatedAt: now,
      };
      mockChannelInboundEvents = [
        updated,
        ...mockChannelInboundEvents.filter((_, eventIndex) => eventIndex !== index),
      ].slice(0, 80);
      return mockInboundEventRouteResult(updated);
    },
    proposeChannelOutboundDraft: async (request): Promise<DesktopChannelOutboundDraftResult> => {
      const adapter = mockChannelAdapters.adapters.find(
        (item) => item.id === request.adapterId,
      );
      if (!adapter || adapter.id === "file-input" || adapter.direction === "inbound") {
        return {
          queued: false,
          allowed: false,
          blocked: true,
          reason: "Mock channel adapter does not support outbound drafts.",
          verification: "No outbound connector call was made.",
        };
      }
      const target = request.target.trim();
      const body = request.body.trim();
      if (!target || !body) {
        return {
          queued: false,
          allowed: false,
          blocked: true,
          reason: "Mock outbound draft requires a target and body.",
          verification: "No outbound connector call was made.",
        };
      }
      const approval: DesktopPendingApproval = {
        id: `connector:external.service:${request.idempotencyKey || adapter.id}`,
        source: "connector",
        actionKind: "external.service",
        title: `Send ${adapter.name} draft`,
        detail: [
          `Adapter: ${adapter.name} (${adapter.provider})`,
          `Target: ${target}`,
          request.subject ? `Subject: ${request.subject}` : null,
          "",
          body,
          "",
          "Mock approval only releases this draft to the connector runtime.",
        ]
          .filter((line): line is string => line !== null)
          .join("\n"),
        target,
        createdAt: new Date().toISOString(),
        risk: "high",
      };
      pendingApprovals = [
        approval,
        ...pendingApprovals.filter((item) => item.id !== approval.id),
      ];
      pendingChannelOutboundDraftApprovals[approval.id] = {
        adapterId: adapter.id,
        provider: adapter.provider,
        ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
        target,
        ...(request.subject ? { subject: request.subject } : {}),
      };
      return {
        queued: true,
        approval,
        allowed: true,
        blocked: false,
        reason: "Mock outbound connector draft approval queued.",
        verification:
          "Outbound channel drafts are approval-gated and do not send until a live connector runtime is configured.",
      };
    },
    listChannelOutboundDeliveries: async (request) => {
      const limit = Math.max(1, Math.min(80, Math.floor(Number(request?.limit) || 8)));
      return mockChannelOutboundDeliveries
        .filter((delivery) => !request?.workspacePath || delivery.workspacePath === request.workspacePath)
        .slice(0, limit);
    },
    importMcpContext: async (request): Promise<DesktopMcpContextResult> => {
      const workspacePath = request.workspacePath || "C:\\Users\\Demo\\Projects\\workspace";
      const kind = request.kind === "tool" ? "tool" : "resource";
      const name = request.selector || (kind === "tool" ? "search_docs" : "docs://roadmap");
      return {
        workspacePath,
        importedAt: new Date().toISOString(),
        sourcePath: `${workspacePath}\\.drsai\\mcp-context.json`,
        kind,
        items: [
          {
            id: `mcp-${kind}:mock`,
            kind,
            server: "mock-mcp",
            name,
            title: kind === "tool" ? "Mock MCP tool" : "Mock MCP resource",
            uri: kind === "resource" ? "docs://roadmap" : undefined,
            description: "Mock reviewed MCP handoff context.",
            inputSchema: kind === "tool" ? "{\n  \"query\": \"string\"\n}" : undefined,
            content:
              kind === "tool"
                ? "MCP tool: Mock MCP tool\nServer: mock-mcp\nDescription: Mock reviewed MCP handoff context.\n\nInput schema:\n{\n  \"query\": \"string\"\n}"
                : "MCP resource: Mock MCP resource\nServer: mock-mcp\nURI: docs://roadmap\nDescription: Mock reviewed MCP handoff context.\n\nRoadmap context imported from a local handoff file.",
            truncated: false,
          },
        ],
        truncated: false,
        message: `Mock prepared 1 reviewed MCP ${kind} context item from the workspace handoff.`,
        verification:
          "Mock MCP context import reads only a workspace-local handoff and performs no MCP server connection or tool execution.",
      };
    },
    requestMcpLiveEnumeration: async (request): Promise<DesktopMcpLiveEnumerationResult> => {
      const workspacePath = request.workspacePath || "C:\\Users\\Demo\\Projects\\workspace";
      const server = request.server || "mock-mcp";
      const approval: DesktopPendingApproval = {
        id: `mock-mcp-live-enumerate:${server}`,
        source: "network",
        actionKind: "network.request",
        title: "Enumerate live MCP server context",
        detail:
          "Mock Approval Center item for a bounded stdio MCP resources/list and tools/list enumeration.",
        target: workspacePath,
        createdAt: new Date().toISOString(),
        risk: "medium",
      };
      pendingApprovals = [approval, ...pendingApprovals.filter((item) => item.id !== approval.id)];
      pendingMcpLiveEnumerationApprovals[approval.id] = {
        workspacePath,
        server,
        reuseSession: request.reuseSession,
      };
      return {
        workspacePath,
        configPath: `${workspacePath}\\.drsai\\mcp-servers.json`,
        sourcePath: `${workspacePath}\\.drsai\\mcp-context.json`,
        status: "approval_queued",
        servers: [
          {
            name: server,
            command: "node mock-mcp-server.js",
            status: "configured",
            resourceCount: 0,
            toolCount: 0,
            description: "Mock live MCP server awaiting approval.",
          },
        ],
        resourceCount: 0,
        toolCount: 0,
        approvalId: approval.id,
        approvalQueued: true,
        reusedSession: false,
        ...(request.reuseSession ? { sessionReuseKey: "mcp-reuse:mock" } : {}),
        message: "Mock MCP live enumeration is waiting in Approval Center.",
        verification:
          request.reuseSession
            ? "Mock live MCP enumeration queues approval before using an explicit reusable stdio session; MCP tool execution remains separately gated."
            : "Mock live MCP enumeration queues approval before writing reviewed handoff context; MCP tool execution remains separately gated.",
      };
    },
    requestMcpToolExecutionApproval: async (request): Promise<DesktopMcpToolExecutionApprovalResult> => {
      const workspacePath = request.workspacePath || "C:\\Users\\Demo\\Projects\\workspace";
      const approval: DesktopPendingApproval = {
        id: `mock-mcp-tool:${request.server}:${request.tool}`,
        source: "connector",
        actionKind: "external.service",
        title: `Execute MCP tool: ${request.tool}`,
        detail:
          "Mock Approval Center item for a future MCP tool execution runtime. Context imports do not execute tools.",
        target: workspacePath,
        createdAt: new Date().toISOString(),
        risk: "high",
      };
      pendingApprovals = [approval, ...pendingApprovals.filter((item) => item.id !== approval.id)];
      pendingMcpToolExecutionApprovals[approval.id] = {
        workspacePath,
        server: request.server,
        tool: request.tool,
        input: request.input,
        reuseSession: request.reuseSession,
      };
      return {
        workspacePath,
        server: request.server,
        tool: request.tool,
        status: "approval_queued",
        approvalId: approval.id,
        queued: true,
        blocked: false,
        allowed: true,
        reusedSession: false,
        ...(request.reuseSession ? { sessionReuseKey: "mcp-reuse:mock" } : {}),
        message: "Mock MCP tool execution is waiting in Approval Center.",
        verification:
          request.reuseSession
            ? "MCP tool execution is separately approval-gated and will use explicit mock session reuse only after approval."
            : "MCP tool execution is separately approval-gated and is not performed by live enumeration or context import.",
      };
    },
    listMcpToolExecutionAudits: async (request) => {
      const limit = Math.max(1, Math.min(80, Math.floor(Number(request.limit) || 12)));
      return mockMcpExecutionAudits
        .filter((entry) => entry.workspacePath === request.workspacePath)
        .slice(0, limit);
    },
    listMcpSessionAudits: async (request) => {
      const limit = Math.max(1, Math.min(80, Math.floor(Number(request.limit) || 12)));
      return mockMcpSessionAudits
        .filter((entry) => entry.workspacePath === request.workspacePath)
        .slice(0, limit);
    },
    listMcpActiveSessions: async (request) =>
      mockMcpActiveSessions.filter((entry) => entry.workspacePath === request.workspacePath),
    listMcpReusableSessions: async (request) =>
      mockMcpReusableSessions.filter((entry) => entry.workspacePath === request.workspacePath),
    closeMcpReusableSession: async (request) => {
      const session = mockMcpReusableSessions.find(
        (entry) =>
          entry.workspacePath === request.workspacePath &&
          entry.sessionReuseKey === request.sessionReuseKey,
      );
      if (!session) {
        return {
          workspacePath: request.workspacePath,
          sessionReuseKey: request.sessionReuseKey,
          closed: false,
          message: "No mock reusable MCP session matched the close request.",
          verification:
            "Mock reusable MCP close only targets sessions started by this desktop process.",
        };
      }
      mockMcpReusableSessions = mockMcpReusableSessions.filter(
        (entry) => entry.sessionReuseKey !== request.sessionReuseKey,
      );
      mockMcpActiveSessions = mockMcpActiveSessions.filter(
        (entry) => entry.sessionReuseKey !== request.sessionReuseKey,
      );
      return {
        workspacePath: request.workspacePath,
        sessionReuseKey: request.sessionReuseKey,
        closed: true,
        message: `Mock closed reusable MCP session ${session.server}.`,
        verification:
          "Mock desktop bridge simulates closing only the selected reusable MCP stdio child without executing MCP work.",
      };
    },
    cancelMcpActiveSession: async (request) => {
      const session = mockMcpActiveSessions.find(
        (entry) =>
          entry.workspacePath === request.workspacePath &&
          entry.sessionId === request.sessionId,
      );
      if (!session) {
        return {
          workspacePath: request.workspacePath,
          sessionId: request.sessionId,
          cancelled: false,
          message: "No mock MCP session matched the cancellation request.",
          verification:
            "Mock MCP cancellation only targets sessions started by this desktop process.",
        };
      }
      mockMcpActiveSessions = mockMcpActiveSessions.filter(
        (entry) => entry.sessionId !== request.sessionId,
      );
      const now = new Date().toISOString();
      const audit: DesktopMcpSessionAuditEntry = {
        id: `mock-mcp-session-cancelled:${request.sessionId}`,
        workspacePath: request.workspacePath,
        ...(session.approvalId ? { approvalId: session.approvalId } : {}),
        sessionId: request.sessionId,
        phase: session.phase,
        server: session.server,
        ...(session.tool ? { tool: session.tool } : {}),
        status: "cancelled",
        message: `Mock cancelled running MCP ${session.phase} session.`,
        verification:
          "Mock cancellation removes only the tracked MCP runtime session and records the lifecycle outcome.",
        createdAt: now,
      };
      mockMcpSessionAudits = [
        audit,
        ...mockMcpSessionAudits.filter((entry) => entry.id !== audit.id),
      ].slice(0, 80);
      return {
        workspacePath: request.workspacePath,
        sessionId: request.sessionId,
        cancelled: true,
        message: `Mock cancellation requested for MCP session ${request.sessionId}.`,
        verification:
          "Mock desktop bridge simulates killing the tracked MCP stdio child and writing a cancelled session audit.",
      };
    },
    listPendingApprovals: async () => pendingApprovals,
    decidePendingApproval: async (request) => {
      const before = pendingApprovals.length;
      pendingApprovals = pendingApprovals.filter((item) => item.id !== request.id);
      const channelDraft = pendingChannelOutboundDraftApprovals[request.id];
      if (channelDraft) {
        const now = new Date().toISOString();
        const delivery: DesktopChannelOutboundDelivery = {
          id: `mock-channel-delivery:${request.id}`,
          approvalId: request.id,
          adapterId: channelDraft.adapterId,
          provider: channelDraft.provider,
          ...(channelDraft.workspacePath ? { workspacePath: channelDraft.workspacePath } : {}),
          target: channelDraft.target,
          ...(channelDraft.subject ? { subject: channelDraft.subject } : {}),
          status: request.approved ? "blocked" : "rejected",
          runtime: "missing_live_provider",
          createdAt: now,
          updatedAt: now,
          message: request.approved
            ? "Mock connector draft was approved but the live provider runtime is not configured."
            : "Mock connector draft was rejected in Approval Center.",
          verification: request.approved
            ? "Mock approval reached the connector runtime boundary; no network send was performed."
            : "Rejected mock connector drafts are recorded for audit and are not sent.",
        };
        mockChannelOutboundDeliveries = [
          delivery,
          ...mockChannelOutboundDeliveries.filter(
            (delivery) => delivery.approvalId !== request.id,
          ),
        ].slice(0, 80);
      }
      const mcpLiveEnumeration = pendingMcpLiveEnumerationApprovals[request.id];
      if (mcpLiveEnumeration) {
        const now = new Date().toISOString();
        const status = request.approved
          ? "completed"
          : request.reason === "cancel"
            ? "cancelled"
            : "rejected";
        const sessionId = `mock-mcp-session:${request.id}:enumeration`;
        const sessionAudit: DesktopMcpSessionAuditEntry = {
          id: `mock-mcp-session-audit:${request.id}:${status}`,
          workspacePath: mcpLiveEnumeration.workspacePath,
          approvalId: request.id,
          sessionId,
          phase: "enumeration",
          server: mcpLiveEnumeration.server,
          status,
          ...(request.approved ? { resourceCount: 1, toolCount: 1 } : {}),
          ...(request.approved && mcpLiveEnumeration.reuseSession ? { reusedSession: true } : {}),
          ...(mcpLiveEnumeration.reuseSession ? { sessionReuseKey: "mcp-reuse:mock" } : {}),
          message: request.approved
            ? mcpLiveEnumeration.reuseSession
              ? "Mock MCP enumeration session completed through explicit reusable stdio after approval."
              : "Mock MCP enumeration session completed after approval."
            : status === "cancelled"
              ? "Mock MCP enumeration was cancelled before stdio startup."
              : "Mock MCP enumeration was rejected before stdio startup.",
          verification: request.approved
            ? mcpLiveEnumeration.reuseSession
              ? "Mock MCP session lifecycle records approved reusable enumeration separately from reviewed context import."
              : "Mock MCP session lifecycle records approved enumeration separately from reviewed context import."
            : status === "cancelled"
              ? "Cancelled mock MCP enumeration sessions do not start stdio or write reviewed context."
              : "Rejected mock MCP enumeration sessions do not start stdio or write reviewed context.",
          createdAt: now,
        };
        mockMcpSessionAudits = [
          sessionAudit,
          ...mockMcpSessionAudits.filter((entry) => entry.id !== sessionAudit.id),
        ].slice(0, 80);
      }
      const mcpToolApproval = pendingMcpToolExecutionApprovals[request.id];
      if (mcpToolApproval) {
        const now = new Date().toISOString();
        const status = request.approved
          ? "completed"
          : request.reason === "cancel"
            ? "cancelled"
            : "rejected";
        const resultContextName = `${mcpToolApproval.tool} result ${now}`;
        const sessionId = `mock-mcp-session:${request.id}:tool`;
        const sessionAudit: DesktopMcpSessionAuditEntry = {
          id: `mock-mcp-session-audit:${request.id}:${status}`,
          workspacePath: mcpToolApproval.workspacePath,
          approvalId: request.id,
          sessionId,
          phase: "tool_execution",
          server: mcpToolApproval.server,
          tool: mcpToolApproval.tool,
          status,
          ...(request.approved && mcpToolApproval.reuseSession ? { reusedSession: true } : {}),
          ...(mcpToolApproval.reuseSession ? { sessionReuseKey: "mcp-reuse:mock" } : {}),
          message: request.approved
            ? mcpToolApproval.reuseSession
              ? "Mock MCP tool session completed through explicit reusable stdio after approval."
              : "Mock MCP tool session completed after approval."
            : status === "cancelled"
              ? "Mock MCP tool session was cancelled before stdio startup."
              : "Mock MCP tool session was rejected before stdio startup.",
          verification: request.approved
            ? mcpToolApproval.reuseSession
              ? "Mock MCP session lifecycle records approved reusable tools/call separately from result import."
              : "Mock MCP session lifecycle records approved tools/call separately from result import."
            : status === "cancelled"
              ? "Cancelled mock MCP tool sessions do not start stdio or write reviewed context."
              : "Rejected mock MCP tool sessions do not start stdio or write reviewed context.",
          createdAt: now,
        };
        mockMcpSessionAudits = [
          sessionAudit,
          ...mockMcpSessionAudits.filter((entry) => entry.id !== sessionAudit.id),
        ].slice(0, 80);
        const audit: DesktopMcpToolExecutionAuditEntry = {
          id: `mock-mcp-exec:${request.id}:${status}`,
          workspacePath: mcpToolApproval.workspacePath,
          approvalId: request.id,
          server: mcpToolApproval.server,
          tool: mcpToolApproval.tool,
          status,
          ...(request.approved ? { resultContextName } : {}),
          ...(request.approved
            ? { sourcePath: `${mcpToolApproval.workspacePath}\\.drsai\\mcp-context.json` }
            : {}),
          inputPreview: mcpToolApproval.input || "{}",
          ...(request.approved && mcpToolApproval.reuseSession ? { reusedSession: true } : {}),
          ...(mcpToolApproval.reuseSession ? { sessionReuseKey: "mcp-reuse:mock" } : {}),
          ...(request.approved
            ? { outputPreview: "Mock MCP tool output captured after approval." }
            : {}),
          message: request.approved
            ? "Mock MCP tool execution completed and wrote reviewed handoff context."
            : status === "cancelled"
              ? "Mock MCP tool execution was cancelled before Approval Center execution."
              : "Mock MCP tool execution was rejected in Approval Center.",
          verification: request.approved
            ? "Mock execution audit shows the approved runtime boundary and explicit /mcp tool import path."
            : status === "cancelled"
              ? "Cancelled mock MCP executions are recorded and no mock result context is written."
              : "Rejected mock MCP executions are recorded and no mock result context is written.",
          createdAt: now,
        };
        mockMcpExecutionAudits = [
          audit,
          ...mockMcpExecutionAudits.filter((entry) => entry.id !== audit.id),
        ].slice(0, 60);
      }
      if (request.approved) {
        markMockWorkflowTerminalStepRunning(
          pendingShellWorkflowApprovals[request.id],
        );
        const forkLifecycle = pendingForkLifecycleApprovals[request.id];
        if (forkLifecycle) {
          const now = new Date().toISOString();
          threads = threads.map((thread) =>
            thread.id === forkLifecycle.threadId && thread.fork
              ? {
                  ...thread,
                  updatedAt: now,
                  fork: {
                    ...thread.fork,
                    lifecycleStatus:
                      forkLifecycle.action === "merge_back"
                        ? "merged"
                        : "closed",
                    lifecycleUpdatedAt: now,
                    lifecycleMessage:
                      forkLifecycle.action === "merge_back"
                        ? "Mock fork branch was merged back into the source workspace. The branch is retained until discard cleanup."
                        : "Mock fork worktree was removed from the controlled fork directory. The fork branch cleanup policy was applied.",
                    mergedCommit:
                      forkLifecycle.action === "merge_back"
                        ? "mock-merge"
                        : thread.fork.mergedCommit,
                    branchCleanupStatus:
                      forkLifecycle.action === "merge_back"
                        ? "pending"
                        : thread.fork.mergedCommit
                          ? "deleted"
                          : "archived",
                    branchCleanupMessage:
                      forkLifecycle.action === "merge_back"
                        ? "Mock merged branch is retained until discard cleanup."
                        : thread.fork.mergedCommit
                          ? "Mock merged fork branch was deleted with git branch -d."
                          : "Mock unmerged fork branch was archived under drsai/archive.",
                    archivedBranch:
                      forkLifecycle.action === "discard" && !thread.fork.mergedCommit
                        ? `drsai/archive/${thread.fork.branch.replace(/^drsai\//, "")}-mock`
                        : thread.fork.archivedBranch,
                  },
                }
              : thread,
          );
        }
        const forkQueueStart = pendingForkQueueStartApprovals[request.id];
        if (forkQueueStart) {
          const now = new Date().toISOString();
          threads = threads.map((thread) =>
            forkQueueStart.threadIds.includes(thread.id) && thread.fork
              ? {
                  ...thread,
                  updatedAt: now,
                  fork: {
                    ...thread.fork,
                    queueStatus: "ready",
                    queueUpdatedAt: now,
                    queueMessage:
                      "Mock fork queue start approved; subtasks are ready for explicit agent dispatch.",
                  },
                }
              : thread,
          );
        }
      } else {
        const forkQueueStart = pendingForkQueueStartApprovals[request.id];
        if (forkQueueStart) {
          const now = new Date().toISOString();
          threads = threads.map((thread) =>
            forkQueueStart.threadIds.includes(thread.id) && thread.fork
              ? {
                  ...thread,
                  updatedAt: now,
                  fork: {
                    ...thread.fork,
                    queueStatus: "blocked",
                    queueUpdatedAt: now,
                    queueMessage: "Mock fork queue start was rejected in Approval Center.",
                  },
                }
              : thread,
          );
        }
      }
      const {
        [request.id]: _removed,
        ...remainingShellWorkflowApprovals
      } = pendingShellWorkflowApprovals;
      pendingShellWorkflowApprovals = remainingShellWorkflowApprovals;
      const {
        [request.id]: _removedForkLifecycle,
        ...remainingForkLifecycleApprovals
      } = pendingForkLifecycleApprovals;
      pendingForkLifecycleApprovals = remainingForkLifecycleApprovals;
      const {
        [request.id]: _removedForkQueueStart,
        ...remainingForkQueueStartApprovals
      } = pendingForkQueueStartApprovals;
      pendingForkQueueStartApprovals = remainingForkQueueStartApprovals;
      const {
        [request.id]: _removedChannelDraft,
        ...remainingChannelDraftApprovals
      } = pendingChannelOutboundDraftApprovals;
      pendingChannelOutboundDraftApprovals = remainingChannelDraftApprovals;
      const {
        [request.id]: _removedMcpToolApproval,
        ...remainingMcpToolApprovals
      } = pendingMcpToolExecutionApprovals;
      pendingMcpToolExecutionApprovals = remainingMcpToolApprovals;
      const {
        [request.id]: _removedMcpLiveApproval,
        ...remainingMcpLiveApprovals
      } = pendingMcpLiveEnumerationApprovals;
      pendingMcpLiveEnumerationApprovals = remainingMcpLiveApprovals;
      return before !== pendingApprovals.length;
    },
    decideApproval: async (request) => api.decidePendingApproval(request),
    listPendingBrowserTaskApprovals: async () => [],
    approveBrowserTaskAction: async () => true,
    openExternal: async () => undefined,
    openPath: async () => "",
    getIdeContext: async (workspacePath): Promise<DesktopIdeContextSnapshot> => ({
      available: true,
      workspacePath,
      source: "vscode",
      capturedAt: new Date().toISOString(),
      currentFile: {
        path: `${workspacePath}\\src\\App.tsx`,
        name: "App.tsx",
        relativePath: "src/App.tsx",
        language: "typescriptreact",
        line: 42,
        column: 7,
      },
      currentSelection: {
        path: `${workspacePath}\\src\\App.tsx`,
        name: "App.tsx",
        relativePath: "src/App.tsx",
        text: "const selectedContext = createVisibleAttachment();",
        startLine: 42,
        endLine: 42,
        language: "typescriptreact",
        truncated: false,
      },
      message: "Mock IDE current file/selection context is ready to attach.",
    }),
    getFileIcon: async (path) => ({
      path,
      dataUrl:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjQiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiByeD0iNiIgZmlsbD0iI2Y4ZmFmYyIvPjxwYXRoIGQ9Ik04IDVoNmw0IDR2MTBIOHoiIGZpbGw9IiNmZmYiIHN0cm9rZT0iIzY0NzQ4YiIvPjxwYXRoIGQ9Ik0xNCA1djRoNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNjQ3NDhiIi8+PC9zdmc+",
    }),
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
    onOidcLoginDebug: (callback) =>
      subscribe(oidcLoginDebugListeners, callback),
    onChatEvent: (callback) => subscribe(chatListeners, callback),
    onAgentRunEvent: (callback) => subscribe(agentRunListeners, callback),
    onUpdateStatus: (callback) => subscribe(updateListeners, callback),
    onTerminalData: () => () => undefined,
    onTerminalExit: () => () => undefined,
    onBrowserTaskEvent: (callback) =>
      subscribe(browserTaskListeners, callback),
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

function createMockWorkspaceFolderSummary(path: string): WorkspaceFolderSummaryResult {
  const normalizedPath = path || "C:\\Users\\Demo\\Documents\\research-folder";
  const name =
    normalizedPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
    "research-folder";
  const summary = [
    `Folder summary: ${name}`,
    `Path: ${normalizedPath}`,
    "Entries scanned: 18",
    "Files: 12",
    "Folders: 4",
    "Top file types: .md: 5, .ts: 4, .json: 3",
    "Sampled files:",
    "1. docs/workspace-context.md (markdown, 1420 B)",
    "   # Workspace context",
    "   ## Visible attachment boundary",
    "2. src/contextAssembler.ts (code, 3280 B)",
    "   export function createContextPreviewItems",
  ].join("\n");
  return {
    path: normalizedPath,
    name,
    totalEntries: 18,
    fileCount: 12,
    directoryCount: 4,
    skippedDirectoryCount: 2,
    truncated: false,
    estimatedTokens: Math.ceil(summary.length / 4),
    sampledFiles: [
      {
        path: `${normalizedPath}\\docs\\workspace-context.md`,
        relativePath: "docs/workspace-context.md",
        kind: "markdown",
        size: 1420,
        outline: ["# Workspace context", "## Visible attachment boundary"],
      },
      {
        path: `${normalizedPath}\\src\\contextAssembler.ts`,
        relativePath: "src/contextAssembler.ts",
        kind: "code",
        size: 3280,
        outline: ["export function createContextPreviewItems"],
      },
    ],
    summary,
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
        {
          name: ".env",
          path: `${workspacePath}\\src\\.env`,
          relativePath: "src/.env",
          type: "file",
          extension: ".env",
          size: 180,
          modifiedAt: now,
          gitStatus: "clean",
          previewKind: "config",
        },
        {
          name: "index.html",
          path: `${workspacePath}\\src\\index.html`,
          relativePath: "src/index.html",
          type: "file",
          extension: ".html",
          size: 720,
          modifiedAt: now,
          gitStatus: "clean",
          previewKind: "html",
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
        {
          name: "analysis.ipynb",
          path: `${workspacePath}\\data\\analysis.ipynb`,
          relativePath: "data/analysis.ipynb",
          type: "file",
          extension: ".ipynb",
          size: 12_400,
          modifiedAt: now,
          gitStatus: "modified",
          previewKind: "notebook",
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
        {
          name: "brief.docx",
          path: `${workspacePath}\\docs\\brief.docx`,
          relativePath: "docs/brief.docx",
          type: "file",
          extension: ".docx",
          size: 14_200,
          modifiedAt: now,
          gitStatus: "clean",
          previewKind: "office",
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
        {
          name: "demo.mp4",
          path: `${workspacePath}\\assets\\demo.mp4`,
          relativePath: "assets/demo.mp4",
          type: "file",
          extension: ".mp4",
          size: 2_420_000,
          modifiedAt: now,
          gitStatus: "clean",
          previewKind: "media",
        },
      ],
    },
  ];
}

function createMockWorkspacePreview(
  workspacePath: string,
  path: string,
  mode?: "auto" | "head" | "tail" | "outline",
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
    fileHash: `sha256:mock-${name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
    mode: mode ?? "auto",
  };
  if (mode === "outline") {
    return {
      ...base,
      kind: "text",
      mime: "text/plain",
      outline: ["# Workspace context", "function WorkspaceContextPanel", "const previewKinds"],
      message: "Outline preview generated from mock file.",
    };
  }
  if (mode === "head" || mode === "tail") {
    return {
      ...base,
      kind: "text",
      mime: "text/plain",
      content: mode === "head" ? "Mock file head\nline 2\nline 3" : "Mock file tail\nlast line",
      truncated: true,
      message: `Showing file ${mode} only.`,
    };
  }
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
  if (name.endsWith(".env") || name.endsWith(".toml") || name.endsWith(".yml")) {
    return {
      ...base,
      kind: "config",
      mime: "text/plain",
      content: "DRSAI_MODE=desktop\nPREVIEW_ENABLED=true\n",
    };
  }
  if (name.endsWith(".html")) {
    return {
      ...base,
      kind: "html",
      mime: "text/html",
      content: "<main><h1>Preview</h1><p>HTML renders inside a sandboxed frame.</p></main>",
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
  if (name.endsWith(".ipynb")) {
    return {
      ...base,
      kind: "notebook",
      mime: "application/x-ipynb+json",
      content:
        "Notebook cells: 3\n1. markdown, 2 lines: # Experiment\n2. code, 4 lines, 1 outputs: import pandas as pd\n3. code, 3 lines: def train_model():",
      outline: ["cell 1: # Experiment", "cell 3: def train_model()"],
      message: "Notebook cell preview generated from ipynb JSON.",
    };
  }
  if (name.endsWith(".svg")) {
    return {
      ...base,
      kind: "image",
      mime: "image/svg+xml",
      dataUrl:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTIwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjEyMCIgZmlsbD0iI2Y4ZmFmYyIvPjxwb2x5bGluZSBwb2ludHM9IjIwLDkwIDgwLDYwIDEzMCw3MCAyMDAsMzAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzI1NjNlYiIgc3Ryb2tlLXdpZHRoPSI2Ii8+PC9zdmc+",
      metadata: { format: "SVG", width: 240, height: 120 },
    };
  }
  if (name.endsWith(".pdf")) {
    return {
      ...base,
      kind: "pdf",
      mime: "application/pdf",
      size: 1_240_000,
      content: "Mock extracted PDF text preview.",
      message: "Extracted a basic text preview from the PDF.",
    };
  }
  if (name.endsWith(".mp4") || [".flac", ".m4a", ".mp3", ".ogg", ".wav"].some((extension) => name.endsWith(extension))) {
    return {
      ...base,
      kind: "media",
      mime: name.endsWith(".mp4") ? "video/mp4" : mockAudioMimeForTitle(name),
      size: 2_420_000,
      message: "Media preview is rendered directly in the file preview pane.",
    };
  }
  if (name.endsWith(".docx") || name.endsWith(".pptx") || name.endsWith(".xlsx")) {
    return {
      ...base,
      kind: "office",
      mime: "application/vnd.openxmlformats-officedocument",
      content: "Mock extracted Office text preview.",
      message: "Extracted a basic text preview from the Office document.",
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

function mockAudioMimeForTitle(name: string): string {
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".wav")) return "audio/wav";
  return "audio/mpeg";
}

function formatMockVoiceDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function createMockWorkspaceDiff(
  workspacePath: string,
  path?: string,
  staged = false,
): WorkspaceGitDiffResult {
  const target = path?.replace(workspacePath, "").replace(/^[/\\]+/, "").replace(/\\/g, "/") || "src/App.tsx";
  const diff = [
    `diff --git a/${target} b/${target}`,
    "index 1a2b3c4..5d6e7f8 100644",
    `--- a/${target}`,
    `+++ b/${target}`,
    "@@ -12,6 +12,8 @@",
    "+ const contextMode = 'human-visible-agent-ready';",
    "+ const previewKinds = ['code', 'markdown', 'table', 'image'];",
  ].join("\n");
  return {
    workspacePath,
    path: target,
    truncated: false,
    staged,
    diff,
    diffHash: hashMockString(diff),
  };
}

function createMockWorkspaceGitFileAtRef(
  workspacePath: string,
  ref: string,
  path: string,
): WorkspaceGitFileAtRefResult {
  const target = path?.replace(workspacePath, "").replace(/^[/\\]+/, "").replace(/\\/g, "/") || "src/App.tsx";
  const content = [
    `// Mock merge-base file preview from ${ref}`,
    "export function WorkspaceContextPanel() {",
    "  return <section>Base version before fork changes.</section>;",
    "}",
    "",
  ].join("\n");
  return {
    workspacePath,
    ref,
    path: target,
    content,
    contentHash: hashMockString(content),
    truncated: false,
    missing: false,
    message: "Mock merge-base file preview loaded.",
  };
}

function hashMockString(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
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
