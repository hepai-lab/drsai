import type {
  AuthSession,
  AgentRunEvent,
  ChatEvent,
  CompletionNotificationClickEvent,
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
  DesktopExternalConnectionReadinessResult,
  DiagnosticEvent,
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
  DesktopUserPreference,
  DesktopProjectSkillDraft,
  DesktopWorkflowTemplate,
  DesktopThread,
  DesktopThreadSnapshot,
  DesktopRuntimeLogEvent,
  DesktopTrustAssessment,
  DesktopTrustStatus,
  DesktopVoiceTranscriptHandoffResult,
  DesktopVoiceTranscriptionEvent,
  DesktopStreamingVoiceTranscriptionEvent,
  DesktopVoiceSynthesisEvent,
  DesktopWorkflowRun,
  DesktopWorkflowMarketplaceListResult,
  DesktopWorkflowRunStepCompleteResult,
  DesktopWorkflowRunPrepareResult,
  DesktopWorkflowRunStepDispatchResult,
  DesktopWorkflowRunStepStatus,
  DesktopWorkflowRunStartResult,
  MyDrSaiCliConfig,
  MyDrSaiConfig,
  MyDrSaiModelConnection,
  OidcLoginDebugEvent,
  BrowserTaskEvent,
  DesktopPendingApproval,
  DesktopScheduledTask,
  DesktopScheduledTaskRunItem,
  DesktopScheduledTaskWorkerStatus,
  DesktopShareManifest,
  InstallProgress,
  InteractiveDebugSession,
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
  GatewaySkill,
} from "@shared/desktopApi";
import type { StructuredConversationEvent } from "@shared/structuredConversation";
import { FULL_DESKTOP_FEATURE_CAPABILITIES } from "@shared/platform";
import drsaiImageUrl from "./assets/drsai.png";

type Listener<T> = (value: T) => void;

function mockTrustAssessment(status: DesktopTrustStatus): DesktopTrustAssessment {
  const canonical = {
    evidence_sufficient: { label: "依据充分", icon: "check", rule: "verified_source", definition: "结论可由可读取的原始来源直接支持。", action: "可以使用该结论，并保留来源位置。" },
    needs_confirmation: { label: "需要确认", icon: "question", rule: "provisional_source", definition: "来源已有暂定信息，但关键内容尚未最终确定。", action: "保留待确认措辞，获得正式计划后再更新。" },
    insufficient_data: { label: "数据不足", icon: "warning", rule: "insufficient_observation", definition: "现有观察范围不足以支持当前结论。", action: "补充数据后再判断。" },
    source_conflict: { label: "来源冲突", icon: "compare", rule: "conflicting_sources", definition: "多个来源给出互相矛盾的结果。", action: "并列报告双方并重新验证。" },
    inference: { label: "属于推测", icon: "hypothesis", rule: "inference_only", definition: "结论来自间接推断，尚无直接测量。", action: "完成直接实验后再形成确定结论。" },
  } as const;
  const item = canonical[status];
  return { status, label: item.label, definition: item.definition, reason: "Mock evidence rule matched.", icon: item.icon, recommendedAction: item.action, evidenceRule: item.rule, evidenceIds: [`mock-${status}`], ruleSatisfied: true };
}

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
    baseUrl: "http://127.0.0.1:18642",
    pid: 4242,
    lastLog: "",
  },
  update: {
    phase: "idle",
    checking: false,
    available: false,
    downloading: false,
    downloaded: false,
    progress: null,
    version: null,
    currentVersion: "1.4.8",
    mandatory: false,
    releaseNotesUrl: null,
    canDownload: false,
    canInstall: false,
    canCancel: false,
    errorCode: null,
    error: null,
    recovery: null,
    source: null,
    fallbackUsed: false,
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
        "Use dedicated Mobile Pairing for device authorization",
      ],
      description: "Mobile entry contract for reviewed phone-originated messages and approval-aware outbound drafts.",
      setupHint:
        "Use the dedicated Mobile Pairing flow for device authorization; reviewed .drsai/mobile-context.json remains the Channel handoff contract.",
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
        "Read live channel history with a verified bot token",
        "Send approved messages through chat.postMessage",
        "Draft replies",
        "Route approvals",
      ],
      description:
        "Connector contract for Slack conversations, workspace-local message snapshots, and approval-aware outbound drafts.",
      setupHint:
        "Use a reviewed Slack bot token stored by the platform credential service; local .drsai/slack-context.json remains available for offline handoff.",
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
        "Sync live issues and pull requests with Device OAuth",
        "Send approved issue and pull request comments",
        "Create review context",
        "Open follow-up tasks",
      ],
      description:
        "Connector contract for repository conversations, PR review, issue triage, read-only local Git remote context, and bounded issue/PR snapshot imports.",
      setupHint:
        "Use local Git remote for read-only context or GitHub Device OAuth for live issue/PR sync and approved comments.",
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
        "Read live Google documents",
        "Append approved revision-bound edits",
        "Draft edits",
        "Attach document context",
      ],
      description:
        "Connector contract for document context, workspace-local doc snapshot imports, and approval-gated edits.",
      setupHint:
        "Use a reviewed Google OAuth access token with Docs read/write scope; local .drsai/docs-context.json remains available offline.",
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
        "Read bounded live Google Calendar events",
        "Create task context",
        "Schedule follow-up",
      ],
      description:
        "Connector contract for meeting context, workspace-local agenda snapshot imports, and scheduled follow-up tasks.",
      setupHint:
        "Use a reviewed Google OAuth access token with Calendar read scope; local JSON/ICS handoff remains available offline.",
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
        "Use the Voice controls for live capture when a transcription runtime is configured; local .drsai/voice-context.json remains available for reviewed transcript handoff.",
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

const mockExternalConnectionReadiness: DesktopExternalConnectionReadinessResult = {
  workspacePath: "C:\\Users\\Demo\\Project",
  generatedAt: new Date().toISOString(),
  readyCount: 1,
  partialCount: 9,
  plannedCount: 0,
  message: "External connection readiness was assembled from local desktop contracts.",
  verification:
    "No OAuth flow, browser process, LaTeX command, provider API call, network request, or workspace mutation was performed.",
  connections: [
    {
      id: "mobile",
      name: "Mobile chat",
      status: "partial",
      configured: true,
      readOnly: true,
      capabilitySources: ["mobile-chat", ".drsai/mobile-context.json", "approval-aware outbound drafts"],
      evidence: ["Mobile chat entry adapter is cataloged", "Local phone-originated handoffs are reviewed before attach"],
      gaps: ["Live mobile device pairing", "Push notification routing"],
      approvalBoundary: "Mobile readiness starts no device session, push service, or remote send.",
      verification: "Mock readiness performs no mobile device or push-provider access.",
    },
    {
      id: "github",
      name: "GitHub",
      status: "partial",
      configured: false,
      readOnly: true,
      capabilitySources: ["github-connector", "local Git remote scope", "GitHub Device OAuth", "live issue/PR sync", "approval-gated comments", ".drsai/github-context.json"],
      evidence: ["GitHub supports read-only local Git or verified Device OAuth", "Issue/PR reads and approved comments have deterministic mock fixtures"],
      gaps: ["Actions log and retry orchestration", "Webhook/push synchronization", "Mutations beyond approved comments"],
      approvalBoundary:
        "Local Git stays read-only; OAuth comments require Approval Center.",
      verification: "Mock readiness mirrors Device OAuth, live issue/PR reads, approved comments, revoke and idempotency.",
    },
    {
      id: "chrome",
      name: "Chrome",
      status: "partial",
      configured: false,
      readOnly: true,
      capabilitySources: ["browser controller approvals", "HAR/NetLog/trace snapshots"],
      evidence: ["Browser actions are approval-gated", "Local browser snapshots are redacted"],
      gaps: ["Live Chrome profile connection", "Interactive DOM capture"],
      approvalBoundary: "Live browser automation remains behind browser task approvals.",
      verification: "Mock readiness starts no browser process.",
    },
    {
      id: "slack",
      name: "Slack",
      status: "partial",
      configured: false,
      readOnly: true,
      capabilitySources: ["slack-chat", ".drsai/slack-context.json", "verified bot token", "conversations.history", "approval-gated chat.postMessage"],
      evidence: ["Slack supports reviewed snapshots or verified live provider fixtures", "Approved sends remain idempotent"],
      gaps: ["Thread pagination and cursors", "Event subscriptions", "Remote update/delete"],
      approvalBoundary: "Live Slack sends require a verified mock token and Approval Center decision.",
      verification: "Mock readiness mirrors auth.test, conversations.history, chat.postMessage, revoke and idempotency.",
    },
    {
      id: "docs",
      name: "Docs",
      status: "partial",
      configured: false,
      readOnly: true,
      capabilitySources: ["docs-connector", ".drsai/docs-context.json", "verified Google token", "live document read", "revision-bound batchUpdate"],
      evidence: ["Docs supports bounded snapshots or verified live provider fixtures", "Approved append is revision-bound"],
      gaps: ["Comments and suggestions", "Permissions and version history", "Push revision sync"],
      approvalBoundary: "Live Docs append requires a verified mock token and Approval Center decision.",
      verification: "Mock readiness mirrors scope checks, live read, revision-bound batchUpdate, revoke and expiry.",
    },
    {
      id: "calendar",
      name: "Calendar",
      status: "partial",
      configured: false,
      readOnly: true,
      capabilitySources: ["calendar-connector", ".drsai/calendar-context.json", ".drsai/calendar-context.ics", "verified Google token", "bounded events.list"],
      evidence: ["Calendar supports reviewed snapshots or verified live inbound fixtures", "Remote mutation is intentionally absent"],
      gaps: ["Attendee/free-busy detail", "Push synchronization", "Remote event mutation"],
      approvalBoundary: "Calendar remains inbound-only for snapshot and live event reads.",
      verification: "Mock readiness mirrors bounded events.list, redaction, pagination, revoke and expiry.",
    },
    {
      id: "latex",
      name: "LaTeX",
      status: "partial",
      configured: true,
      readOnly: true,
      capabilitySources: ["file-input", ".tex/.bib/.bibtex/latexmkrc previews"],
      evidence: ["LaTeX/BibTeX files are summarized from bounded local text"],
      gaps: ["PDF compilation", "SyncTeX/source mapping"],
      approvalBoundary: "LaTeX context import never runs TeX tools.",
      verification: "Mock readiness runs no TeX command.",
    },
    {
      id: "database",
      name: "Database snapshots",
      status: "partial",
      configured: true,
      readOnly: true,
      capabilitySources: ["database-connector", ".drsai/database-context.json", "table/query snapshot imports"],
      evidence: ["Database snapshot adapter is cataloged", "Local table/query snapshots remain reviewed context"],
      gaps: ["Live database connections", "Query execution and schema introspection"],
      approvalBoundary: "Database readiness opens no database socket and performs no query.",
      verification: "Mock readiness performs no live database access.",
    },
    {
      id: "log-monitor",
      name: "Log monitor",
      status: "partial",
      configured: true,
      readOnly: true,
      capabilitySources: ["logs-monitor", ".drsai/log-monitor.json", "incremental log snapshot imports"],
      evidence: ["Workspace log monitor adapter is cataloged", "Local log deltas can be reviewed before attach"],
      gaps: ["Live log streaming", "Remote incident correlation"],
      approvalBoundary: "Log monitor readiness starts no tail process, watcher, or remote provider session.",
      verification: "Mock readiness performs no live log streaming.",
    },
    {
      id: "unified",
      name: "Unified connection model",
      status: "available",
      configured: true,
      readOnly: true,
      capabilitySources: ["channel adapter catalog", "Approval Center", "MCP live bridge audit"],
      evidence: ["Connector adapters are cataloged", "Channel actions are approval-gated"],
      gaps: ["Provider-owned process supervision", "Credential vault integration"],
      approvalBoundary: "External services share explicit approval and reviewed context import.",
      verification: "Mock readiness uses local bridge contracts only.",
    },
  ],
};

function buildMockExternalReconnectPolicy(
  id: DesktopExternalConnectionReadinessResult["connections"][number]["id"],
): NonNullable<DesktopExternalConnectionReadinessResult["connections"][number]["reconnectPolicy"]> {
  return {
    mode: "manual_review",
    automatic: false,
    triggers: ["Mock app startup refresh", "Mock Channels refresh", "Mock snapshot sync request"],
    safeguards: [
      "Manual review before any provider runtime starts",
      "No credential lookup, OAuth exchange, network request, or remote mutation",
    ],
    nextStep: `Prepare an approval-gated ${id} reconnect plan when live runtime credentials are available.`,
    verification:
      "Mock reconnect policy is local metadata only; no autonomous reconnect or provider runtime was started.",
  };
}

function buildMockReconnectReadinessChecks(
  connection: DesktopExternalConnectionReadinessResult["connections"][number],
): string[] {
  return [
    connection.configured
      ? "Mock verified provider credential or local adapter configuration is present"
      : "Mock connection setup requires explicit user review",
    "Mock adapter contract is cataloged",
    "Mock remaining live-runtime gaps are visible before reconnect",
    "Mock verification confirms no credential, network, or runtime action ran",
  ];
}

function buildMockExternalConnectionReadiness(workspacePath?: string): DesktopExternalConnectionReadinessResult {
  const adapterByConnection = { github: "github-connector", slack: "slack-chat", docs: "docs-connector", calendar: "calendar-connector" } as const;
  const connections = mockExternalConnectionReadiness.connections.map((base) => {
    const adapterId = adapterByConnection[base.id as keyof typeof adapterByConnection];
    const adapter = adapterId ? mockChannelAdapters.adapters.find((item) => item.id === adapterId) : undefined;
    const configured = adapter ? adapter.configured : base.configured;
    const liveWritable = configured && (adapter?.authMode === "oauth" || adapter?.authMode === "provider_token") && base.id !== "calendar";
    const connection = {
      ...base,
      ...(adapter ? { configured, status: configured ? "available" as const : "partial" as const, readOnly: !liveWritable } : {}),
      capabilitySources: [...base.capabilitySources],
      evidence: [...base.evidence],
      gaps: [...base.gaps],
    };
    return {
      ...connection,
      reconnectReadinessChecks: buildMockReconnectReadinessChecks(connection),
      reconnectPolicy: connection.reconnectPolicy ?? buildMockExternalReconnectPolicy(connection.id),
    };
  });
  return {
    ...mockExternalConnectionReadiness,
    workspacePath,
    generatedAt: new Date().toISOString(),
    readyCount: connections.filter((item) => item.status === "available").length,
    partialCount: connections.filter((item) => item.status === "partial").length,
    plannedCount: connections.filter((item) => item.status === "planned").length,
    connections,
  };
}

const mockWorkflowMarketplace: DesktopWorkflowMarketplaceListResult = {
  generatedAt: new Date().toISOString(),
  availableCount: 4,
  approvalRequiredCount: 1,
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
      approvalRequired: false,
      verification: "Use verify:approval-center and verify:execution-policy; the /commit step owns the write approval.",
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
      status: "available",
      summary:
        "Turn explicitly reviewed, read-only Channel context into a task brief without silently fetching or sending provider data.",
      trigger: "Channels view reviewed context",
      steps: [
        "Load and visibly review Channel context.",
        "Draft a task brief from the reviewed attachments.",
        "Verify citations and provider boundaries.",
      ],
      requiredCapabilities: ["channel adapters", "reviewed context attachments", "chat context injection"],
      approvalRequired: false,
      verification:
        "Run workflow and Channel adapter verification; confirm the brief only cites visible reviewed attachments.",
      risk: "medium",
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

function buildMockWorkflowRunSteps(
  template?: DesktopWorkflowTemplate,
): DesktopWorkflowRunPrepareResult["recipe"]["steps"] {
  if (!template) return [];
  if (template.id === "test-and-commit") {
    return [
      { id: "test", kind: "chat_command", title: "Run focused tests", detail: "Infer and run focused verification.", command: "/test", requiresApproval: false },
      { id: "capture", kind: "manual_review", title: "Capture test evidence", detail: "Confirm terminal evidence is recorded.", requiresApproval: false },
      { id: "preflight", kind: "manual_review", title: "Inspect staged diff", detail: "Review staged files, risk, secrets, and message.", requiresApproval: false },
      { id: "commit", kind: "chat_command", title: "Request commit approval", detail: "Replace the placeholder and use Approval Center.", command: "/commit <message>", requiresApproval: false },
    ];
  }
  if (template.id === "memory-to-skill") {
    return [
      { id: "retrospective", kind: "chat_command", title: "Save retrospective", detail: "Replace the placeholder with a durable lesson.", command: "/memory retrospective <lesson>", requiresApproval: false },
      { id: "draft", kind: "manual_review", title: "Create skill draft", detail: "Create a project skill draft in Skills.", requiresApproval: false },
      { id: "review-skill", kind: "manual_review", title: "Review SKILL.md", detail: "Review scope, instructions, and secret scan.", requiresApproval: false },
      { id: "install-skill", kind: "manual_review", title: "Install after approval", detail: "Use the project skill install approval flow.", requiresApproval: false },
    ];
  }
  if (template.id === "external-runtime-reconnect") {
    return [
      { id: "prepare", kind: "chat_command", title: "Prepare runtime context", detail: "Gather restart and provider scope.", command: "/plan external runtime reconnect", requiresApproval: false },
      { id: "runtime", kind: "external_runtime", title: "Reconnect external runtime", detail: "Reconnect through the provider control plane without automatic process execution.", requiresApproval: true },
      { id: "verify-runtime", kind: "manual_review", title: "Verify runtime result", detail: "Review provider output and background state.", requiresApproval: false },
    ];
  }
  if (template.id === "connector-digest") {
    return [
      { id: "review-context", kind: "manual_review", title: "Review Channel context", detail: "Open Channels, load read-only provider context, and visibly review the attachments. The workflow does not fetch provider data itself.", requiresApproval: false },
      { id: "draft-brief", kind: "chat_command", title: "Draft connector brief", detail: "Synthesize only reviewed Channel attachments visible in the active thread.", command: "Prepare a concise task brief using only visible reviewed Channel attachments. Cite each attachment, separate facts from inferences, and do not fetch or send provider data.", requiresApproval: false },
      { id: "verify-brief", kind: "manual_review", title: "Verify brief boundaries", detail: "Confirm claims are traceable and no provider write or hidden fetch occurred.", requiresApproval: false },
    ];
  }
  return template.steps.map((detail, index) => ({ id: `step-${index + 1}`, kind: "manual_review", title: `Step ${index + 1}`, detail, requiresApproval: false }));
}

export function installMockDesktopApi(): void {
  if (window.openDrSai) return;
  let health = structuredClone(initialHealth);
  let authSession = structuredClone(anonymousSession);
  let pendingAuthProvider: AuthSession["authProvider"] = "ihep";
  let threads: DesktopThread[] = [];
  let threadSnapshots: Record<string, DesktopThreadSnapshot> = {};
  let workspaces: WorkspaceProject[] = [];
  const longConversationFixtureRuns = Math.min(500, Math.max(0, Number(new URLSearchParams(window.location.search).get("longConversationFixture")) || 0));
  if (longConversationFixtureRuns > 0) {
    const threadId = "mock-long-codex-thread";
    const now = new Date().toISOString();
    const messages = Array.from({ length: longConversationFixtureRuns }, (_, index) => {
      const turn = index + 1;
      return [
        { id: `long-user-${turn}`, role: "user" as const, content: `Performance fixture request ${turn}` },
        { id: `long-assistant-${turn}`, role: "assistant" as const, content: `## Result ${turn}\n\nRendered Markdown for a long Codex conversation.\n\n\`\`\`ts\nconst turn = ${turn};\n\`\`\`` },
      ];
    }).flat();
    threads = [{ id: threadId, kind: "chat", title: `${longConversationFixtureRuns}-turn Codex fixture`, createdAt: now, updatedAt: now, runtimeSessionId: "mock-codex-session", boundAgentId: "my-codex", boundAgentName: "Codex", messageCount: messages.length }];
    threadSnapshots = {
      [threadId]: {
        threadId,
        title: threads[0].title,
        messages,
        updatedAt: Date.now(),
        messageCount: messages.length,
        history: { state: "ready", source: "codex", syncedAt: now, loadedRuns: longConversationFixtureRuns, totalRuns: longConversationFixtureRuns, loadedItems: messages.length, totalItems: messages.length },
      },
    };
  }
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
  let myDrSaiModelConnection: MyDrSaiModelConnection = {
    model: "deepseek-v4-flash",
    model_provider: "hepai",
    provider: {
      name: "hepai",
      base_url: "https://aiapi.ihep.ac.cn/apiv2",
      wire_api: "openai",
      requires_api_key: true,
      has_api_key: true,
      api_key_source: "env:HEPAI_API_KEY",
    },
    path: "C:\\Users\\Demo\\.drsai\\config.toml",
  };
  let terminalCounter = 0;
  const chatListeners = new Set<Listener<ChatEvent>>();
  const completionNotificationClickListeners = new Set<Listener<CompletionNotificationClickEvent>>();
  const voiceTranscriptionListeners = new Set<Listener<DesktopVoiceTranscriptionEvent>>();
  const streamingVoiceTranscriptionListeners = new Set<Listener<DesktopStreamingVoiceTranscriptionEvent>>();
  const voiceSynthesisListeners = new Set<Listener<DesktopVoiceSynthesisEvent>>();
  const streamingVoiceSessions = new Map<string, { turnId: string; eventSequence: number; partialSent: boolean }>();
  const voiceFixtureTimers = new Map<string, number>();
  const voiceSynthesisFixtureTimers = new Map<string, number>();
  const agentRunListeners = new Set<Listener<AgentRunEvent>>();
  const installListeners = new Set<Listener<InstallProgress>>();
  const oidcLoginDebugListeners = new Set<Listener<OidcLoginDebugEvent>>();
  const updateListeners = new Set<Listener<UpdateStatus>>();
  const browserTaskListeners = new Set<Listener<BrowserTaskEvent>>();
  const diagnosticListeners = new Set<Listener<DiagnosticEvent>>();
  const runtimeLogListeners = new Set<Listener<DesktopRuntimeLogEvent>>();
  const interactiveDebugListeners = new Set<Listener<InteractiveDebugSession>>();
  let diagnosticEvents: DiagnosticEvent[] = [];
  let interactiveDebugSessions: InteractiveDebugSession[] = [];
  let interactiveDebugPolicy: { enabled: boolean; source: "default" | "user" | "environment"; locked: boolean } = { enabled: false, source: "default", locked: false };
  let pendingApprovals: DesktopPendingApproval[] = [];
  const approvedScheduledWorkflowApprovals = new Set<string>();
  const rejectedScheduledWorkflowApprovals = new Set<string>();
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
    {
      sessionReuseKey: "mcp-reuse:mock-restart",
      workspacePath: "C:\\Users\\Demo\\Projects\\workspace",
      server: "mock-restarted-mcp",
      command: "process-local stdio session from previous app process",
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      lastUsedAt: new Date(Date.now() - 600_000).toISOString(),
      status: "restart_reconnect_required",
      pendingRequestCount: 0,
      restartDetectedAt: new Date().toISOString(),
      diagnosticMessage:
        "Mock reusable MCP pool was seen in the lifecycle audit before restart; reconnect with /mcp sync --reuse or /mcp exec --reuse after approval.",
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
  let userPreferences: DesktopUserPreference[] = [];
  let teamMemory: import("@shared/desktopApi").DesktopTeamMemoryEntry[] = [];
  let customCommands: DesktopCustomCommand[] = [];
  let projectSkillDrafts: DesktopProjectSkillDraft[] = [];
  let mockSyncedWorkflowTemplates: DesktopWorkflowTemplate[] = [];
  let workflowRuns: DesktopWorkflowRun[] = [];
  let backgroundTasks: DesktopBackgroundTask[] = [];
  let reusableTasks: import("@shared/desktopApi").DesktopReusableTask[] = [];
  let shares: DesktopShareManifest[] = [];
  let shareComments: import("@shared/desktopApi").DesktopShareComment[] = [];
  let shareCommentTasks: import("@shared/desktopApi").DesktopShareCommentTask[] = [];
  let shareAudit: import("@shared/desktopApi").DesktopShareAuditEntry[] = [];
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
    afterIso = fromIso,
  ): string | undefined {
    if (cadence === "manual") return undefined;
    const from = new Date(fromIso);
    if (Number.isNaN(from.getTime())) return undefined;
    const next = new Date(from.getTime());
    const after = new Date(afterIso);
    do {
      if (cadence === "hourly") next.setHours(next.getHours() + 1);
      if (cadence === "daily") next.setDate(next.getDate() + 1);
      if (cadence === "weekly") next.setDate(next.getDate() + 7);
    } while (!Number.isNaN(after.getTime()) && next.getTime() <= after.getTime());
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

  type MockSkill = GatewaySkill & { content: string };
  function defaultMockSkillContent(name: string): string {
    return `---\nname: ${name}\ndescription: ""\ncategory: user\n---\n\n# ${name}\n\nDescribe what this skill does here.\n`;
  }
  let mockInstalledSkills: MockSkill[] = [];

  const api: DesktopApi = {
    getPlatformDescriptor: async () => ({
      id: "windows",
      defaultTerminalShell: "powershell",
      capabilities: {
        terminal: true,
        credentials: true,
        notifications: true,
        permissions: true,
        install: true,
        update: true,
        features: FULL_DESKTOP_FEATURE_CAPABILITIES,
      },
    }),
    onOpenRequest: () => () => undefined,
    onLifecycleEvent: () => () => undefined,
    getSystemPermissions: async () => [
      { kind: "microphone", state: "granted", canRequest: false, canOpenSettings: true, message: "Microphone access is granted." },
      { kind: "notifications", state: "granted", canRequest: false, canOpenSettings: true, message: "Notification access is granted." },
      { kind: "files", state: "unknown", canRequest: false, canOpenSettings: true, message: "File access is controlled by system settings." },
      { kind: "automation", state: "unknown", canRequest: false, canOpenSettings: true, message: "Automation access is controlled by system settings." },
    ],
    requestSystemPermission: async (kind) => ({ kind, state: "granted", canRequest: false, canOpenSettings: true, message: `${kind} access is granted.` }),
    openSystemPermissionSettings: async () => true,
    recordDiagnostic: async (input) => {
      const id = input.id || crypto.randomUUID();
      const event: DiagnosticEvent = {
        ...input,
        schemaVersion: 1,
        id,
        traceId: input.traceId || id,
        spanId: input.spanId || id,
        timestamp: input.timestamp || new Date().toISOString(),
        kind: input.kind || "log",
        level: input.level || "info",
        status: input.status || "completed",
        module: input.module,
        component: input.component,
        operation: input.operation,
        message: input.message,
        domain: input.domain || (input.runId || input.turnId || input.backendId ? "agent" : "app"),
        visibility: input.visibility || (input.status === "failed" || input.level === "error" ? "milestone" : "detail"),
      };
      diagnosticEvents = [...diagnosticEvents, event].slice(-500);
      emit(diagnosticListeners, event);
      return event;
    },
    getDiagnosticSnapshot: async () => ({
      generatedAt: new Date().toISOString(),
      events: diagnosticEvents,
      traces: [],
      health: [],
      findings: [],
      deepTracing: { performance: [], resources: [], activeCheckpoints: [], clockOffsets: [] },
      rootCause: { analyses: [], clusters: [], generatedAt: new Date().toISOString() },
      droppedEvents: 0,
      storage: { eventCount: diagnosticEvents.length, maxEvents: 500, persisted: false },
    }),
    clearDiagnostics: async () => {
      const removedEvents = diagnosticEvents.length;
      diagnosticEvents = [];
      return { cleared: true, removedEvents };
    },
    exportDiagnostics: async () => ({
      exported: false,
      eventCount: diagnosticEvents.length,
      message: "Mock diagnostics are not written to disk.",
    }),
    onDiagnosticEvent: (callback) => subscribe(diagnosticListeners, callback),
    getProductionDiagnosticStatus: async () => ({
      settings: { mode: "basic", retentionDays: 30, diskLimitMb: 64, remoteTransmission: false, includeSource: false, allowRemoteTargets: false, allowDebugAttach: false, allowExport: true, encryptedPackages: true },
      lockedSettings: [], policySource: "defaults", selfCheck: "healthy", selfCheckMessages: [], degraded: false,
      eventRatePerMinute: 0, observedEvents: diagnosticEvents.length, droppedEvents: 0, estimatedBytes: 0,
      budgets: { cpuPercent: 2, memoryMb: 64, diskMb: 64, uiLatencyMs: 50 },
      releaseGates: [{ id: "privacy-scan", passed: true, message: "Mock privacy gate passed." }], audit: [],
    }),
    updateProductionDiagnosticSettings: async (patch) => ({ ...(await api.getProductionDiagnosticStatus()), settings: { ...(await api.getProductionDiagnosticStatus()).settings, ...patch } }),
    previewDiagnosticPackage: async () => ({ formatVersion: 1, encrypted: true, eventCount: diagnosticEvents.length, byteLength: 0, sensitiveMatchesRemoved: 0, sections: ["manifest", "snapshot"], integritySha256: "mock-sha256", warnings: [] }),
    exportProductionDiagnosticPackage: async () => ({ ok: false, preview: await api.previewDiagnosticPackage(), message: "Mock package export is not written to disk." }),
    importProductionDiagnosticPackage: async () => null,
    getDiagnosticSourceContext: async (request) => {
      const highlightLine = Math.max(1, request.source.line ?? 2);
      const startLine = Math.max(1, highlightLine - 1);
      return {
        available: true,
        address: {
          ...request.source,
          kind: "workspace",
          uri: `file://${request.source.file || "mock-source.ts"}`,
          workspaceId: request.workspaceId,
          available: true,
          trusted: true,
          remote: false,
        },
        mapping: {
          status: "not-required",
          generated: request.source,
          message: "Mock source already refers to original code.",
        },
        location: request.source,
        content: "export function mockSource(): void {\n  throw new Error(\"Mock diagnostic failure\");\n}",
        startLine,
        endLine: startLine + 2,
        highlightLine,
        language: request.source.language ?? "typescript",
        truncated: false,
        redacted: false,
        canOpen: true,
      };
    },
    openDiagnosticSource: async (request) => ({
      opened: true,
      path: request.source.file,
      line: request.source.line,
      column: request.source.column,
      message: "Mock source opened.",
    }),
    updateDiagnosticIssue: async (request) => ({ updated: true, message: `Mock diagnostic issue ${request.action} completed.` }),
    getInteractiveDebugPolicy: async () => interactiveDebugPolicy,
    updateInteractiveDebugPolicy: async (request) => {
      interactiveDebugPolicy = { enabled: request.enabled, source: "user" as const, locked: false };
      if (!request.enabled) interactiveDebugSessions = [];
      return interactiveDebugPolicy;
    },
    listInteractiveDebugTargets: async () => [{ id: "electron-renderer", kind: "electron-renderer", name: "Electron Renderer", description: "Mock renderer debug target", available: true, remote: false, capabilities: { supportsPause: true, supportsStep: true, supportsConditionalBreakpoints: true, supportsHitConditionalBreakpoints: true, supportsLogPoints: true, supportsEvaluateForHovers: true, supportsSetVariable: false, supportsTerminateRequest: true, supportsRemoteTargets: false } }],
    listInteractiveDebugSessions: async () => interactiveDebugSessions,
    startInteractiveDebugSession: async (request) => {
      const target = (await api.listInteractiveDebugTargets())[0];
      const now = new Date().toISOString();
      const session: InteractiveDebugSession = { id: `debug-${crypto.randomUUID()}`, target, state: "running", startedAt: now, updatedAt: now, breakpoints: [], stackFrames: [], message: "Mock debug session is running", traceId: request.traceId };
      interactiveDebugSessions = [session, ...interactiveDebugSessions]; emit(interactiveDebugListeners, session); return session;
    },
    setInteractiveDebugBreakpoint: async (request) => {
      const session = interactiveDebugSessions.find((item) => item.id === request.sessionId); if (!session) throw new Error("Debug session was not found.");
      session.breakpoints = [...session.breakpoints, { id: `bp-${crypto.randomUUID()}`, source: request.source, enabled: request.enabled !== false, verified: true, condition: request.condition, hitCondition: request.hitCondition, logMessage: request.logMessage }]; session.updatedAt = new Date().toISOString(); emit(interactiveDebugListeners, session); return session;
    },
    controlInteractiveDebugSession: async (request) => {
      const session = interactiveDebugSessions.find((item) => item.id === request.sessionId); if (!session) throw new Error("Debug session was not found.");
      session.state = request.action === "pause" ? "paused" : request.action === "disconnect" || request.action === "terminate" ? "disconnected" : "running"; session.pausedReason = session.state === "paused" ? "Mock breakpoint" : undefined; session.stackFrames = session.state === "paused" ? [{ id: "mock-frame", name: "mockSource", source: { file: "mock-source.ts", line: 2, column: 3, language: "typescript" }, canRestart: false }] : []; session.activeFrameId = session.stackFrames[0]?.id; session.activeThreadId = session.state === "paused" ? "renderer" : undefined; session.updatedAt = new Date().toISOString(); emit(interactiveDebugListeners, session); return session;
    },
    getInteractiveDebugScopes: async (_sessionId, frameId) => [{ id: `${frameId}:local`, name: "Local", variablesReference: "mock-local", expensive: false }],
    getInteractiveDebugVariables: async () => [{ name: "answer", value: "42", type: "number", sensitive: false }, { name: "apiToken", value: "[REDACTED]", type: "string", sensitive: true }],
    evaluateInteractiveDebugExpression: async (request) => ({ result: request.expression === "answer" ? "42" : "undefined", type: "number", safe: true, message: "Mock read-only expression evaluated." }),
    onInteractiveDebugEvent: (callback) => subscribe(interactiveDebugListeners, callback),
    getAuthSession: async () => authSession,
    getA5ServiceGuidanceScenario: async () => null,
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
        "Loaded mock discovery from https://ai-dev.ihep.ac.cn/api.",
        "success",
        "https://ai-dev.ihep.ac.cn/api/.well-known/openid-configuration",
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
    previewLocalDataCleanup: async (scope) => ({
      scope,
      applicationData: [{ category: "sessions", label: "会话", description: "清除会话记录。" }],
      preservedUserMaterials: [],
      preservesAllWorkspaceFiles: true,
      ...(scope === "all_local_data" ? { confirmationPhrase: "清除" } : {}),
      requiresSignInAgain: scope === "all_local_data",
    }),
    clearLocalData: async (request) => ({
      ok: true,
      scope: request.scope,
      removedPaths: [],
      protectedWorkspacePaths: [],
      skippedTargets: [],
      requiresSignInAgain: request.scope === "all_local_data",
      message: "应用数据已清除；用户工作区文件和成果未受影响。",
    }),
    refreshAuthSession: async () => authSession,
    getHealth: async () => health,
    getInstallStatus: async () => health.install,
    getGatewayStatus: async () => health.gateway,
    getCodexBackendStatus: async () => ({ backendId: "codex", state: "available", available: true,
      version: "0.142.5", loggedIn: true, authMode: "chatgpt", accountLabel: "demo@example.test",
      reason: null, retryable: false, action: "none" }),
    restartCodexBackend: async () => ({ backendId: "codex", state: "available", available: true,
      version: "0.142.5", loggedIn: true, authMode: "chatgpt", accountLabel: "demo@example.test",
      reason: null, retryable: false, action: "none" }),
    syncCodexWorkspaceSessions: async (workspaceId) => ({ workspaceId, discovered: 0, active: 0,
      archived: 0, created: 0, updated: 0, skipped: 0, threads: [] }),
    startCodexBackendLogin: async (type = "chatgpt") => ({ type, loginId: "mock-codex-login",
      verificationUrl: "https://example.test/device", userCode: "MOCK-CODE" }),
    cancelCodexBackendLogin: async () => true,
    logoutCodexBackend: async () => true,
    listProviderUsageAnalytics: async () => [
      {
        id: "provider-usage:mock",
        recordedAt: new Date(Date.now() - 60_000).toISOString(),
        requestId: "mock-request-usage",
        sessionId: "mock-session",
        runId: "mock-run",
        provider: "openai_responses",
        eventName: "response.completed",
        status: "completed",
        summary: "Mock OpenAI Responses stream completed. input_tokens=120 output_tokens=32 total_tokens=152",
        usage: { inputTokens: 120, outputTokens: 32, totalTokens: 152 },
      },
      {
        id: "provider-usage:mock-gemini",
        recordedAt: new Date(Date.now() - 45_000).toISOString(),
        requestId: "mock-request-gemini-usage",
        sessionId: "mock-session",
        runId: "mock-run",
        provider: "google_gemini",
        eventName: "generateContent.stream",
        status: "STOP",
        summary: "Mock Gemini stream finished. finish_reason=STOP input_tokens=18 output_tokens=44 total_tokens=62",
        usage: { inputTokens: 18, outputTokens: 44, totalTokens: 62 },
      },
    ],
    listProviderErrorAnalytics: async () => [
      {
        id: "provider-error:mock",
        recordedAt: new Date(Date.now() - 30_000).toISOString(),
        requestId: "mock-request-error",
        sessionId: "mock-session",
        runId: "mock-run",
        provider: "anthropic",
        eventName: "error",
        code: "overloaded_error",
        message: "Mock provider overloaded",
        retryable: true,
        summary: "Mock Anthropic stream error. code=overloaded_error message=Mock provider overloaded retryable=true",
      },
    ],
    checkForUpdates: async () => {
      health = {
        ...health,
        update: {
          phase: "available",
          checking: false,
          available: true,
          downloading: false,
          downloaded: false,
          progress: null,
          version: "0.1.1",
          currentVersion: "0.1.0",
          mandatory: false,
          releaseNotesUrl: "https://github.com/hepai-lab/drsai/releases/tag/v0.1.1",
          canDownload: true,
          canInstall: false,
          canCancel: false,
          errorCode: null,
          error: null,
          recovery: null,
          source: "cdn",
          fallbackUsed: false,
        },
      };
      emit(updateListeners, health.update);
      return health.update;
    },
    downloadUpdate: async () => {
      health = {
        ...health,
        update: {
          ...health.update,
          phase: "ready",
          downloading: false,
          downloaded: true,
          progress: 100,
          canDownload: false,
          canInstall: true,
          canCancel: false,
        },
      };
      emit(updateListeners, health.update);
      return health.update;
    },
    cancelUpdate: async () => health.update,
    installUpdate: async () => {
      health = { ...health, update: { ...health.update, phase: "installing", canInstall: false } };
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
    copyTextToClipboard: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    performEditCommand: async (command) => {
      document.execCommand(command);
      return true;
    },
    openLogFolder: async () => "",
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
    getMobilePairingReadiness: async () => ({
      state: "ready",
      action: "scan",
      runtime_id: "runtime_mock",
      environment: "development",
    }),
    enableMobileRemoteAccess: async () => ({
      state: "ready",
      action: "scan",
      runtime_id: "runtime_mock",
      environment: "development",
    }),
    createMobilePairingGrant: async () => ({
      grant_id: "ag_00000000000000000000000000000000",
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      status: "pending",
      payload: "opendrsai://associate?v=1&environment=development&issuer=https%3A%2F%2Fai-dev.ihep.ac.cn&code=ABCDEFGHJKLMNPQR",
    }),
    getMobilePairingGrant: async (grantId) => ({
      grant_id: grantId,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      status: "consumed",
    }),
    revokeMobilePairingGrant: async (grantId) => ({
      grant_id: grantId,
      expires_at: new Date().toISOString(),
      status: "revoked",
    }),
    listMobileAssociations: async () => [{
      association_id: "assoc_00000000000000000000000000000000",
      subject_summary: "sub_000000000000",
      device_summary: "dev_000000000000",
      device_name: "Samsung SM-X936C",
      status: "active",
      access_state: "online",
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    }],
    revokeMobileAssociation: async (associationId) => ({
      association_id: associationId,
      subject_summary: "sub_000000000000",
      device_summary: "dev_000000000000",
      device_name: "Samsung SM-X936C",
      status: "revoked",
      access_state: "revoked",
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      revoked_at: new Date().toISOString(),
    }),
    revokeMobileRuntimeEnrollment: async () => ({
      runtime_id: "runtime_mock",
      status: "revoked",
      revoked_at: new Date().toISOString(),
    }),
    listSshHosts: async () => [],
    diagnoseSshHost: async (hostAlias) => ({ hostAlias, state: "reachable", elapsedMs: 1 }),
    inspectSshHostKeys: async (hostAlias) => [{ hostAlias, hostname: "127.0.0.1", port: 22, algorithm: "ssh-ed25519", fingerprint: "SHA256:mock" }],
    testSshHost: async () => true,
    approveSshHostKey: async () => true,
    connectSshHost: async (hostAlias) => ({ hostAlias, action: "connect", changed: true }),
    disconnectSshHost: async (hostAlias) => ({ hostAlias, action: "disconnect", changed: true }),
    reconnectSshHost: async (hostAlias) => ({ hostAlias, action: "reconnect", changed: true }),
    removeSshHost: async (hostAlias) => ({ hostAlias, action: "remove", changed: true }),
    listPortForwards: async () => [],
    createPortForward: async (request) => ({ portForwardId: `pf-${crypto.randomUUID()}`, hostAlias: request.hostAlias, workspaceId: request.workspaceId, remoteHost: request.remoteHost || "127.0.0.1", remotePort: request.remotePort, bindAddress: "127.0.0.1", localPort: request.localPort || 18080, status: "active", reconnectPolicy: request.reconnectPolicy || "automatic", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    pausePortForward: async (id) => ({ portForwardId: id, hostAlias: "mock", workspaceId: "mock", remoteHost: "127.0.0.1", remotePort: 80, bindAddress: "127.0.0.1", localPort: 18080, status: "paused", reconnectPolicy: "automatic", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    resumePortForward: async (id) => ({ portForwardId: id, hostAlias: "mock", workspaceId: "mock", remoteHost: "127.0.0.1", remotePort: 80, bindAddress: "127.0.0.1", localPort: 18080, status: "active", reconnectPolicy: "automatic", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    removePortForward: async () => true,
    listRemoteDirectories: async (_hostAlias, path = "/home") => [
      { name: "vscode", path: `${path.replace(/\/$/, "")}/vscode`, directory: true },
    ],
    connectRemoteWorkspace: async (request) => {
      const now = new Date().toISOString();
      const id = `ssh-mock-${crypto.randomUUID()}`;
      const workspace: WorkspaceProject = {
        id,
        name: request.name || request.path.split("/").filter(Boolean).at(-1) || "Remote workspace",
        path: request.path,
        location: "remote",
        transport: "ssh",
        type: "remote-ssh",
        remote: {
          hostAlias: request.hostAlias,
          canonicalPath: request.path,
          workspaceId: id,
          connectionState: "ready",
          localPort: 18643,
        },
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        trusted: request.trusted ?? false,
      };
      workspaces = [workspace, ...workspaces];
      return workspace;
    },
    disconnectRemoteWorkspace: async () => true,
    getRemoteWorkspaceStatus: async (workspaceId) => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (!workspace?.remote) throw new Error("Remote workspace not found.");
      return { ...workspace.remote, connected: true, gatewayReady: true };
    },
    listRemoteThreads: async () => [],
    listRemoteHepaiWorkers: async () => [],
    setRemoteHepaiWorkerEnabled: async () => true,
    onRemoteWorkspaceStatus: () => () => undefined,
    preflightRemoteGateway: async (hostAlias) => ({ hostAlias, operatingSystem: "linux", architecture: "x86_64", pythonVersion: "3.11.0", compatible: true, issues: [], gatewayInstalled: true, gatewayVersion: "1.4.8" }),
    getRemoteSshDiagnosticReport: async () => ({ generatedAt: new Date().toISOString(), hosts: [] }),
    installRemoteGateway: async (request) => ({ hostAlias: request.hostAlias, operatingSystem: "linux", architecture: "x86_64", pythonVersion: "3.11.0", compatible: true, issues: [], gatewayInstalled: true, gatewayVersion: request.version || "1.4.8", changed: true, action: request.action }),
    requestRemoteGatewayInstallApproval: async () => ({ queued: true, allowed: true, requiresApproval: true, blocked: false, reason: "Mock remote Gateway operation queued for approval." }),
    cancelRemoteGatewayOperation: async () => true,
    onRemoteGatewayOperation: () => () => undefined,
    onWorkspaceFileChanges: () => () => undefined,
    generateManagerPresentation: async (request) => {
      const outputPath = `${request.workspacePath}\\artifacts\\mock-manager-zh.pptx`;
      return {
        requestId: request.requestId,
        audience: request.audience ?? "non_expert_managers",
        sourcePath: request.sourcePath,
        outputPath,
        manifestPath: outputPath.replace(/\.pptx$/i, ".provenance.json"),
        slideCount: 9,
        speakerNotesCoverage: 1,
        sourcePageCoverage: 1,
        sourceLinks: [
          { slide: 3, role: "background", title: "背景与规模变化", sourcePages: [3, 8, 10] },
          { slide: 6, role: "data_challenges", title: "数据挑战", sourcePages: [41, 42, 43] },
          { slide: 7, role: "hl_lhc_requirements", title: "带宽模型", sourcePages: [42, 43] },
          { slide: 8, role: "conclusions", title: "总结", sourcePages: [47] },
        ],
        keyConclusions: [
          { id: "hl_lhc_data_growth_10x", conclusion: "HL-LHC 将使实验数据产量增长约 10 倍。", sourcePath: request.sourcePath, sourceType: "pdf_page", page: 8, evidenceText: "increasing the volume of data produced by the experiments by a factor of 10", verified: true, citations: [{ id: "c1", title: "Distributed computing for High Energy Physics", authors: ["Edoardo Martelli"], sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.8", excerpt: "increasing the volume of data produced by the experiments by a factor of 10", relation: "supports", supportScore: 1 }], numericEvidence: [{ id: "n1", label: "HL-LHC 数据增长倍数", displayValue: "10×", reportedValue: 10, unit: "×", kind: "direct", sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.8", sourceValues: [{ label: "原文增长倍数", value: 10, unit: "×", sourcePath: request.sourcePath, locator: "p.8", rawText: "factor of 10" }], formula: "直接读取原文数值 10", recalculatedValue: 10, tolerance: 0, status: "verified", explanation: "报告值与原文一致。" }], trust: mockTrustAssessment("evidence_sufficient") },
          { id: "minimal_bandwidth_4_8_tbps", conclusion: "HL-LHC 最低网络模型预计需要 4.8 Tbps 带宽。", sourcePath: request.sourcePath, sourceType: "pdf_page", page: 42, evidenceText: "4.8Tbps expected HL-LHC bandwidth", verified: true, citations: [{ id: "c2", title: "Distributed computing for High Energy Physics", authors: ["Edoardo Martelli"], sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.42", excerpt: "4.8Tbps expected HL-LHC bandwidth", relation: "supports", supportScore: 1 }], numericEvidence: [{ id: "n2", label: "Minimal Model 带宽", displayValue: "4.8 Tbps", reportedValue: 4.8, unit: "Tbps", kind: "calculated", sourcePath: request.sourcePath, locatorType: "calculation", locator: "p.42 · Minimal Model", sourceValues: [{ label: "基础流量", value: 1.2, unit: "Tbps", sourcePath: request.sourcePath, locator: "p.42", rawText: "sum of experiment rates" }], formula: "1.2 × 2 × 2", recalculatedValue: 4.8, tolerance: 0.000001, status: "verified", explanation: "复算结果与报告值一致。" }], trust: mockTrustAssessment("evidence_sufficient") },
          { id: "flexible_bandwidth_9_6_tbps", conclusion: "HL-LHC 灵活网络模型预计需要 9.6 Tbps 带宽。", sourcePath: request.sourcePath, sourceType: "pdf_page", page: 42, evidenceText: "9.6Tbps expected HL-LHC bandwidth", verified: true, citations: [{ id: "c3", title: "Distributed computing for High Energy Physics", authors: ["Edoardo Martelli"], sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.42", excerpt: "9.6Tbps expected HL-LHC bandwidth", relation: "supports", supportScore: 1 }], numericEvidence: [{ id: "n3", label: "Flexible Model 带宽", displayValue: "9.6 Tbps", reportedValue: 9.6, unit: "Tbps", kind: "calculated", sourcePath: request.sourcePath, locatorType: "calculation", locator: "p.42 · Flexible Model", sourceValues: [{ label: "Minimal Model", value: 4.8, unit: "Tbps", sourcePath: request.sourcePath, locator: "p.42", rawText: "4.8Tbps" }], formula: "4.8 × 2", recalculatedValue: 9.6, tolerance: 0.000001, status: "verified", explanation: "复算结果与报告值一致。" }], trust: mockTrustAssessment("evidence_sufficient") },
          { id: "data_challenge_2027_50_percent", conclusion: "2027 年 Data Challenge 计划验证 HL-LHC 需求的 50%。", sourcePath: request.sourcePath, sourceType: "pdf_page", page: 43, evidenceText: "2027: 50% of HL-LHC requirements", verified: true, citations: [{ id: "c4", title: "Distributed computing for High Energy Physics", authors: ["Edoardo Martelli"], sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.43", excerpt: "2027: 50% of HL-LHC requirements", relation: "supports", supportScore: 1 }], numericEvidence: [{ id: "n4", label: "2027 Data Challenge 目标", displayValue: "50%", reportedValue: 50, unit: "%", kind: "direct", sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.43", sourceValues: [{ label: "原文目标比例", value: 50, unit: "%", sourcePath: request.sourcePath, locator: "p.43", rawText: "2027: 50%" }], formula: "直接读取 50", recalculatedValue: 50, tolerance: 0, status: "verified", explanation: "报告值与原文一致。" }], trust: mockTrustAssessment("evidence_sufficient") },
          { id: "data_challenge_2029_100_percent_uncertain", conclusion: "2029 年 Data Challenge 暂以验证 100% HL-LHC 需求为目标，日期和比例仍待确认。", sourcePath: request.sourcePath, sourceType: "pdf_page", page: 43, evidenceText: "2029: 100% of HL-LHC requirements (date and % to be confirmed)", verified: true, citations: [{ id: "c5", title: "Distributed computing for High Energy Physics", authors: ["Edoardo Martelli"], sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.43", excerpt: "2029: 100% of HL-LHC requirements (date and % to be confirmed)", relation: "supports", supportScore: 1 }], numericEvidence: [{ id: "n5", label: "2029 Data Challenge 暂定目标", displayValue: "100%（待确认）", reportedValue: 100, unit: "%", kind: "direct", sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.43", sourceValues: [{ label: "原文暂定目标", value: 100, unit: "%", sourcePath: request.sourcePath, locator: "p.43", rawText: "100% (date and % to be confirmed)" }], formula: "原文暂定值 100", tolerance: 0, status: "unverifiable", explanation: "原文明确标注日期和比例待确认。" }], uncertainty: { status: "insufficient_data", label: "计划数据不足 · 日期与比例待确认", explanation: "来源明确说明日期和比例仍待确认，不能表达为确定承诺。", recommendedAction: "等待正式计划更新并保留暂定措辞。", requiresQualification: true, qualifyingLanguage: ["暂以", "仍待确认"], claims: [{ id: "u1", position: "暂定目标", sourcePath: request.sourcePath, locatorType: "pdf_page", locator: "p.43", excerpt: "2029: 100% of HL-LHC requirements (date and % to be confirmed)", stance: "insufficient" }] }, trust: mockTrustAssessment("needs_confirmation") },
        ],
        conclusionTraceabilityRate: 1,
        appliedRequirements: request.requirements ?? [],
        stageArtifacts: [],
        deliverySummary: {
          findingSummary: "已生成管理者版 PPT。",
          importance: "high",
          importanceReason: "结果包含需要管理层关注的资源规划。",
          artifacts: [{ id: "mock-pptx", label: "管理者版 PPT", path: outputPath, kind: "presentation" }],
          suggestedAction: "打开 PPT 并核对关键数字。",
          workSummary: "已分析 PDF 并生成演示文稿。",
          coreConclusion: "需要提前准备计算和网络能力。",
          verification: "自动结构验收通过。",
          remainingRisks: "时间目标仍需确认。",
        },
        quality: {
          ok: true,
          checks: { mock: true },
          failures: [],
          mediaCount: 0,
          sourcePageCoverage: 1,
        },
        audienceProfile: {
          audience: request.audience ?? "non_expert_managers",
          goldenFactIds: ["data_growth_10x", "minimal_4_8_tbps", "flexible_9_6_tbps", "dc_2027_50", "dc_2029_100"],
          impactDecisionSignals: request.audience === "technical_experts" ? 1 : 8,
          technicalDetailSignals: request.audience === "technical_experts" ? 12 : 4,
          acronymOccurrences: request.audience === "technical_experts" ? 14 : 5,
          contentHash: request.audience === "technical_experts" ? "mock-technical" : "mock-manager",
        },
      };
    },
    cancelManagerPresentation: async (request) => ({ requestId: request.requestId, accepted: true }),
    pauseManagerPresentation: async (request) => ({ requestId: request.requestId, accepted: true }),
    resumeManagerPresentation: async (request) => ({ requestId: request.requestId, accepted: true }),
    updateManagerPresentationRequirement: async (request) => ({
      requestId: request.requestId,
      accepted: true,
      activeStage: "planning",
      scope: "current_unfinished_stages",
      requirements: [request.text],
      message: "已应用到当前任务尚未完成的规划、生成和验收阶段。",
    }),
    getManagerPresentationRecovery: async () => null,
    resolveManagerPresentationRecovery: async (request) => ({ requestId: request.requestId, decision: request.decision, accepted: true }),
    onManagerPresentationProgress: () => () => undefined,
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
        location: "local",
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
        model: "deepseek-v4-pro",
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
    setDefaultAgent: async (agentId) => ({
      agentId,
      saved: true,
      message: "Mock default agent saved.",
    }),
    recordAgentUsage: async (agentId) => ({
      agentId,
      saved: true,
      message: "Mock agent usage recorded.",
    }),
    getPlatformAgentStatus: async () => ({
      state: "ready",
      apiVersion: "fixture-v1",
      capabilities: ["agents"],
      message: "Platform Native API fixture is available.",
      lastCheckedAt: new Date().toISOString(),
    }),
    getMyDrSaiConfig: async (workspacePath?: string): Promise<MyDrSaiConfig> => ({
      ready: health.gatewayReady,
      baseUrl: health.gateway.baseUrl,
      cliPath: "C:\\Users\\Demo\\.drsai\\cli_config.json",
      config: myDrSaiCliConfig,
      defaultModelAlias: myDrSaiCliConfig.defult_config_name,
      modelConnection: myDrSaiModelConnection,
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
    updateMyDrSaiModelConnection: async (request) => {
      myDrSaiModelConnection = {
        model: request.model,
        model_provider: request.model_provider,
        provider: {
          name: request.model_provider,
          base_url: request.base_url || myDrSaiModelConnection.provider.base_url,
          wire_api: request.wire_api || "openai",
          requires_api_key: request.requires_api_key ?? true,
          has_api_key: Boolean(request.api_key || request.api_key_env || myDrSaiModelConnection.provider.has_api_key),
          api_key_source: request.api_key ? "config" : request.api_key_env ? `env:${request.api_key_env}` : myDrSaiModelConnection.provider.api_key_source,
        },
        path: myDrSaiModelConnection.path,
      };
      return structuredClone(myDrSaiModelConnection);
    },
    testMyDrSaiModelProvider: async (provider) => ({ ok: provider === myDrSaiModelConnection.model_provider, provider, wire_api: myDrSaiModelConnection.provider.wire_api }),
    testMyDrSaiModelDraft: async (request) => ({ ok: Boolean(request.model && request.model_provider && request.base_url), provider: request.model_provider, wire_api: request.wire_api ?? "openai", persisted: false }),
    listMyDrSaiModelProviderPresets: async () => [{ id: "hepai", label: "HepAI", base_url: "https://aiapi.ihep.ac.cn/apiv2", wire_api: "openai", requires_api_key: true, api_key_env: "HEPAI_API_KEY", base_url_editable: false, supports_model_discovery: true }],
    discoverMyDrSaiProviderModels: async (provider) => ({ ok: true, provider, models: [myDrSaiModelConnection.model], cached: false }),
    deleteMyDrSaiModelProvider: async (provider, _deleteCredential = true) => {
      if (provider === myDrSaiModelConnection.model_provider) {
        myDrSaiModelConnection = { ...myDrSaiModelConnection, model_provider: "hepai", provider: { ...myDrSaiModelConnection.provider, name: "hepai", base_url: "https://aiapi.ihep.ac.cn/apiv2" } };
      }
      return { ok: true, active: myDrSaiModelConnection.model_provider };
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
    deleteThread: async (threadId) => {
      const exists = threads.some((thread) => thread.id === threadId);
      threads = threads.filter((thread) => thread.id !== threadId);
      const { [threadId]: _deletedSnapshot, ...remainingSnapshots } = threadSnapshots;
      threadSnapshots = remainingSnapshots;
      return exists;
    },
    setThreadArchived: async ({ threadId, archived }) => {
      const existing = threads.find((thread) => thread.id === threadId);
      if (!existing) throw new Error("Thread no longer exists.");
      const archiveSource: "codex" | "opendrsai" | undefined = archived ? (existing.boundAgentId === "my-codex" ? "codex" : "opendrsai") : undefined;
      const thread = { ...existing, archived, archivedAt: archived ? new Date().toISOString() : undefined, archiveSource, updatedAt: new Date().toISOString() };
      threads = [thread, ...threads.filter((item) => item.id !== threadId)];
      return thread;
    },
    getThreadSnapshot: async (threadId) => threadSnapshots[threadId] ?? null,
    subscribeThreadSnapshot: async () => false,
    unsubscribeThreadSnapshot: async () => false,
    onThreadSnapshot: () => () => undefined,
    onRuntimeLogEvent: (callback) => subscribe(runtimeLogListeners, callback),
    onThreadCatalogUpdate: () => () => undefined,
    searchThreadMessages: async (request) => {
      const query = request.query.trim().toLowerCase();
      if (!query) return [];
      const allowedThreadIds = request.threadIds ? new Set(request.threadIds) : null;
      const limit = Math.max(1, Math.min(request.limit ?? 24, 50));
      return Object.values(threadSnapshots)
        .filter((snapshot) => !allowedThreadIds || allowedThreadIds.has(snapshot.threadId))
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .flatMap((snapshot) => {
          const message = [...snapshot.messages]
            .reverse()
            .find((candidate) => candidate.role !== "system" && candidate.content.toLowerCase().includes(query));
          if (!message) return [];
          const content = message.content.replace(/\s+/g, " ").trim();
          const matchIndex = content.toLowerCase().indexOf(query);
          const start = Math.max(0, matchIndex - 72);
          const end = Math.min(content.length, matchIndex + query.length + 72);
          return [{
            threadId: snapshot.threadId,
            messageId: message.id,
            role: message.role,
            snippet: `${start > 0 ? "..." : ""}${content.slice(start, end)}${end < content.length ? "..." : ""}`,
            updatedAt: snapshot.updatedAt,
          }];
        })
        .slice(0, limit);
    },
    updateThreadSnapshot: async (snapshot) => {
      threadSnapshots = {
        ...threadSnapshots,
        [snapshot.threadId]: snapshot,
      };
      return snapshot;
    },
    createThreadShare: async (request) => {
      const snapshot = threadSnapshots[request.threadId];
      if (!snapshot) throw new Error("Conversation not found or has no messages to share.");
      const selectedIds = request.messageIds ? new Set(request.messageIds) : null;
      const messages = snapshot.messages
        .filter((message) => message.role !== "system")
        .filter((message) => (selectedIds ? selectedIds.has(message.id) : true));
      if (!messages.length) throw new Error("Select at least one message to share.");
      const shareId = `share_${Date.now().toString(36)}`;
      const title = request.title?.trim() || snapshot.messages.find((m) => m.role === "user")?.content?.slice(0, 40) || "Conversation";
      const filePath = `mock://shares/${shareId}.html`;
      return {
        shareId,
        threadId: request.threadId,
        title,
        messageCount: messages.length,
        filePath,
        fileUrl: filePath,
        publicShareUrl: `https://opendrsai.ihep.ac.cn/share?token=${shareId}`,
        shareToken: shareId,
        deepLink: `opendrsai://share/${shareId}`,
        createdAt: new Date().toISOString(),
        readOnly: true as const,
      };
    },
    openThreadShare: async () => true,
    revealThreadShare: async () => true,
    listInstalledSkills: async () =>
      mockInstalledSkills.map(({ content: _content, ...skill }) => skill),
    listAvailableSkills: async () => [],
    getSkillContent: async (request) => {
      const skill = mockInstalledSkills.find((item) => item.path === request.skillPath || item.name === request.skillPath);
      if (!skill) throw new Error(`Skill not found: ${request.skillPath}`);
      return { path: `${skill.path}/SKILL.md`, content: skill.content };
    },
    installSkill: async (request) => {
      if (mockInstalledSkills.some((skill) => skill.name === request.name)) {
        throw new Error(`skill '${request.name}' already exists`);
      }
      const content = request.content || defaultMockSkillContent(request.name);
      const path = `mock://skills/${request.name}`;
      mockInstalledSkills.push({
        name: request.name,
        category: "user",
        description: "",
        path,
        size: content.length,
        mtime: Date.now() / 1000,
        content,
      });
      return { status: "ok", name: request.name, path };
    },
    updateSkill: async (request) => {
      const skill = mockInstalledSkills.find((item) => item.name === request.name);
      if (!skill) throw new Error(`skill '${request.name}' not found`);
      skill.content = request.content;
      skill.size = request.content.length;
      skill.mtime = Date.now() / 1000;
      return { status: "ok", name: request.name, path: skill.path };
    },
    uninstallSkill: async (request) => {
      mockInstalledSkills = mockInstalledSkills.filter((skill) => skill.name !== request.name);
      return { status: "ok", name: request.name };
    },
    reloadSkills: async () => ({ ok: true, reloaded: true }),
    gfsList: async () => ({ items: [], prefix: "", truncated: false }),
    gfsStat: async (request) => ({
      path: request.path,
      size: 0,
      etag: "",
      modifiedMs: 0,
      isDir: request.path.endsWith("/"),
    }),
    gfsRead: async (request) => ({ path: request.path, content: "" }),
    gfsWrite: async (request) => ({ path: request.path, etag: "mock" }),
    gfsUploadFile: async (request) => ({ path: request.remotePath, size: 0 }),
    gfsDownloadFile: async (request) => ({ localPath: request.localPath, size: 0 }),
    gfsDelete: async (request) => ({ path: request.path }),
    gfsShareUrl: async () => ({
      url: "https://example.invalid/mock-gfs-share",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
    gfsHealthcheck: async () => ({ ok: true, mode: "mock" }),
    prepareForkWorktree: async (request) => {
      const slug = (request.intent || "subtask")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "subtask";
      return {
        location: "local",
        sourceWorkspacePath: request.workspacePath,
        repoRoot: request.workspacePath,
        worktreePath: `${request.workspacePath}\\.drsai-forks\\${slug}`,
        branch: `drsai/fork/${slug}-mock`,
        baseRef: "mock-head",
        sourceHasChanges: false,
      };
    },
    startChat: async (request) => {
      const requestId = request.requestId || crypto.randomUUID();
      const turnId = request.runId || requestId;
      const visualFixture = request.messages.some((message) => message.content.includes("__STRUCTURED_VISUAL_FIXTURE__"));
      if (visualFixture) {
        const runtimeBase = {
          timestamp: new Date().toISOString(), threadId: "mock-thread", sessionId: "oaep-session-visual",
          protocol: "oaep/1" as const, level: "info" as const,
        };
        emit(runtimeLogListeners, { ...runtimeBase, id: "runtime-visual-capability", status: "completed", phase: "capability", operation: "runtime.protocol.selected", message: "Runtime selected OAEP v1 for this session.", details: { capabilities: ["oaep.v1", "oaep.session.events.stream"] } });
        emit(runtimeLogListeners, { ...runtimeBase, id: "runtime-visual-stream", status: "running", phase: "stream", operation: "oaep.stream.connected", message: "OAEP event stream connected after cursor 41.", cursor: 41, details: { httpStatus: 200 } });
        emit(runtimeLogListeners, { ...runtimeBase, id: "runtime-visual-event", level: "debug", status: "running", phase: "event", operation: "oaep.event.received", message: "event.item.delta · sequence 42", eventType: "event.item.delta", sequence: 42, cursor: 42, runId: "run-visual", itemId: "item-visual", source: "codex", details: { eventId: "oaep-event-42", dedupeKey: "run-visual:item-visual:42", data: { delta: { kind: "message.text", text: "Runtime output" } }, authorization: "[REDACTED]" } });
      }
      const markdownContent = visualFixture ? createStructuredVisualFixtureMarkdown(drsaiImageUrl) : [
        "Mock **desktop** chat stream.\n\n",
        "| item | status |\n| --- | --- |\n| renderer | ok |\n\n",
        "[OpenDrSai](https://github.com/hepai-lab/drsai)",
      ].join("");
      let sequence = 0;
      const sendStructured = (event: Record<string, unknown>): void => {
        sequence += 1;
        emit(chatListeners, {
          requestId,
          sessionId: request.sessionId,
          runId: request.runId,
          type: "structured",
          structuredEvent: {
            version: 2,
            turnId,
            sequence,
            dedupeKey: `${turnId}:${sequence}:${String(event.type)}`,
            timestamp: new Date().toISOString(),
            source: "mock-desktop",
            ...event,
          } as StructuredConversationEvent,
        });
      };
      emit(chatListeners, { requestId, type: "start" });
      sendStructured({ type: "turn.started" });
      sendStructured({
        type: "part.started",
        part: { id: `${turnId}:reasoning`, kind: "reasoning", status: "running", segments: [] },
      });
      sendStructured({
        type: "part.delta",
        partId: `${turnId}:reasoning`,
        delta: { kind: "reasoning.append", segmentId: "analysis", text: "Inspecting the request and preparing a concise result.", source: "mock-desktop" },
      });
      sendStructured({
        type: "part.started",
        part: { id: `${turnId}:progress`, kind: "progress", status: "running", summary: "Preparing the result" },
      });
      if (visualFixture) {
        sendStructured({
          type: "activity.updated",
          activity: {
            id: `${turnId}:activity:inspect`, turnId, timestamp: new Date().toISOString(), source: "mock-desktop",
            status: "completed", title: "Inspect workspace", kind: "tool", toolName: "read_workspace",
            callId: "call-inspect", input: { path: request.workspacePath || "C:\\workspace" },
            output: { files: 12, summary: "Workspace inspection completed." }, durationMs: 420,
          },
        });
        sendStructured({
          type: "activity.updated",
          activity: {
            id: `${turnId}:activity:reflect`, turnId, timestamp: new Date().toISOString(), source: "mock-desktop",
            status: "error", title: "Reflector response", kind: "tool", toolName: "reflector",
            callId: "call-reflector", input: { stage: "review" },
            output: { code: "REFLECTOR_TIMEOUT", message: "The reflector did not respond before the deadline." }, durationMs: 1500,
          },
        });
      }
      for (const content of visualFixture ? [markdownContent] : [
        "Mock **desktop** chat stream.\n\n",
        "| item | status |\n| --- | --- |\n| renderer | ok |\n\n",
        "[OpenDrSai](https://github.com/hepai-lab/drsai)",
      ]) {
        await delay(90);
        if (sequence === 4) {
          sendStructured({
            type: "part.started",
            part: { id: `${turnId}:markdown`, kind: "markdown", status: "running", markdown: "" },
          });
        }
        sendStructured({
          type: "part.delta",
          partId: `${turnId}:markdown`,
          delta: { kind: "markdown.append", text: content },
        });
      }
      const workspacePath = request.workspacePath || "C:\\workspace";
      sendStructured({
        type: "part.completed",
        part: {
          id: `${turnId}:artifact:report`, kind: "artifact", status: "completed",
          artifactId: "mock-report", artifactType: "report", name: "README.md",
          summary: "Generated workspace report", path: `${workspacePath}\\README.md`, citationIds: ["mock-docs"],
        },
      });
      sendStructured({
        type: "part.completed",
        part: {
          id: `${turnId}:citation:docs`, kind: "citation", status: "completed",
          citationId: "mock-docs", title: "OpenDrSai repository", url: "https://github.com/hepai-lab/drsai",
          markdownPartId: `${turnId}:markdown`, artifactId: "mock-report",
        },
      });
      sendStructured({
        type: "part.completed",
        part: {
          id: `${turnId}:subtask`, kind: "subtask", status: "completed",
          taskId: "mock-review", title: "Renderer review", summary: "Completed",
        },
      });
      sendStructured({
        type: "part.completed",
        part: {
          id: `${turnId}:notice`, kind: "notice", status: "completed",
          level: "success", message: "Structured response completed.",
        },
      });
      sendStructured({
        type: "part.completed",
        part: {
          id: `${turnId}:reasoning`, kind: "reasoning", status: "completed",
          segments: [{ id: "analysis", text: "Inspecting the request and preparing a concise result.", status: "completed", source: "mock-desktop" }],
        },
      });
      sendStructured({
        type: "part.completed",
        part: {
          id: `${turnId}:markdown`, kind: "markdown", status: "completed",
          markdown: markdownContent,
          citationIds: ["mock-docs"],
        },
      });
      sendStructured({
        type: "part.completed",
        part: { id: `${turnId}:progress`, kind: "progress", status: "completed", summary: "Result ready" },
      });
      sendStructured({ type: "turn.completed", meta: { model: request.model || "mock-model" } });
      emit(chatListeners, { requestId, type: "done" });
      return requestId;
    },
    recoverChatRun: async () => [],
    abortChat: async (requestId) => {
      emit(chatListeners, { requestId, type: "aborted" });
      return true;
    },
    respondChatInput: async () => true,
    startVoiceTranscription: async (request) => {
      const requestId = `fixture-voice-${Date.now()}`;
      const timer = window.setTimeout(() => {
        voiceFixtureTimers.delete(requestId);
        emit(voiceTranscriptionListeners, { requestId, type: "completed", result: {
          ok: true,
          transcript: "Fixture voice transcript.",
          language: request.languageHint,
          durationSeconds: request.durationSeconds,
          runtimeId: "mock-local",
          sourceId: requestId,
          createdAt: new Date().toISOString(),
          truncated: false,
          providerDisclosure: "Fixture transcription is active in the development renderer.",
          message: "Fixture transcription completed.",
        } });
      }, 200);
      voiceFixtureTimers.set(requestId, timer);
      return { requestId, acceptedAt: new Date().toISOString() };
    },
    bootstrapDesktop: async () => ({
      ready: true,
      message: "OpenDrSai is ready.",
      user: authSession.user!,
      capabilities: { chat: true, agent: true, tools: ["files", "shell", "git"] },
      defaults: { agentId: "drsai", modelAlias: "mock-model" },
      models: [{ id: "mock-model", name: "Mock model" }],
      limits: { maxConcurrentRuns: 1 },
    }),
    cancelVoiceTranscription: async (requestId) => {
      const timer = voiceFixtureTimers.get(requestId);
      if (timer === undefined) return false;
      window.clearTimeout(timer);
      voiceFixtureTimers.delete(requestId);
      emit(voiceTranscriptionListeners, { requestId, type: "cancelled" });
      return true;
    },
    getVoiceRuntimeStatus: async () => ({
      runtimeId: "mock-local",
      state: "ready",
      supportedMimeTypes: ["audio/webm", "audio/wav"],
      maxBytes: 10 * 1024 * 1024,
      maxDurationSeconds: 120,
      supportsPartial: false,
      providerDisclosure: "Fixture transcription is active in the development renderer.",
      message: "Fixture voice runtime is ready.",
    }),
    getStreamingVoiceCapabilities: async () => ({
      serialStt: true,
      serialTts: true,
      streamingStt: true,
      streamingTts: true,
      audioEncodings: ["pcm_s16le"],
      sampleRatesHz: [16_000, 24_000, 48_000],
      supportsPartialTranscripts: true,
      supportsProviderEndpointing: true,
      supportsSessionResume: false,
      maxBufferedAudioMs: 2_000,
    }),
    startStreamingVoiceTranscription: async (request) => {
      const sessionId = `fixture-streaming-${Date.now()}`;
      streamingVoiceSessions.set(sessionId, { turnId: request.turnId, eventSequence: 1, partialSent: false });
      emit(streamingVoiceTranscriptionListeners, {
        sessionId,
        turnId: request.turnId,
        sequence: 0,
        type: "accepted",
        runtimeId: "mock-local",
      });
      return {
        sessionId,
        turnId: request.turnId,
        acceptedAt: new Date().toISOString(),
        capabilities: await api.getStreamingVoiceCapabilities(),
      };
    },
    sendStreamingVoiceAudioChunk: (chunk) => {
      const session = streamingVoiceSessions.get(chunk.sessionId);
      if (!session || session.turnId !== chunk.turnId) return false;
      if ((window as Window & { __voiceFixtureStreamingError?: boolean }).__voiceFixtureStreamingError) {
        emit(streamingVoiceTranscriptionListeners, {
          sessionId: chunk.sessionId,
          turnId: chunk.turnId,
          sequence: session.eventSequence++,
          type: "failed",
          error: { code: "network_error", message: "Streaming transcription connection failed. Retry streaming or use serial next turn.", retryable: true },
        });
        streamingVoiceSessions.delete(chunk.sessionId);
        return false;
      }
      emit(streamingVoiceTranscriptionListeners, {
        sessionId: chunk.sessionId,
        turnId: chunk.turnId,
        sequence: session.eventSequence++,
        type: "audio_ack",
        ack: {
          sessionId: chunk.sessionId,
          turnId: chunk.turnId,
          acknowledgedSequence: chunk.sequence,
          bufferedAudioMs: 0,
          receivedAt: new Date().toISOString(),
        },
      });
      if ((window as Window & { __voiceFixtureSlowNetwork?: boolean }).__voiceFixtureSlowNetwork && !session.partialSent) {
        emit(streamingVoiceTranscriptionListeners, {
          sessionId: chunk.sessionId,
          turnId: chunk.turnId,
          sequence: session.eventSequence++,
          type: "flow_control",
          paused: true,
          bufferedAudioMs: 1_500,
          reason: "high_watermark",
        });
      }
      if (!session.partialSent) {
        session.partialSent = true;
        emit(streamingVoiceTranscriptionListeners, {
          sessionId: chunk.sessionId,
          turnId: chunk.turnId,
          sequence: session.eventSequence++,
          type: "partial",
          segment: { text: "Fixture live…", revision: 1, confidence: 0.92 },
        });
      }
      return true;
    },
    stopStreamingVoiceTranscription: async (sessionId, reason = "manual") => {
      const session = streamingVoiceSessions.get(sessionId);
      if (!session) return false;
      emit(streamingVoiceTranscriptionListeners, { sessionId, turnId: session.turnId, sequence: session.eventSequence++, type: "endpoint", reason });
      emit(streamingVoiceTranscriptionListeners, { sessionId, turnId: session.turnId, sequence: session.eventSequence++, type: "final", segment: { text: "Fixture streaming transcript.", revision: 1, confidence: 1 } });
      emit(streamingVoiceTranscriptionListeners, { sessionId, turnId: session.turnId, sequence: session.eventSequence++, type: "completed" });
      streamingVoiceSessions.delete(sessionId);
      return true;
    },
    cancelStreamingVoiceTranscription: async (sessionId) => {
      const session = streamingVoiceSessions.get(sessionId);
      if (!session) return false;
      emit(streamingVoiceTranscriptionListeners, { sessionId, turnId: session.turnId, sequence: session.eventSequence++, type: "cancelled" });
      streamingVoiceSessions.delete(sessionId);
      return true;
    },
    startVoiceSynthesis: async () => {
      const requestId = `fixture-tts-${Date.now()}`;
      const timer = window.setTimeout(() => {
        voiceSynthesisFixtureTimers.delete(requestId);
        emit(voiceSynthesisListeners, {
          requestId,
          type: "completed",
          result: {
            audioData: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]),
            mimeType: "audio/wav",
            runtimeId: "mock-local",
            createdAt: new Date().toISOString(),
            providerDisclosure: "Fixture synthesis is active in the development renderer.",
          },
        });
      }, 200);
      voiceSynthesisFixtureTimers.set(requestId, timer);
      return { requestId, acceptedAt: new Date().toISOString() };
    },
    cancelVoiceSynthesis: async (requestId) => {
      const timer = voiceSynthesisFixtureTimers.get(requestId);
      if (timer === undefined) return false;
      window.clearTimeout(timer);
      voiceSynthesisFixtureTimers.delete(requestId);
      emit(voiceSynthesisListeners, { requestId, type: "cancelled" });
      return true;
    },
    getVoiceSynthesisRuntimeStatus: async () => ({
      runtimeId: "mock-local",
      state: "ready",
      supportsSynthesisTask: true,
      supportedFormats: ["wav"],
      maxTextChars: 12_000,
      providerDisclosure: "Fixture synthesis is active in the development renderer.",
      message: "Fixture voice synthesis runtime is ready.",
    }),
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
    recoverAgentRun: async () => [],
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
    getPathForFile: (file: File): string => {
      return `C:\\Users\\Demo\\Downloads\\${file.name}`;
    },
    getWorkspaceContextOverview: async (workspacePath) =>
      createMockWorkspaceOverview(workspacePath),
    listWorkspaceFiles: async (request) =>
      createMockWorkspaceFiles(request.workspacePath, request.query),
    summarizeWorkspaceFolder: async (request) =>
      createMockWorkspaceFolderSummary(request.path),
    analyzeMaterialRoles: async (request) => ({
      items: request.paths.map((path, index) => ({
        path,
        name: path.split(/[\\/]/).at(-1) || path,
        role: index % 4 === 0 ? "previous_report" as const : index % 4 === 1 ? "latest_data" as const : index % 4 === 2 ? "result_image" as const : "reference_material" as const,
        confidence: 0.95,
        reason: "Mock material role evidence.",
        suggestedUse: "Use this material according to its detected role.",
      })),
      roleCounts: {
        previous_report: request.paths.filter((_path, index) => index % 4 === 0).length,
        latest_data: request.paths.filter((_path, index) => index % 4 === 1).length,
        result_image: request.paths.filter((_path, index) => index % 4 === 2).length,
        reference_material: request.paths.filter((_path, index) => index % 4 === 3).length,
      },
      summary: "Mock material role analysis.",
    }),
    analyzeMaterialConsistency: async (request) => ({
      findings: request.paths.length >= 2 ? [{
        id: "mock-consensus",
        kind: "consensus" as const,
        severity: "info" as const,
        title: "Mock materials agree",
        explanation: "Two mock materials contain the same conclusion.",
        recommendation: "Keep both sources attached.",
        sources: request.paths.slice(0, 2).map((path) => ({
          path,
          name: path.split(/[\\/]/).at(-1) || path,
          role: "reference_material" as const,
          locator: "line 1",
          value: "agrees",
          excerpt: "Mock agreement.",
        })),
      }] : [],
      counts: { consensus: request.paths.length >= 2 ? 1 : 0, source_conflict: 0, outdated_number: 0, chart_mismatch: 0, evidence_gap: 0 },
      filesAnalyzed: request.paths.length,
      summary: "Mock material consistency analysis.",
    }),
    queryMaterials: async (request) => ({
      status: "answered" as const,
      queryKind: "general" as const,
      answer: "Mock material answer.",
      confidence: 0.95,
      citations: request.paths.slice(0, 1).map((path) => ({
        path,
        name: path.split(/[\\/]/).at(-1) || path,
        locator: "line 1",
        excerpt: "Mock material evidence.",
      })),
      filesSearched: request.paths.length,
    }),
    previewWorkspaceFile: async (request) =>
      createMockWorkspacePreview(request.workspacePath, request.path, request.mode),
    saveWorkspaceFileAs: async (request) => ({
      canceled: false,
      sourcePath: request.path,
      destinationPath: request.destinationPath || `C:\\Users\\Demo\\Downloads\\${request.suggestedName || "result.md"}`,
      name: request.suggestedName || "result.md",
      extension: ".md",
      size: 128,
      sourceHash: "sha256:mock-result",
      destinationHash: "sha256:mock-result",
      integrityVerified: true,
      message: "Mock file copy saved and verified.",
    }),
    writeWorkspaceFile: async (request) => ({
      status: "saved",
      path: request.path,
      expectedHash: request.expectedHash,
      currentHash: request.expectedHash,
      savedHash: "sha256:mock-safe-write",
      destinationPath: request.mode === "save_as" ? request.destinationPath || `C:\\Users\\Demo\\Downloads\\${request.suggestedName || "safe-copy.md"}` : request.path,
      savedAs: request.mode === "save_as",
      overwroteExternal: request.mode === "overwrite",
      message: "Saved with external-change protection.",
    }),
    applyAnomalyDecision: async (request) => {
      const base = request.sourcePath.replace(/\.csv$/i, "");
      const outputs = request.decision === "keep"
        ? [{ role: "kept_all" as const, path: `${base}-保留全部.csv`, rowCount: 5, anomalyCount: 2, sha256: "sha256:mock-keep" }]
        : request.decision === "exclude"
          ? [{ role: "excluded_anomalies" as const, path: `${base}-排除异常.csv`, rowCount: 3, anomalyCount: 0, sha256: "sha256:mock-exclude" }]
          : [
              { role: "kept_all" as const, path: `${base}-保留全部.csv`, rowCount: 5, anomalyCount: 2, sha256: "sha256:mock-keep" },
              { role: "excluded_anomalies" as const, path: `${base}-排除异常.csv`, rowCount: 3, anomalyCount: 0, sha256: "sha256:mock-exclude" },
            ];
      return {
        sourcePath: request.sourcePath,
        anomalyColumn: request.anomalyColumn,
        totalRows: 5,
        anomalyRows: 2,
        normalRows: 3,
        decision: request.decision,
        decidedAt: new Date().toISOString(),
        resultSummary: request.decision === "keep" ? "已采用“保留异常”。" : request.decision === "exclude" ? "已采用“排除异常”。" : "已采用“两种都做”。",
        sourceSha256: "sha256:mock-source",
        receiptPath: `${base}-异常处理决定.json`,
        outputs,
      };
    },
    listWorktrees: async () => [],
    listWorktreeEvents: async (request) => ({ events: [], nextSequence: request.afterSequence ?? 0 }),
    getWorktreeMigrationDiagnostics: async () => [],
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
        truncated: false,
        entries: [
          {
            path: `${workspacePath}\\src\\App.tsx`,
            relativePath: "src/App.tsx",
            status: "modified",
            size: 1200,
            fileHash: "sha256:mock-app",
            versionPath: `${workspacePath}\\.drsai\\versions\\${Date.now()}-App.tsx`,
            stored: true,
            existed: true,
          },
          {
            path: `${workspacePath}\\docs\\workspace-context.md`,
            relativePath: "docs/workspace-context.md",
            status: "untracked",
            size: 800,
            fileHash: "sha256:mock-doc",
            versionPath: `${workspacePath}\\.drsai\\versions\\${Date.now()}-workspace-context.md`,
            stored: true,
            existed: true,
          },
        ],
        kind: request.kind ?? "manual",
        ...(request.runId ? { runId: request.runId } : {}),
        ...(request.automatic ? { automatic: true } : {}),
        ...(request.versionGroupId ? { versionGroupId: request.versionGroupId } : {}),
        ...(request.versionPhase ? { versionPhase: request.versionPhase } : {}),
        ...(request.versionNumber ? { versionNumber: request.versionNumber } : {}),
        ...(request.versionScope ? { versionScope: request.versionScope } : {}),
        ...(request.changeReason ? { changeReason: request.changeReason } : {}),
        ...(request.objectLabel ? { objectLabel: request.objectLabel } : {}),
        ...(request.kind === "agent_run_baseline" ? { reviewStatus: "pending" as const } : {}),
      };
      workspaceCheckpoints = [
        checkpoint,
        ...workspaceCheckpoints.filter((item) => item.id !== checkpoint.id),
      ];
      return checkpoint;
    },
    acceptWorkspaceCheckpoint: async (request) => {
      const checkpoint = workspaceCheckpoints.find(
        (item) => item.workspacePath === request.workspacePath && item.id === request.checkpointId,
      );
      if (!checkpoint) throw new Error("Mock checkpoint was not found.");
      const accepted: WorkspaceCheckpoint = {
        ...checkpoint,
        reviewStatus: "accepted",
        reviewedAt: new Date().toISOString(),
      };
      workspaceCheckpoints = workspaceCheckpoints.map((item) =>
        item.id === accepted.id ? accepted : item,
      );
      return accepted;
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
    listUserPreferences: async () => userPreferences.slice().sort((left, right) => left.category.localeCompare(right.category)),
    upsertUserPreference: async (request) => {
      const existing = userPreferences.find((item) => item.category === request.category);
      const now = new Date().toISOString();
      const preference: DesktopUserPreference = {
        category: request.category,
        value: request.value,
        source: "explicit_user_request",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      userPreferences = [preference, ...userPreferences.filter((item) => item.category !== preference.category)];
      return preference;
    },
    deleteUserPreference: async (request) => {
      const before = userPreferences.length;
      userPreferences = userPreferences.filter((item) => item.category !== request.category);
      return { category: request.category, removed: userPreferences.length !== before };
    },
    listTeamMemory: async (request = {}) => teamMemory.filter((entry) => !request.teamId || entry.teamId === request.teamId).slice(0, request.limit ?? 20),
    addTeamMemory: async (request) => {
      const now = new Date().toISOString();
      const entry = { id: `team-memory-${crypto.randomUUID()}`, teamId: request.teamId, content: request.content, createdBy: "mock-user", createdAt: now, updatedAt: now };
      teamMemory = [entry, ...teamMemory];
      return entry;
    },
    deleteTeamMemory: async (request) => {
      const before = teamMemory.length;
      teamMemory = teamMemory.filter((entry) => !(entry.teamId === request.teamId && entry.id === request.entryId));
      return { teamId: request.teamId, removedCount: before - teamMemory.length };
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
        steps: buildMockWorkflowRunSteps(template),
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
        const now = new Date().toISOString();
        run.steps[stepIndex] = {
          ...step,
          status: "running",
          message: "Mock terminal command dispatched; waiting for its exit result.",
        };
        run.updatedAt = now;
        workflowRuns = workflowRuns.map((item, index) => index === runIndex ? run : item);
        upsertMockBackgroundTaskForWorkflowRun(run);
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
        status: step.kind === "chat_command" ? "running" : "completed",
        ...(step.kind === "chat_command" ? {} : { completedAt: now }),
        message:
          step.kind === "chat_command" && step.command
            ? "Mock chat command prepared; confirm this step only after the chat action finishes."
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
      const completable =
        (step.kind === "external_runtime" && step.status === "waiting_approval") ||
        ((step.kind === "terminal_command" || step.kind === "chat_command") && step.status === "running");
      if (!completable) {
        throw new Error("Mock workflow step completion only accepts dispatched terminal/chat steps or an explicitly reconnected external runtime.");
      }
      const now = new Date().toISOString();
      const succeeded = request.exitCode === 0;
      const label = step.kind === "terminal_command"
        ? "terminal workflow command"
        : step.kind === "chat_command"
          ? "chat workflow action"
          : "external runtime reconnect";
      run.steps[stepIndex] = {
        ...step,
        status: succeeded ? "completed" : "blocked",
        ...(succeeded ? { completedAt: now } : {}),
        message: succeeded
          ? `Mock ${label} completed.`
          : `Mock ${label} failed with exit code ${request.exitCode}.`,
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
        ...(request.planSteps?.length ? { planSteps: request.planSteps.map((step) => ({ ...step })) } : {}),
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
        ...(request.title !== undefined ? { title: request.title } : {}),
        status: request.status,
        updatedAt: new Date().toISOString(),
        ...(request.currentStep !== undefined
          ? { currentStep: request.currentStep }
          : {}),
        ...(request.planSteps !== undefined
          ? { planSteps: request.planSteps.map((step) => ({ ...step })) }
          : {}),
        message: request.message ?? task.message,
        verification: request.verification ?? task.verification,
      };
      backgroundTasks = backgroundTasks.map((item) =>
        item.id === updated.id ? updated : item,
      );
      return updated;
    },
    cancelBackgroundTask: async (request) => {
      const task = backgroundTasks.find((item) => item.id === request.taskId);
      if (!task || task.status === "completed") throw new Error("Mock background task cannot be cancelled.");
      const now = new Date().toISOString(); const updated = { ...task, status: "cancelled" as const, updatedAt: now, cancelledAt: now, message: request.reason ?? "Mock background task was cancelled." };
      backgroundTasks = backgroundTasks.map((item) => item.id === updated.id ? updated : item); return updated;
    },
    retryBackgroundTask: async (request) => {
      const task = backgroundTasks.find((item) => item.id === request.taskId);
      if (!task || !["failed", "blocked", "cancelled"].includes(task.status)) throw new Error("Mock background task cannot be retried.");
      const updated = { ...task, status: "queued" as const, updatedAt: new Date().toISOString(), attempt: (task.attempt ?? 1) + 1, retryOfTaskId: task.retryOfTaskId ?? task.id, progress: 0, message: request.reason ?? "Mock background task retry is queued." };
      backgroundTasks = backgroundTasks.map((item) => item.id === updated.id ? updated : item); return updated;
    },
    recoverBackgroundTasks: async () => {
      const generatedAt = new Date().toISOString(); const tasks = backgroundTasks.filter((task) => ["queued", "running", "waiting_approval"].includes(task.status)).map((task) => ({ ...task, status: task.status === "running" ? "queued" as const : task.status, updatedAt: generatedAt, recoveredAt: generatedAt }));
      backgroundTasks = backgroundTasks.map((task) => tasks.find((item) => item.id === task.id) ?? task); return { generatedAt, recovered: tasks.length, tasks };
    },
    createShare: async (request) => {
      const source = backgroundTasks.find((item) => item.id === request.sourceTaskId);
      if (!source?.deliverySummary) throw new Error("Only a completed task with results can be shared.");
      const selected = request.scope === "result_only" ? source.deliverySummary.artifacts.find((item) => item.id === request.artifactId) : undefined;
      if (request.scope === "result_only" && !selected) throw new Error("The selected result was not found in the source task.");
      const artifacts = selected ? [selected] : source.deliverySummary.artifacts;
      const manifest: DesktopShareManifest = {
        id: `share:${crypto.randomUUID()}`,
        ownerAccount: authSession.user?.email || "developer@opendrsai.local",
        recipientAccount: request.recipientAccount.trim().toLowerCase(),
        scope: request.scope,
        sourceTaskId: source.id,
        ...(selected ? { selectedArtifactId: selected.id } : {}),
        objects: [
          ...(request.scope === "complete_task" ? [{ objectType: "task" as const, objectId: source.id, label: source.title, version: 1 }] : []),
          ...artifacts.map((artifact) => ({ objectType: "artifact" as const, objectId: artifact.id, label: artifact.label, kind: artifact.kind, bytes: 1, sha256: "mock-sha256", version: 1 })),
        ],
        createdAt: new Date().toISOString(),
        version: 1,
        versionUpdatedAt: new Date().toISOString(),
        versionUpdatedByAccount: authSession.user?.email || "developer@opendrsai.local",
        status: "active",
        permission: request.permission ?? "view",
      };
      shares = [manifest, ...shares];
      return manifest;
    },
    inspectShare: async (request) => ({
      sourceTaskId: request.sourceTaskId,
      scope: request.scope,
      ...(request.artifactId ? { artifactId: request.artifactId } : {}),
      scannedArtifactCount: 0,
      findings: [],
      requiresResolution: false,
    }),
    updateSharePermission: async (request) => {
      const share = shares.find((item) => item.id === request.shareId && item.status === "active");
      if (!share) throw new Error("Mock share was not found.");
      const updated = { ...share, permission: request.permission };
      shares = shares.map((item) => item.id === updated.id ? updated : item);
      return updated;
    },
    revokeShare: async (request) => {
      if (request.confirmation !== "REVOKE") throw new Error("Type REVOKE to confirm permanent access revocation.");
      const owner = (authSession.user?.email || "").toLowerCase();
      const share = shares.find((item) => item.id === request.shareId);
      if (!share || share.ownerAccount.toLowerCase() !== owner || share.status !== "active") throw new Error("Only the share owner can revoke this share.");
      const revokedAt = new Date().toISOString();
      const updated = { ...share, status: "revoked" as const, revokedAt, revokedByAccount: owner };
      shares = shares.map((item) => item.id === updated.id ? updated : item);
      const audit = { id: `share-audit:${crypto.randomUUID()}`, shareId: share.id, actorAccount: owner, action: "revoke" as const, outcome: "allowed" as const, permission: share.permission, reason: `Access revoked for ${share.objects.length} shared object(s).`, createdAt: revokedAt };
      shareAudit = [...shareAudit, audit];
      return { shareId: share.id, status: "revoked" as const, revokedAt, recipientAccount: share.recipientAccount, objectsInvalidated: share.objects.length, auditEntryId: audit.id };
    },
    inspectShareVersion: async (request) => {
      const share = shares.find((item) => item.id === request.shareId && item.status === "active");
      if (!share) throw new Error("Mock share was not found.");
      const artifacts = share.objects.filter((item) => item.objectType === "artifact").map((item) => ({ objectId: item.objectId, label: item.label, publishedSha256: item.sha256 || "", sourceSha256: "f".repeat(64), changed: item.sha256 !== "f".repeat(64) }));
      const currentCommentCount = shareComments.filter((item) => item.shareId === share.id && item.version === share.version).length;
      return { shareId: share.id, currentVersion: share.version, nextVersion: share.version + 1, hasChanges: artifacts.some((item) => item.changed), currentCommentCount, commentsThatWillBecomeStale: currentCommentCount, sourceFingerprints: artifacts.map((item) => ({ objectId: item.objectId, sha256: item.sourceSha256 })), artifacts };
    },
    publishShareVersion: async (request) => {
      const share = shares.find((item) => item.id === request.shareId && item.status === "active");
      if (!share || share.version !== request.expectedVersion) throw new Error(`Version conflict: this share is now v${share?.version ?? "?"}.`);
      const publishedAt = new Date().toISOString(); const currentVersion = share.version + 1;
      const updated = { ...share, version: currentVersion, versionUpdatedAt: publishedAt, versionUpdatedByAccount: authSession.user?.email || "mock@example.org", objects: share.objects.map((item) => ({ ...item, version: currentVersion, ...(item.objectType === "artifact" ? { sha256: request.sourceFingerprints.find((fingerprint) => fingerprint.objectId === item.objectId)?.sha256 || item.sha256 } : {}) })) };
      shares = shares.map((item) => item.id === updated.id ? updated : item);
      const staleCommentCount = shareComments.filter((item) => item.shareId === share.id && item.version < currentVersion).length;
      return { status: "published" as const, shareId: share.id, previousVersion: share.version, currentVersion, publishedAt, staleCommentCount, manifest: updated };
    },
    listShareComments: async (request) => { const share = shares.find((item) => item.id === request.shareId); return shareComments.filter((item) => item.shareId === request.shareId).map((item) => ({ ...item, versionStatus: item.version === share?.version ? "current" as const : "stale" as const })); },
    addShareComment: async (request) => {
      const share = shares.find((item) => item.id === request.shareId && item.status === "active" && item.recipientAccount === (authSession.user?.email || "").toLowerCase());
      if (!share || share.permission === "view") throw new Error("The current share permission does not allow comments.");
      const object = share.objects.find((item) => item.objectId === request.objectId) ?? share.objects.find((item) => item.objectType === "artifact") ?? share.objects[0];
      const comment = { id: `share-comment:${crypto.randomUUID()}`, shareId: share.id, authorAccount: authSession.user?.email || "mock@example.org", body: request.body, target: { objectType: object.objectType, objectId: object.objectId, objectLabel: object.label, anchorType: request.anchorType ?? "whole_result" as const, anchorLabel: request.anchorLabel?.trim() || object.label }, createdAt: new Date().toISOString(), version: share.version, versionStatus: "current" as const };
      shareComments = [...shareComments, comment];
      return comment;
    },
    previewShareCommentTask: async (request) => {
      const comment = shareComments.find((item) => item.shareId === request.shareId && item.id === request.commentId);
      if (!comment) throw new Error("Mock shared comment was not found.");
      return { shareId: request.shareId, commentId: comment.id, title: `处理评论：${comment.target.anchorLabel}`, instructions: `针对成果“${comment.target.objectLabel}”处理评论：\n${comment.body}`, commentBody: comment.body, commentAuthorAccount: comment.authorAccount, target: { ...comment.target } };
    },
    createShareCommentTask: async (request) => {
      const preview = await api.previewShareCommentTask(request);
      const now = new Date().toISOString();
      const task = { id: `share-comment-task:${crypto.randomUUID()}`, shareId: request.shareId, commentId: request.commentId, backgroundTaskId: `background-task:agent_run:${crypto.randomUUID()}`, title: request.title, instructions: request.instructions, commentBody: preview.commentBody, commentAuthorAccount: preview.commentAuthorAccount, target: { ...preview.target }, status: "ready" as const, createdAt: now, updatedAt: now };
      shareCommentTasks = [...shareCommentTasks, task];
      return task;
    },
    updateShareCommentTask: async (request) => {
      const task = shareCommentTasks.find((item) => item.id === request.taskId);
      if (!task || task.status === "completed") throw new Error("Mock comment task cannot be updated.");
      const updated = { ...task, title: request.title, instructions: request.instructions, updatedAt: new Date().toISOString() };
      shareCommentTasks = shareCommentTasks.map((item) => item.id === updated.id ? updated : item);
      return updated;
    },
    completeShareCommentTask: async (request) => {
      const task = shareCommentTasks.find((item) => item.id === request.taskId);
      if (!task) throw new Error("Mock comment task was not found.");
      const completedAt = new Date().toISOString();
      const updated = { ...task, status: "completed" as const, completedAt, updatedAt: completedAt };
      shareCommentTasks = shareCommentTasks.map((item) => item.id === updated.id ? updated : item);
      return updated;
    },
    listShareCommentTasks: async (request = {}) => shareCommentTasks.filter((item) => !request.shareId || item.shareId === request.shareId).map((item) => ({ ...item, target: { ...item.target } })),
    continueSharedTask: async (request) => {
      const share = shares.find((item) => item.id === request.shareId && item.status === "active" && item.recipientAccount === (authSession.user?.email || "").toLowerCase());
      if (!share || share.permission !== "continue") throw new Error("The current share permission does not allow continued processing.");
      return { id: `share-continuation:${crypto.randomUUID()}`, shareId: share.id, requesterAccount: authSession.user?.email || "mock@example.org", sourceTaskId: share.sourceTaskId, artifactIds: share.objects.filter((item) => item.objectType === "artifact").map((item) => item.objectId), status: "requested" as const, createdAt: new Date().toISOString() };
    },
    listShareAudit: async (request) => shareAudit.filter((item) => item.shareId === request.shareId).map((item) => ({ ...item })),
    listIncomingShares: async () => shares.filter((share) => share.status === "active" && share.recipientAccount === (authSession.user?.email || "").toLowerCase()),
    listOutgoingShares: async () => shares.filter((share) => share.ownerAccount === (authSession.user?.email || "")),
    openSharedObject: async (request) => {
      const share = shares.find((item) => item.id === request.shareId && item.status === "active" && item.recipientAccount === (authSession.user?.email || "").toLowerCase());
      const object = share?.objects.find((item) => item.objectType === request.objectType && item.objectId === request.objectId);
      if (!share || !object) throw new Error("This object is not included in the share manifest.");
      return request.objectType === "task"
        ? { shareId: share.id, version: share.version, objectType: "task" as const, objectId: object.objectId, label: object.label, authorized: true as const, task: { id: object.objectId, title: object.label, status: "completed" as const, updatedAt: share.createdAt, artifactIds: share.objects.filter((item) => item.objectType === "artifact").map((item) => item.objectId) } }
        : { shareId: share.id, version: share.version, objectType: "artifact" as const, objectId: object.objectId, label: object.label, authorized: true as const, artifact: { id: object.objectId, label: object.label, kind: object.kind || "file", bytes: object.bytes || 1, sha256: object.sha256 || "mock-sha256" } };
    },
    downloadSharedArtifact: async (request) => {
      const recipient = (authSession.user?.email || "").toLowerCase();
      const share = shares.find((item) => item.id === request.shareId && item.status === "active" && item.recipientAccount === recipient);
      const object = share?.objects.find((item) => item.objectType === "artifact" && item.objectId === request.objectId);
      if (!share || !object) throw new Error("This result is not included in the share manifest.");
      const content = `Mock shared result: ${object.label}`;
      return {
        shareId: share.id,
        version: share.version,
        artifactId: object.objectId,
        fileName: object.label,
        kind: object.kind || "file",
        bytes: content.length,
        sha256: object.sha256 || "mock-sha256",
        base64: btoa(content),
      };
    },
    listReusableTasks: async () => reusableTasks.map((item) => ({ ...item, inputs: item.inputs.map((input) => ({ ...input })), fixedRules: [...item.fixedRules], savedAdjustments: { ...item.savedAdjustments, checkItems: [...item.savedAdjustments.checkItems] } })),
    saveReusableTask: async (request) => {
      const source = backgroundTasks.find((item) => item.id === request.sourceTaskId);
      if (!source || source.status !== "completed" || !source.deliverySummary?.artifacts.length) throw new Error("Only a completed task with a saved result can be made reusable.");
      const now = new Date().toISOString();
      const existing = reusableTasks.find((item) => item.name.toLowerCase() === request.name.toLowerCase());
      const task: import("@shared/desktopApi").DesktopReusableTask = {
        id: existing?.id ?? `reusable-task-${crypto.randomUUID()}`,
        name: request.name,
        sourceTaskId: source.id,
        sourceTaskTitle: source.title,
        ...(source.workspacePath ? { sourceWorkspacePath: source.workspacePath } : {}),
        taskTemplate: source.title,
        inputs: [{ id: "primary_input", label: "Primary input", kind: "file", required: true, originalValue: "" }],
        fixedRules: [...(source.planSteps ?? []).map((step) => `${step.phase}: ${step.title}`), source.verification],
        savedAdjustments: existing?.savedAdjustments ?? { checkItems: [] },
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        runCount: existing?.runCount ?? 0,
      };
      reusableTasks = [task, ...reusableTasks.filter((item) => item.id !== task.id)];
      return task;
    },
    prepareReusableTaskRun: async (request) => {
      const task = reusableTasks.find((item) => item.id === request.reusableTaskId);
      if (!task) throw new Error("Reusable task was not found for the signed-in user.");
      const now = new Date().toISOString();
      const inputs = task.inputs.map((input) => ({ id: input.id, label: input.label, path: request.inputs[input.id], sha256: "mock-fresh-input", bytes: 1 }));
      reusableTasks = reusableTasks.map((item) => item.id === task.id ? { ...item, runCount: item.runCount + 1, lastRunAt: now, lastInputFingerprint: "mock-fresh-input", updatedAt: now, ...(request.adjustmentScope === "update_template" ? { savedAdjustments: request.adjustments } : {}) } : item);
      return { id: `reusable-run-${crypto.randomUUID()}`, reusableTaskId: task.id, reusableTaskName: task.name, workspacePath: request.workspacePath, resolvedTask: `Run reusable task: ${task.name}\nReplacement inputs:\n${inputs.map((input) => input.path).join("\n")}\nRun adjustments: ${JSON.stringify(request.adjustments)}\nScope: ${request.adjustmentScope}\nFreshness requirement: ignore all earlier outputs and caches.`, inputs, fixedRules: [...task.fixedRules], adjustments: request.adjustments, adjustmentScope: request.adjustmentScope, cachePolicy: "force_fresh_input_read", createdAt: now };
    },
    setCompletionNotificationPreference: async (preference) => ({
      enabled: preference.enabled === true,
      language: preference.language === "en" ? "en" : "zh",
    }),
    onCompletionNotificationClick: (callback) =>
      subscribe(completionNotificationClickListeners, callback),
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
        missedRunPolicy: "run_once_immediately",
        message:
          request.message ??
          "Mock scheduled task is configured for future trigger wiring.",
        verification:
          request.verification ??
          "Mock scheduled task state is verified through the scheduler panel.",
        ...(request.userDefinition
          ? { userDefinition: { ...request.userDefinition } }
          : {}),
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
        title: request.title ?? task.title,
        cadence: request.cadence ?? task.cadence,
        target: request.target ?? task.target,
        updatedAt: new Date().toISOString(),
        ...(request.nextRunAt !== undefined ? { nextRunAt: request.nextRunAt } : {}),
        message: request.message ?? task.message,
        verification: request.verification ?? task.verification,
        ...(request.userDefinition
          ? { userDefinition: { ...request.userDefinition } }
          : {}),
      };
      scheduledTasks = scheduledTasks.map((item) =>
        item.id === updated.id ? updated : item,
      );
      return updated;
    },
    deleteScheduledTask: async (request) => {
      const task = scheduledTasks.find((item) => item.id === request.taskId);
      scheduledTasks = scheduledTasks.filter((item) => item.id !== request.taskId);
      return {
        taskId: request.taskId,
        removed: Boolean(task),
        historyPolicy: "retain_results" as const,
        ...(task?.activeWorkflowRunId
          ? { retainedWorkflowRunId: task.activeWorkflowRunId }
          : {}),
        message: task
          ? "Future runs were deleted. Historical results remain available."
          : "Scheduled task was already absent. Historical results remain available.",
      };
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
      const triggerAudits = new Map<string, NonNullable<DesktopScheduledTask["lastTriggerAudit"]>>();
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
        const scheduledFor = task.nextRunAt;
        const nextRunAt = getMockNextScheduledRunAt(scheduledFor, task.cadence, generatedAt);
        const missedByMs = Math.max(0, Date.parse(generatedAt) - Date.parse(scheduledFor));
        triggerAudits.set(task.id, {
          triggerKey: `mock-${task.id}-${scheduledFor}`,
          scheduledFor,
          triggeredAt: generatedAt,
          missed: missedByMs > 1000,
          missedByMs,
          missedRunPolicy: "run_once_immediately",
          timezone: task.userDefinition?.timezone || "UTC",
          daylightSavingPolicy: "follow_timezone_wall_clock",
        });
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
          ? `workflow:workflow.run:${template.id}:${triggerAudits.get(task.id)?.triggerKey}`
          : undefined;
        if (approvalId && rejectedScheduledWorkflowApprovals.has(approvalId)) {
          items.push({ taskId: task.id, title: task.title, status: "blocked", message: "Scheduled Workflow approval was rejected.", approvalId, reason: "workflow_approval_rejected" });
          scheduledTasks = scheduledTasks.map((item) => item.id === task.id ? { ...item, status: "blocked", updatedAt: generatedAt, message: "Scheduled Workflow approval was rejected." } : item);
          continue;
        }
        if (approvalId && !approvedScheduledWorkflowApprovals.has(approvalId)) {
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
          items.push({ taskId: task.id, title: task.title, status: "queued_approval", message: "Mock scheduled Workflow is waiting in Approval Center.", approvalId });
          scheduledTasks = scheduledTasks.map((item) => item.id === task.id ? { ...item, updatedAt: generatedAt, message: "Waiting for Workflow approval; scheduled time is retained.", verification: template.verification } : item);
          continue;
        }
        const run: DesktopWorkflowRun = {
          id: `mock-workflow-run-${crypto.randomUUID()}`,
          recipeId: `mock-scheduled-recipe-${crypto.randomUUID()}`,
          templateId: template.id,
          name: template.name,
          ...(task.workspacePath ? { workspacePath: task.workspacePath } : {}),
          status: "running",
          createdAt: generatedAt,
          updatedAt: generatedAt,
          steps: [],
          verification: template.verification,
          message: "Mock scheduled workflow run started.",
        };
        workflowRuns = [run, ...workflowRuns].slice(0, 20);
        upsertMockBackgroundTaskForWorkflowRun(run);
        runs.push(run);
        items.push({
          taskId: task.id,
          title: task.title,
          status: "started",
          message: run.message,
          ...(nextRunAt ? { nextRunAt } : {}),
          workflowRunId: run.id,
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
                message: "Scheduled task started an approval-gated workflow run.",
                verification: template.verification,
              }
            : item,
        );
      }
      for (const item of items) {
        const triggerAudit = triggerAudits.get(item.taskId);
        if (triggerAudit) item.triggerAudit = triggerAudit;
      }
      scheduledTasks = scheduledTasks.map((task) => {
        const lastTriggerAudit = triggerAudits.get(task.id);
        return lastTriggerAudit ? { ...task, lastTriggerAudit } : task;
      });
      const result = {
        generatedAt,
        checked: items.length,
        triggered: items.filter(
          (item) => item.status === "started" || item.status === "queued_approval",
        ).length,
        reconnected: items.filter((item) => item.status === "reconnected").length,
        skipped: items.filter((item) => item.status === "skipped").length,
        failed: items.filter((item) => item.status === "failed").length,
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
          failed: result.failed,
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
    listExternalConnectionReadiness: async (workspacePath?: string) => buildMockExternalConnectionReadiness(workspacePath),
    configureChannelAdapter: async (request): Promise<DesktopChannelAdapterConfigureResult> => {
      const adapter = mockChannelAdapters.adapters.find(
        (item) => item.id === request.adapterId,
      );
      if (!adapter) {
        throw new Error("Mock channel adapter was not found.");
      }
      const now = new Date().toISOString();
      if ((request as { mode?: string }).mode === "session_stub") {
        throw new Error("Mock channel session placeholders cannot be configured; use a verified provider credential or dedicated pairing flow.");
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
      if (adapter.id !== "github-connector") throw new Error("This adapter uses its real provider-token or dedicated pairing flow.");
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
      adapter.status = "config_required";
      adapter.configured = false;
      adapter.authMode = "session_stub";
      adapter.accountLabel = `${adapter.name} authorization pending`;
      adapter.scopeLabel = scopes.join(" ");
      adapter.credentialState = "placeholder";
      adapter.sessionExpiresAt = expiresAt;
      adapter.authPreparedAt = now.toISOString();
      adapter.authOperationId = "channel-auth:00000000-0000-4000-8000-000000000001";
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
        operationId: adapter.id === "github-connector" ? "channel-auth:00000000-0000-4000-8000-000000000001" : undefined,
        message: `Mock prepared ${adapter.name} authorization for review.`,
        verification:
          "Mock connector authorization preparation stores workspace-scoped metadata only and performs no browser launch, provider network call, token storage, or live send.",
      };
    },
    pollChannelAdapterAuth: async (request) => {
      if (request.adapterId !== "github-connector" || !/^channel-auth:/.test(request.operationId)) throw new Error("Mock GitHub authorization operation is invalid.");
      const adapter = mockChannelAdapters.adapters.find((item) => item.id === "github-connector")!;
      adapter.status = "available"; adapter.configured = true; adapter.authMode = "oauth"; adapter.credentialState = "configured"; adapter.accountLabel = "octo-reviewer"; adapter.configuredAt = new Date().toISOString(); adapter.authOperationId = undefined; adapter.authPreparedAt = undefined;
      mockChannelAdapters.configuredCount = mockChannelAdapters.adapters.filter((item) => item.configured).length;
      mockChannelAdapters.availableCount = mockChannelAdapters.adapters.filter((item) => item.status === "available").length;
      return { adapterId: request.adapterId, status: "complete", operationId: request.operationId, accountLabel: "octo-reviewer", message: "Mock GitHub connector authorization completed." };
    },
    revokeChannelAdapterAuth: async (request) => {
      if (!["github-connector", "slack-chat", "docs-connector", "calendar-connector"].includes(request.adapterId)) throw new Error("Mock provider authorization is unsupported.");
      const adapter = mockChannelAdapters.adapters.find((item) => item.id === request.adapterId)!;
      const revoked = adapter.authMode === "oauth" || adapter.authMode === "provider_token" || Boolean(adapter.authOperationId); adapter.status = "config_required"; adapter.configured = false; adapter.authMode = "not_configured"; adapter.credentialState = "missing"; adapter.accountLabel = undefined; adapter.configuredAt = undefined; adapter.authOperationId = undefined; adapter.authPreparedAt = undefined;
      mockChannelAdapters.configuredCount = mockChannelAdapters.adapters.filter((item) => item.configured).length;
      mockChannelAdapters.availableCount = mockChannelAdapters.adapters.filter((item) => item.status === "available").length;
      return { adapterId: request.adapterId, revoked, message: revoked ? `Mock ${adapter.provider} authorization revoked.` : "No mock authorization." };
    },
    configureChannelProviderToken: async (request) => {
      if (request.adapterId === "slack-chat" && !request.token.startsWith("xoxb-")) throw new Error("Mock Slack bot token is invalid.");
      if (request.adapterId === "docs-connector" && !request.token.startsWith("ya29.")) throw new Error("Mock Google OAuth token is invalid.");
      if (request.adapterId === "calendar-connector" && !request.token.startsWith("ya29.")) throw new Error("Mock Google OAuth token is invalid.");
      const adapter = mockChannelAdapters.adapters.find((item) => item.id === request.adapterId)!;
      const accountLabel = request.adapterId === "slack-chat" ? "Mock Slack / bot" : request.adapterId === "docs-connector" ? "docs@example.test" : "calendar@example.test";
      const configuredAt = new Date().toISOString(); adapter.status = "available"; adapter.configured = true; adapter.authMode = "provider_token"; adapter.credentialState = "configured"; adapter.accountLabel = accountLabel; adapter.configuredAt = configuredAt;
      mockChannelAdapters.configuredCount = mockChannelAdapters.adapters.filter((item) => item.configured).length; mockChannelAdapters.availableCount = mockChannelAdapters.adapters.filter((item) => item.status === "available").length;
      return { adapterId: request.adapterId, accountLabel, configuredAt, ...(request.adapterId !== "slack-chat" ? { expiresAt: new Date(Date.now() + 3600_000).toISOString() } : {}), message: `Mock ${request.adapterId} connector authorized.` };
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
            const isAudio = [".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"].some((extension) => lowerTitle.endsWith(extension));
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
                ? "Audio metadata preview (mock). Format: WAV/MP3/AAC/FLAC/M4A/OGG. Ready for explicit attachment after visible review; no microphone capture, transcription service, network call, or provider send was performed."
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
    syncLiveChannelContext: async (request): Promise<DesktopChannelContextImportResult> => {
      const item = request.adapterId === "calendar-connector" ? { id: `calendar-live:${request.calendarId}:event-1`, adapterId: "calendar-connector", provider: "calendar" as const, kind: "meeting" as const, title: "Mock calendar meeting", path: "https://calendar.google.com/event?eid=mock", relativePath: `${request.calendarId}#event-1`, summary: "Start: 2026-07-23T09:00:00.000Z\nEnd: 2026-07-23T10:00:00.000Z", mime: "application/vnd.google-apps.calendar.event+json", truncated: false } : request.adapterId === "docs-connector" ? { id: `docs-live:${request.documentId}`, adapterId: "docs-connector", provider: "docs" as const, kind: "document" as const, title: "Mock Google document", path: `https://docs.google.com/document/d/${request.documentId}/edit`, relativePath: request.documentId ?? "document", summary: "Mock bounded Google document text.", mime: "application/vnd.google-apps.document", truncated: false } : request.adapterId === "slack-chat" ? { id: `slack-live:${request.channelId}:1760000000.1`, adapterId: "slack-chat", provider: "slack" as const, kind: "slack_message" as const, title: "Mock Slack message", path: `slack://${request.channelId}/1760000000.1`, relativePath: `${request.channelId}#1760000000.1`, summary: "Mock Slack history message.", mime: "application/vnd.slack.message+json", truncated: false } : { id: `github-live:${request.repository}:42`, adapterId: "github-connector", provider: "github" as const, kind: "issue" as const, title: "Mock live provider issue", path: `https://github.com/${request.repository}/issues/42`, relativePath: `${request.repository}#42`, summary: "Issue #42: Mock live provider issue\nState: open; author: octo-reviewer", mime: "application/vnd.github+json", truncated: false };
      return recordMockChannelInboundImport({ adapterId: request.adapterId, workspacePath: request.workspacePath, importedAt: new Date().toISOString(), items: [item], truncated: false, message: `Mock imported live ${request.adapterId} context.`, verification: "Mock live sync uses deterministic fixture data." });
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
      if (session.status === "restart_reconnect_required") {
        return {
          workspacePath: request.workspacePath,
          sessionReuseKey: request.sessionReuseKey,
          closed: false,
          message:
            "Mock reusable MCP restart diagnostic has no live process to close; reconnect explicitly after approval.",
          verification:
            "Restart diagnostics are read-only lifecycle evidence and do not start, close, or recover MCP processes.",
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
      if (request.id.startsWith("workflow:workflow.run:") && request.id.split(":").length >= 4) {
        if (request.approved) approvedScheduledWorkflowApprovals.add(request.id);
        else rejectedScheduledWorkflowApprovals.add(request.id);
      }
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
    openPdfPage: async (request) => ({
      ok: true,
      path: request.path,
      page: request.page,
      viewerUrl: `file:///${request.path.replace(/\\/g, "/")}#page=${request.page}&zoom=page-width`,
    }),
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
    listTerminalSessions: async (workspaceKey, _workspaceId) =>
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
    onAuthSessionInvalidated: () => () => undefined,
    onOidcLoginDebug: (callback) =>
      subscribe(oidcLoginDebugListeners, callback),
    onChatEvent: (callback) => subscribe(chatListeners, callback),
    onVoiceTranscriptionEvent: (callback) => subscribe(voiceTranscriptionListeners, callback),
    onStreamingVoiceTranscriptionEvent: (callback) => subscribe(streamingVoiceTranscriptionListeners, callback),
    onVoiceSynthesisEvent: (callback) => subscribe(voiceSynthesisListeners, callback),
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

function createStructuredVisualFixtureMarkdown(imageUrl: string): string {
  const headers = Array.from({ length: 12 }, (_, index) => `Measurement ${index + 1}`);
  const tableRows = Array.from({ length: 8 }, (_, rowIndex) =>
    `| Sample ${rowIndex + 1} | ${headers.map((header, columnIndex) => `${header}: ${(rowIndex + 1) * (columnIndex + 3)}.000000`).join(" | ")} |`,
  );
  const codeLines = Array.from({ length: 28 }, (_, index) =>
    `const detectorChannel${index + 1} = analyzeSpectrum("${"channel-".repeat(18)}${index + 1}", { reproducible: true });`,
  );
  return [
    "## Structured renderer visual fixture\n\n",
    `| Sample | ${headers.join(" | ")} |\n`,
    `| --- | ${headers.map(() => "---:").join(" | ")} |\n`,
    `${tableRows.join("\n")}\n\n`,
    "```typescript\n",
    `${codeLines.join("\n")}\n`,
    "```\n\n",
    `![OpenDrSai visual fixture](${imageUrl})\n\n`,
    "The table and code block scroll within the response, while the image remains bounded by the readable column.",
  ].join("");
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
    importedFileCount: 12,
    skippedFileCount: 0,
    failedFileCount: 0,
    unsupportedExtensions: [],
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
  if (name.endsWith(".mp4") || [".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"].some((extension) => name.endsWith(extension))) {
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
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".ogg")) return "audio/ogg";
  if (name.endsWith(".wav")) return "audio/wav";
  return "audio/mpeg";
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
