import type {
  DesktopExternalConnectionReadiness,
  DesktopExternalConnectionReadinessResult,
} from "../shared/desktopApi";
import { listChannelAdapters } from "./channelAdapters";

export function listExternalConnectionReadiness(
  workspacePath?: string,
): DesktopExternalConnectionReadinessResult {
  const adapters = listChannelAdapters(workspacePath).adapters;
  const mobileAdapter = adapters.find((adapter) => adapter.id === "mobile-chat");
  const githubAdapter = adapters.find((adapter) => adapter.id === "github-connector");
  const slackAdapter = adapters.find((adapter) => adapter.id === "slack-chat");
  const fileAdapter = adapters.find((adapter) => adapter.id === "file-input");
  const docsAdapter = adapters.find((adapter) => adapter.id === "docs-connector");
  const calendarAdapter = adapters.find((adapter) => adapter.id === "calendar-connector");
  const databaseAdapter = adapters.find((adapter) => adapter.id === "database-connector");
  const logMonitorAdapter = adapters.find((adapter) => adapter.id === "logs-monitor");
  const connectorCount = adapters.filter((adapter) => adapter.kind === "connector").length;
  const approvedChannelCount = adapters.filter((adapter) => adapter.requiresApproval).length;

  const baseConnections: DesktopExternalConnectionReadiness[] = [
    {
      id: "mobile",
      name: "Mobile chat",
      status: mobileAdapter?.configured ? "partial" : "planned",
      configured: Boolean(mobileAdapter?.configured),
      readOnly: true,
      capabilitySources: [
        "mobile-chat",
        ".drsai/mobile-context.json",
        "reviewed phone-originated message handoff",
        "approval-aware outbound drafts",
      ],
      evidence: [
        mobileAdapter ? "Mobile chat entry adapter is cataloged" : "Mobile chat setup path exists",
        "Phone-originated message snapshots can be reviewed before desktop attach",
        "Desktop continuation uses local handoff metadata until live pairing exists",
      ],
      gaps: [
        "Live mobile device pairing",
        "Push notification routing",
        "Remote mobile send/read receipt reconciliation",
      ],
      approvalBoundary:
        "Mobile chat readiness imports reviewed local handoff files only; no device session, push service, or remote send is started.",
      verification:
        "Covered by verify:external-connections and verify:channel-adapters without mobile device or push-provider access.",
    },
    {
      id: "github",
      name: "GitHub",
      status: githubAdapter?.configured ? "available" : "partial",
      configured: Boolean(githubAdapter?.configured),
      readOnly: true,
      capabilitySources: [
        "github-connector",
        "local Git remote scope",
        ".drsai/github-context.json",
        "approval-gated outbound drafts",
      ],
      evidence: [
        githubAdapter?.configured ? "local_git_remote configured" : "local Git remote setup path exists",
        "Issue and pull request snapshot import is bounded and reviewed",
        "Outbound draft delivery stays approval-gated",
      ],
      gaps: [
        "Live GitHub OAuth/API sync",
        "Actions log download and retry orchestration",
        "Remote PR/comment mutation",
      ],
      approvalBoundary:
        "Read-only context import is allowed after visible review; outbound drafts require Approval Center and no live provider send is performed locally.",
      verification:
        "Covered by verify:external-connections and verify:channel-adapters without network or GitHub API calls.",
    },
    {
      id: "chrome",
      name: "Chrome",
      status: "partial",
      configured: false,
      readOnly: true,
      capabilitySources: [
        "browser controller approvals",
        "HAR/NetLog/trace snapshots",
        "bookmark/cookie/link shortcut imports",
      ],
      evidence: [
        "Browser actions are approval-gated",
        "Chrome/Edge NetLog and DevTools traces are parsed from local snapshots",
        "Bookmarks, cookies, URL shortcuts, and HAR files are redacted before chat attach",
      ],
      gaps: [
        "Live Chrome profile connection",
        "Signed-in browser session reuse",
        "Interactive DOM capture and screenshot sync",
      ],
      approvalBoundary:
        "Local snapshots are read-only; live browser automation remains behind browser task approvals.",
      verification:
        "Covered by verify:external-connections plus existing browser/channel adapter verifiers; no browser process is started.",
    },
    {
      id: "slack",
      name: "Slack",
      status: slackAdapter?.configured ? "available" : "partial",
      configured: Boolean(slackAdapter?.configured),
      readOnly: true,
      capabilitySources: [
        "slack-chat",
        ".drsai/slack-context.json",
        "reviewed message snapshot import",
        "approval-gated reply drafts",
      ],
      evidence: [
        slackAdapter ? "Slack channel adapter contract is cataloged" : "Slack connector setup path exists",
        "Workspace-local Slack snapshots can be reviewed before chat attach",
        "Reply/send paths stay approval-gated and do not call Slack locally",
      ],
      gaps: [
        "Live Slack OAuth/session sync",
        "Channel history and thread readback",
        "Remote message send/update/delete mutation",
      ],
      approvalBoundary:
        "Slack context is imported from reviewed local snapshots; outbound replies remain drafts until Approval Center and live provider delivery are implemented.",
      verification:
        "Covered by verify:external-connections and verify:channel-adapters without Slack API calls.",
    },
    {
      id: "docs",
      name: "Docs",
      status: docsAdapter?.configured ? "available" : "partial",
      configured: Boolean(docsAdapter?.configured),
      readOnly: true,
      capabilitySources: [
        "docs-connector",
        ".drsai/docs-context.json",
        "selected document snapshots",
        "approval-gated edit drafts",
      ],
      evidence: [
        docsAdapter ? "Docs connector snapshot contract is cataloged" : "Docs connector setup path exists",
        "Document context can be attached from bounded local handoff files",
        "Edit requests are represented as drafts rather than remote mutations",
      ],
      gaps: [
        "Live Docs provider authorization",
        "Document comment/edit sync",
        "Remote file permissions and version history",
      ],
      approvalBoundary:
        "Docs readiness is local snapshot and draft metadata only; no provider file is read, written, shared, or commented on.",
      verification:
        "Covered by verify:external-connections and verify:channel-adapters without Docs provider API calls.",
    },
    {
      id: "calendar",
      name: "Calendar",
      status: calendarAdapter?.configured ? "available" : "partial",
      configured: Boolean(calendarAdapter?.configured),
      readOnly: true,
      capabilitySources: [
        "calendar-connector",
        ".drsai/calendar-context.json",
        ".drsai/calendar-context.ics",
        "scheduled follow-up task context",
      ],
      evidence: [
        calendarAdapter ? "Calendar connector snapshot contract is cataloged" : "Calendar connector setup path exists",
        "Agenda handoff files can become reviewed inbound task context",
        "Follow-up scheduling stays local until provider sync exists",
      ],
      gaps: [
        "Live Calendar OAuth/API sync",
        "Meeting attendee/free-busy readback",
        "Remote event create/update/delete mutation",
      ],
      approvalBoundary:
        "Calendar readiness uses reviewed local agenda snapshots and task metadata only; no remote event is read or changed.",
      verification:
        "Covered by verify:external-connections and verify:channel-adapters without Calendar API calls.",
    },
    {
      id: "latex",
      name: "LaTeX",
      status: fileAdapter?.status === "available" ? "partial" : "planned",
      configured: fileAdapter?.status === "available",
      readOnly: true,
      capabilitySources: [
        "file-input",
        ".tex/.bib/.bibtex/latexmkrc previews",
        "PDF metadata and structure previews",
      ],
      evidence: [
        "LaTeX/BibTeX files are summarized from bounded workspace-local text",
        "Include and bibliography targets are listed but not opened",
        "PDF artifacts can be attached as reviewed local files",
      ],
      gaps: [
        "TeX/BibTeX command execution",
        "PDF compilation and SyncTeX/source mapping",
        "Template and bibliography resolution workflow",
      ],
      approvalBoundary:
        "LaTeX context import never runs TeX tools, mutates files, downloads packages, or sends provider requests.",
      verification:
        "Covered by verify:external-connections and channel adapter LaTeX file-input assertions.",
    },
    {
      id: "database",
      name: "Database snapshots",
      status: databaseAdapter?.configured ? "partial" : "planned",
      configured: Boolean(databaseAdapter?.configured),
      readOnly: true,
      capabilitySources: [
        "database-connector",
        ".drsai/database-context.json",
        "table/query snapshot imports",
        "database schema file previews",
      ],
      evidence: [
        databaseAdapter ? "Database snapshot adapter is cataloged" : "Database connector setup path exists",
        "Workspace-local table/query snapshots can be attached as reviewed context",
        "Schema and relationship hints stay heuristic and read-only",
      ],
      gaps: [
        "Live database connection management",
        "Credential validation and vault integration",
        "Query execution, schema introspection, and mutation rollback",
      ],
      approvalBoundary:
        "Database readiness reads reviewed local snapshots only; no database socket, credential lookup, query execution, or mutation is performed.",
      verification:
        "Covered by verify:external-connections and database/file channel adapter verifiers without live database access.",
    },
    {
      id: "log-monitor",
      name: "Log monitor",
      status: logMonitorAdapter?.configured ? "partial" : "planned",
      configured: Boolean(logMonitorAdapter?.configured),
      readOnly: true,
      capabilitySources: [
        "logs-monitor",
        ".drsai/log-monitor.json",
        "incremental log snapshot imports",
        "durable cursor metadata",
        "reviewed local retention policy hints",
      ],
      evidence: [
        logMonitorAdapter ? "Workspace log monitor adapter is cataloged" : "Log monitor setup path exists",
        "Reviewed local log deltas can be attached as task status context",
        "Cursor metadata is local and does not start a tailing process",
        "Retention policy hints are surfaced for review without deleting, rotating, or truncating logs",
      ],
      gaps: [
        "Live log streaming",
        "Provider-backed alert correlation",
        "Retention enforcement and remote incident sync",
      ],
      approvalBoundary:
        "Log monitor readiness imports reviewed local deltas and retention hints only; no tail process, remote log provider, filesystem watcher, deletion, rotation, or truncation is started.",
      verification:
        "Covered by verify:external-connections and channel adapter log fixture checks without live log streaming.",
    },
    {
      id: "unified",
      name: "Unified connection model",
      status: connectorCount > 0 && approvedChannelCount > 0 ? "available" : "partial",
      configured: connectorCount > 0,
      readOnly: true,
      capabilitySources: [
        "channel adapter catalog",
        "Approval Center",
        "MCP live bridge audit",
        "workflow external_runtime resume",
        "Docs and Calendar connector snapshots",
      ],
      evidence: [
        `${connectorCount} connector adapters are cataloged`,
        `${approvedChannelCount} channel actions are approval-gated`,
        slackAdapter ? "Slack connector snapshot contract exists" : "Slack connector pending",
        docsAdapter ? "Docs connector snapshot contract exists" : "Docs connector pending",
        calendarAdapter ? "Calendar connector snapshot contract exists" : "Calendar connector pending",
        mobileAdapter ? "Mobile chat handoff contract exists" : "Mobile chat pending",
        databaseAdapter ? "Database snapshot contract exists" : "Database snapshots pending",
        logMonitorAdapter ? "Log monitor handoff contract exists" : "Log monitor pending",
      ],
      gaps: [
        "Provider-owned process supervision",
        "Cross-provider credential vault integration",
        "Remote marketplace/connector installation",
      ],
      approvalBoundary:
        "External services share explicit approval, reviewed context import, bounded local persistence, and no implicit reconnect after restart.",
      verification:
        "Covered by verify:external-connections, verify:approval-center, verify:workflow-marketplace, and verify:mcp-live-bridge.",
    },
  ];

  const connections: DesktopExternalConnectionReadiness[] = baseConnections.map((connection) => ({
    ...connection,
    reconnectReadinessChecks: buildReconnectReadinessChecks(connection),
    reconnectPolicy: buildReconnectPolicy(connection.id),
  }));

  const readyCount = connections.filter((connection) => connection.status === "available").length;
  const partialCount = connections.filter((connection) => connection.status === "partial").length;
  const plannedCount = connections.filter((connection) => connection.status === "planned").length;

  return {
    workspacePath,
    generatedAt: new Date().toISOString(),
    readyCount,
    partialCount,
    plannedCount,
    connections,
    message: "External connection readiness was assembled from local desktop contracts.",
    verification:
      "No OAuth flow, browser process, LaTeX command, provider API call, network request, or workspace mutation was performed.",
  };
}

function buildReconnectReadinessChecks(
  connection: DesktopExternalConnectionReadiness,
): string[] {
  const checks = [
    "Local adapter contract is cataloged",
    "Remaining live-runtime gaps are visible before reconnect",
    "Approval boundary is documented before provider work starts",
    "Verification confirms no credential, network, or runtime action ran",
  ];
  if (connection.configured) {
    checks.unshift("Local snapshot or session stub is configured");
  } else {
    checks.unshift("Setup is still local-only and requires user review");
  }
  if (connection.gaps.length > 0) {
    checks.push(`Next live gap: ${connection.gaps[0]}`);
  }
  return checks;
}

function buildReconnectPolicy(
  id: DesktopExternalConnectionReadiness["id"],
): NonNullable<DesktopExternalConnectionReadiness["reconnectPolicy"]> {
  const commonSafeguards = [
    "Manual review before any provider runtime starts",
    "No credential lookup, OAuth exchange, network request, or remote mutation",
  ];
  const providerLabel = {
    mobile: "mobile pairing",
    github: "GitHub OAuth/API",
    chrome: "browser profile",
    latex: "TeX toolchain",
    slack: "Slack OAuth/API",
    docs: "Docs provider",
    calendar: "Calendar provider",
    database: "database socket",
    "log-monitor": "log watcher",
    unified: "provider runtime",
  }[id];
  return {
    mode: "manual_review",
    automatic: false,
    triggers: [
      "App startup readiness refresh",
      "User-triggered Channels refresh",
      "Connector snapshot sync request",
    ],
    safeguards: commonSafeguards,
    nextStep: `Prepare an approval-gated ${providerLabel} reconnect plan when live runtime credentials are available.`,
    verification:
      "Reconnect policy is local readiness metadata only; no autonomous reconnect or provider runtime was started.",
  };
}
