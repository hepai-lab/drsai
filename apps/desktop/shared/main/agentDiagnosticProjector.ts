import type {
  AgentDiagnosticConnectionState,
  AgentDiagnosticPhase,
  AgentRunDiagnosticState,
  DiagnosticEvent,
  DiagnosticStatus,
} from "../api/diagnostics";

const TERMINAL = new Set<DiagnosticStatus>(["completed", "failed", "cancelled"]);

export function projectAgentRunStates(events: DiagnosticEvent[], now = Date.now()): AgentRunDiagnosticState[] {
  const grouped = new Map<string, DiagnosticEvent[]>();
  for (const event of events) {
    if (event.domain !== "agent") continue;
    grouped.set(event.traceId, [...(grouped.get(event.traceId) ?? []), event]);
  }
  return [...grouped.entries()].map(([traceId, values]) => projectRun(traceId, values, now))
    .sort((left, right) => Date.parse(right.lastEventAt) - Date.parse(left.lastEventAt));
}

function projectRun(traceId: string, values: DiagnosticEvent[], now: number): AgentRunDiagnosticState {
  const events = [...values].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const first = events[0];
  const latest = events.at(-1)!;
  const phase = latest.agentPhase ?? "preparing";
  const phaseStart = findPhaseStart(events, phase);
  const terminal = [...events].reverse().find((event) => TERMINAL.has(event.status) && isRunTerminalEvent(event));
  const status: DiagnosticStatus = terminal?.status
    ?? (latest.status === "waiting" ? "waiting" : latest.status === "started" ? "started" : "running");
  const actionEvent = [...events].reverse().find((event) => event.visibility === "milestone") ?? latest;
  const runId = findLatest(events, "runId");
  const sessionId = findLatest(events, "sessionId");
  const backendId = findLatest(events, "backendId");
  const model = findAttribute(events, "model");
  const currentTool = findCurrentTool(events, phase);
  const firstFailure = events.find((event) => event.status === "failed" || event.level === "error");
  const end = terminal?.endedAt ? Date.parse(terminal.endedAt) : terminal ? Date.parse(terminal.timestamp) : now;
  return {
    id: runId || traceId,
    traceId,
    ...(sessionId ? { sessionId } : {}),
    ...(runId ? { runId } : {}),
    ...(backendId ? { backendId } : {}),
    ...(model ? { model } : {}),
    status,
    phase,
    action: actionEvent.message,
    startedAt: first.timestamp,
    phaseStartedAt: phaseStart.timestamp,
    lastEventAt: latest.timestamp,
    elapsedMs: Math.max(0, end - Date.parse(first.timestamp)),
    phaseElapsedMs: Math.max(0, end - Date.parse(phaseStart.timestamp)),
    connectionState: inferConnectionState(events, phase),
    ...(currentTool ? { currentTool } : {}),
    ...(firstFailure ? { firstFailure } : {}),
    recentEvents: events.slice(-20),
  };
}

function findPhaseStart(events: DiagnosticEvent[], phase: AgentDiagnosticPhase): DiagnosticEvent {
  let result = events.at(-1)!;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].agentPhase !== phase) break;
    result = events[index];
  }
  return result;
}

function findLatest<K extends "runId" | "sessionId" | "backendId">(events: DiagnosticEvent[], key: K): string | undefined {
  return [...events].reverse().find((event) => Boolean(event[key]))?.[key];
}

function findAttribute(events: DiagnosticEvent[], key: string): string | undefined {
  for (const event of [...events].reverse()) {
    const value = event.attributes?.[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function findCurrentTool(events: DiagnosticEvent[], phase: AgentDiagnosticPhase): string | undefined {
  if (phase !== "calling_tool") return undefined;
  for (const event of [...events].reverse()) {
    const named = event.attributes?.toolName;
    if (typeof named === "string" && named) return named;
    if (/tool|terminal|shell|command/i.test(`${event.component} ${event.operation}`)) return event.component;
  }
  return undefined;
}

function inferConnectionState(events: DiagnosticEvent[], phase: AgentDiagnosticPhase): AgentDiagnosticConnectionState {
  for (const event of [...events].reverse()) {
    const text = `${event.operation} ${event.message}`.toLowerCase();
    if (!/connect|stream|retry|gateway|runtime/.test(text)) continue;
    if (event.status === "failed" || /disconnected|connection.*failed/.test(text)) return "disconnected";
    if (event.status === "waiting" || /retry|reconnect/.test(text)) return "retrying";
    if (event.status === "completed" || /restored|connected|accepted/.test(text)) return "connected";
  }
  return phase === "connecting" ? "connecting" : events.length > 1 ? "connected" : "unknown";
}

function isRunTerminalEvent(event: DiagnosticEvent): boolean {
  return event.agentPhase === "completed" || event.agentPhase === "failed" || event.agentPhase === "cancelled"
    || /chat\.run|chat\.(done|error|aborted)|run\.(completed|failed|cancelled)/i.test(event.operation);
}
