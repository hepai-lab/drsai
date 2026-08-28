import type { DiagnosticEvent, DiagnosticIncident } from "../api/diagnostics";

export function projectDiagnosticIncidents(events: DiagnosticEvent[]): DiagnosticIncident[] {
  const failures = events.filter((event) => (event.domain === "agent" || event.domain === "app")
    && (event.status === "failed" || event.level === "error" || event.kind === "error"));
  const groups = new Map<string, DiagnosticEvent[]>();
  for (const event of failures) {
    const key = event.fingerprint || `${event.domain}:${event.component}:${event.operation}:${event.errorCode || event.message}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()].map(([fingerprint, group]) => projectIncident(events, fingerprint, group))
    .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
}

function projectIncident(allEvents: DiagnosticEvent[], fingerprint: string, group: DiagnosticEvent[]): DiagnosticIncident {
  const ordered = [...group].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const primary = ordered.at(-1)!;
  const traceEvents = allEvents.filter((event) => event.traceId === primary.traceId)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const index = traceEvents.findIndex((event) => event.id === primary.id);
  const severity = /process-gone|uncaught-exception|child-gone|runtime.*crash/i.test(`${primary.operation} ${primary.errorCode ?? ""}`)
    ? "critical" : primary.level === "error" || primary.status === "failed" ? "error" : "warning";
  return {
    id: `incident:${fingerprint}`,
    fingerprint,
    domain: primary.domain === "agent" ? "agent" : "app",
    severity,
    title: primary.errorCode || firstLine(primary.message),
    message: primary.message,
    component: primary.component,
    operation: primary.operation,
    traceId: primary.traceId,
    ...(primary.sessionId ? { sessionId: primary.sessionId } : {}),
    ...(primary.runId ? { runId: primary.runId } : {}),
    ...(primary.errorCode ? { errorCode: primary.errorCode } : {}),
    ...(primary.agentPhase ? { agentPhase: primary.agentPhase } : {}),
    ...(primary.source ? { source: primary.source } : {}),
    stack: primary.stack ?? [],
    impact: impactFor(primary),
    suggestedActions: actionsFor(primary),
    count: ordered.length,
    firstSeenAt: ordered[0].timestamp,
    lastSeenAt: primary.timestamp,
    contextBefore: index >= 0 ? traceEvents.slice(Math.max(0, index - 8), index) : [],
    contextAfter: index >= 0 ? traceEvents.slice(index + 1, index + 5) : [],
  };
}

function impactFor(event: DiagnosticEvent): string {
  const text = `${event.component} ${event.operation} ${event.errorCode ?? ""}`.toLowerCase();
  if (/thread|storage|persist|rename|file/.test(text)) return "Conversation or workspace state may not have been saved.";
  if (/renderer|window|render-process/.test(text)) return "The Desktop interface may be unavailable or inconsistent.";
  if (/runtime|agent|backend|model/.test(text)) return "The current Agent run may be blocked or terminated.";
  if (/ssh|network|gateway|connection/.test(text)) return "Remote or backend connectivity may be unavailable.";
  if (/auth|token|permission|eperm|eacces/.test(text)) return "The requested operation is blocked by authentication or permissions.";
  return `The ${event.component} operation did not complete successfully.`;
}

function actionsFor(event: DiagnosticEvent): string[] {
  const actions: string[] = [];
  if (event.source?.file) actions.push("Open the reported source location and inspect the failing code path.");
  if (/permission|eperm|eacces/i.test(`${event.errorCode ?? ""} ${event.message}`)) actions.push("Check file ownership, locks, and process permissions before retrying.");
  if (/ssh|network|gateway|connect|timeout/i.test(`${event.component} ${event.operation} ${event.message}`)) actions.push("Check the connection and the upstream component health, then retry.");
  if (event.domain === "agent") actions.push("Inspect the preceding Agent milestones and the failing tool or Backend response.");
  else actions.push("Inspect adjacent App events and restart only the affected component if needed.");
  return [...new Set(actions)].slice(0, 4);
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0].slice(0, 160);
}
