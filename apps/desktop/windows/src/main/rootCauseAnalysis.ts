import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname } from "path";
import type {
  DiagnosticClusterState,
  DiagnosticComponentHealth,
  DiagnosticErrorCluster,
  DiagnosticEvent,
  DiagnosticFaultCategory,
  DiagnosticIssueUpdateRequest,
  DiagnosticIssueUpdateResult,
  DiagnosticRootCauseAnalysis,
  DiagnosticRootCauseCandidate,
  DiagnosticRootCauseSnapshot,
  DiagnosticTrace,
} from "../shared/diagnostics";

interface IssueOverride {
  state?: DiagnosticClusterState;
  note?: string;
  mergedInto?: string;
}

interface PersistedIssueState {
  version: 1;
  overrides: Record<string, IssueOverride>;
  eventFingerprints: Record<string, string>;
}

export class DiagnosticRootCauseEngine {
  private initialized = false;
  private overrides = new Map<string, IssueOverride>();
  private eventFingerprints = new Map<string, string>();

  constructor(private readonly stateFile: string) {}

  async analyze(events: DiagnosticEvent[], traces: DiagnosticTrace[], health: DiagnosticComponentHealth[]): Promise<DiagnosticRootCauseSnapshot> {
    await this.initialize();
    const analyses = traces.map((trace) => analyzeTrace(trace, health)).filter((value): value is DiagnosticRootCauseAnalysis => value !== null);
    const clusters = this.buildClusters(events);
    return { analyses, clusters, generatedAt: new Date().toISOString() };
  }

  async update(request: DiagnosticIssueUpdateRequest): Promise<DiagnosticIssueUpdateResult> {
    await this.initialize();
    if (!validId(request.clusterId)) return { updated: false, message: "Cluster id is invalid." };
    const current = this.overrides.get(request.clusterId) ?? {};
    if (request.action === "mark-known") this.overrides.set(request.clusterId, { ...current, state: "known", note: safeNote(request.note) });
    else if (request.action === "ignore") this.overrides.set(request.clusterId, { ...current, state: "ignored", note: safeNote(request.note) });
    else if (request.action === "resolve") this.overrides.set(request.clusterId, { ...current, state: "resolved", note: safeNote(request.note) });
    else if (request.action === "reopen") this.overrides.set(request.clusterId, { ...current, state: "open", note: safeNote(request.note) });
    else if (request.action === "merge") {
      if (!request.targetClusterId || !validId(request.targetClusterId) || request.targetClusterId === request.clusterId) return { updated: false, message: "Merge target is invalid." };
      this.overrides.set(request.clusterId, { ...current, mergedInto: request.targetClusterId });
    } else if (request.action === "split") {
      const eventIds = (request.eventIds ?? []).filter(validId).slice(0, 500);
      if (!eventIds.length) return { updated: false, message: "Split requires at least one event id." };
      const splitFingerprint = `manual-${createHash("sha256").update(`${request.clusterId}:${eventIds.sort().join(":")}`).digest("hex").slice(0, 24)}`;
      for (const eventId of eventIds) this.eventFingerprints.set(eventId, splitFingerprint);
    }
    await this.persist();
    return { updated: true, message: `Diagnostic issue ${request.action} completed.` };
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const parsed = JSON.parse(await readFile(this.stateFile, "utf8")) as PersistedIssueState;
      if (parsed.version === 1) {
        this.overrides = new Map(Object.entries(parsed.overrides ?? {}).filter(([id]) => validId(id)));
        this.eventFingerprints = new Map(Object.entries(parsed.eventFingerprints ?? {}).filter(([id, fingerprint]) => validId(id) && validId(fingerprint)));
      }
    } catch {
      // Missing or damaged issue state starts clean and never blocks diagnostics.
    }
    this.initialized = true;
  }

  private buildClusters(events: DiagnosticEvent[]): DiagnosticErrorCluster[] {
    const groups = new Map<string, DiagnosticEvent[]>();
    for (const event of events.filter((item) => item.status === "failed" || item.level === "error")) {
      const ownFingerprint = this.eventFingerprints.get(event.id) ?? fingerprintEvent(event);
      const ownId = `cluster-${ownFingerprint}`;
      const targetId = resolveMergeTarget(ownId, this.overrides);
      const fingerprint = targetId.replace(/^cluster-/, "");
      groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), event]);
    }
    const now = Date.now();
    return [...groups.entries()].map(([fingerprint, clusterEvents]): DiagnosticErrorCluster => {
      const ordered = [...clusterEvents].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
      const id = `cluster-${fingerprint}`;
      const override = this.overrides.get(id) ?? {};
      const recent = ordered.filter((event) => now - Date.parse(event.timestamp) <= 24 * 60 * 60 * 1_000).length;
      const previous = ordered.filter((event) => {
        const age = now - Date.parse(event.timestamp);
        return age > 24 * 60 * 60 * 1_000 && age <= 48 * 60 * 60 * 1_000;
      }).length;
      const first = ordered[0];
      return {
        id,
        fingerprint,
        title: `${classifyFault(first).replace("-", " ")} in ${first.component}`,
        category: classifyFault(first),
        state: override.state ?? "open",
        count: ordered.length,
        traceIds: [...new Set(ordered.map((event) => event.traceId))].slice(0, 100),
        eventIds: ordered.map((event) => event.id).slice(-500),
        firstSeenAt: first.timestamp,
        lastSeenAt: ordered.at(-1)!.timestamp,
        trend: now - Date.parse(first.timestamp) < 60 * 60 * 1_000 ? "new"
          : recent > Math.max(1, previous * 1.5) ? "worsening"
          : previous > Math.max(1, recent * 1.5) ? "improving"
          : "stable",
        ...(override.note ? { knownIssueNote: override.note } : {}),
      };
    }).sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt));
  }

  private async persist(): Promise<void> {
    const state: PersistedIssueState = {
      version: 1,
      overrides: Object.fromEntries(this.overrides),
      eventFingerprints: Object.fromEntries(this.eventFingerprints),
    };
    await mkdir(dirname(this.stateFile), { recursive: true });
    await writeFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

function analyzeTrace(trace: DiagnosticTrace, health: DiagnosticComponentHealth[]): DiagnosticRootCauseAnalysis | null {
  const failures = trace.events.filter((event) => event.status === "failed" || event.level === "error");
  const waiting = trace.events.filter((event) => event.status === "waiting" && Date.now() - Date.parse(event.timestamp) >= 10_000);
  const candidates = failures.length ? failures : waiting.slice(0, 1);
  if (!candidates.length) return null;
  const ranked = candidates.map((event, index) => candidateFor(event, trace, health, index)).sort((left, right) => right.confidence - left.confidence || trace.events.findIndex((event) => event.id === left.eventId) - trace.events.findIndex((event) => event.id === right.eventId));
  const primary = ranked[0];
  const facts = [
    `${trace.events.length} diagnostic events were recorded for this trace.`,
    `${failures.length} failure event(s) and ${waiting.length} prolonged wait event(s) were observed.`,
    `The earliest candidate occurred in ${primary.title}.`,
    ...(trace.recovered ? ["The trace crossed a desktop restart and was recovered from a checkpoint."] : []),
  ];
  const uncertainties = [
    ...(!primary.evidenceEventIds.length ? ["No preceding evidence event was available for the primary candidate."] : []),
    ...(trace.events.some((event) => event.parentSpanId && !trace.events.some((candidate) => candidate.spanId === event.parentSpanId)) ? ["At least one parent span is missing."] : []),
    ...(!primary.confidence || primary.confidence < 0.75 ? ["The available evidence does not uniquely identify one root cause."] : []),
  ];
  return {
    traceId: trace.traceId,
    primary,
    alternatives: ranked.slice(1, 4),
    facts,
    inferences: [{ text: primary.explanation, confidence: primary.confidence }],
    uncertainties,
    summary: `${primary.title}. ${primary.explanation}`,
  };
}

function candidateFor(event: DiagnosticEvent, trace: DiagnosticTrace, health: DiagnosticComponentHealth[], failureIndex: number): DiagnosticRootCauseCandidate {
  const eventIndex = trace.events.findIndex((item) => item.id === event.id);
  const preceding = trace.events.slice(Math.max(0, eventIndex - 4), eventIndex);
  const propagated = trace.events.slice(eventIndex + 1).filter((item) => item.status === "failed").map((item) => item.id).slice(0, 50);
  const category = classifyFault(event);
  const unhealthy = health.some((item) => item.module === event.module && item.component === event.component && ["failed", "disconnected", "degraded"].includes(item.state));
  const confidence = Math.min(0.98, Math.max(0.25, 0.52
    + (failureIndex === 0 ? 0.14 : 0)
    + (event.errorCode ? 0.08 : 0)
    + (event.source?.file ? 0.1 : 0)
    + (event.stack?.some((frame) => frame.inApp) ? 0.08 : 0)
    + (unhealthy ? 0.06 : 0)));
  return {
    id: `cause-${event.id}`,
    traceId: trace.traceId,
    eventId: event.id,
    category,
    severity: severityFor(event, category),
    confidence: Math.round(confidence * 100) / 100,
    recoverable: ["authentication", "configuration", "network", "timeout", "dependency"].includes(category),
    title: `${category.replace("-", " ")} failure in ${event.component}`,
    explanation: `${event.operation} is the ${failureIndex === 0 ? "first" : "subsequent"} failure candidate and has ${preceding.length} preceding evidence event(s).`,
    evidenceEventIds: preceding.map((item) => item.id),
    propagatedEventIds: propagated,
    suggestedActions: suggestionsFor(category, event),
  };
}

function classifyFault(event: DiagnosticEvent): DiagnosticFaultCategory {
  const value = `${event.errorCode ?? ""} ${event.operation} ${event.message}`.toLowerCase();
  if (/cancel|abort|user.?stop/.test(value)) return "user-cancelled";
  if (/auth|token|credential|unauthor|forbidden|permission/.test(value)) return "authentication";
  if (/config|invalid.?setting|missing.?env|not.?configured/.test(value)) return "configuration";
  if (/timeout|timed.?out|deadline|waiting/.test(value)) return "timeout";
  if (/network|dns|socket|connect|ssh|econn|gateway.?unavailable/.test(value)) return "network";
  if (/memory|disk|quota|resource|enomem|enospc/.test(value)) return "resource";
  if (/process|exit|crash|signal|renderer.?gone/.test(value)) return "process";
  if (event.source?.file || event.stack?.some((frame) => frame.inApp)) return "source-code";
  if (/dependency|backend|provider|service|tool/.test(value)) return "dependency";
  return "unknown";
}

function severityFor(event: DiagnosticEvent, category: DiagnosticFaultCategory): DiagnosticRootCauseCandidate["severity"] {
  if (category === "user-cancelled") return "info";
  if (category === "process" && /main|gateway|runtime/.test(`${event.component} ${event.operation}`)) return "critical";
  if (event.status === "failed" || event.level === "error") return "error";
  return "warning";
}

function suggestionsFor(category: DiagnosticFaultCategory, event: DiagnosticEvent): string[] {
  const common = event.source?.file ? ["Open the reported source location and inspect the preceding trace events."] : ["Inspect the preceding trace events and component health."];
  const specific: Record<DiagnosticFaultCategory, string[]> = {
    authentication: ["Refresh the account session and verify the required permission."],
    configuration: ["Validate the affected module configuration and restart only that component."],
    network: ["Check Gateway, SSH, DNS, proxy, and retry history."],
    timeout: ["Inspect queue time, remote connectivity, and the slow-operation waterfall."],
    process: ["Inspect process exit details and restart history before retrying."],
    resource: ["Check memory, disk, quota, and resource samples."],
    "source-code": ["Open the first in-app stack frame and reproduce with the same inputs."],
    dependency: ["Check the upstream service or tool health and its first failure."],
    "user-cancelled": ["No repair is required unless the cancellation was unexpected."],
    unknown: ["Collect a larger diagnostic window and preserve the first failure."],
  };
  return [...specific[category], ...common];
}

function fingerprintEvent(event: DiagnosticEvent): string {
  const stack = (event.stack ?? []).filter((frame) => frame.inApp !== false).slice(0, 5).map((frame) => `${frame.file ? basename(frame.file) : "?"}:${frame.function ?? "?"}`).join("|");
  const normalizedMessage = event.message.toLowerCase().replace(/[a-f0-9]{8,}/g, "#").replace(/\b\d+\b/g, "#").replace(/(?:[a-z]:)?[/\\][^\s]+/gi, "<path>").slice(0, 300);
  return createHash("sha256").update(`${event.errorCode ?? ""}|${event.module}|${event.component}|${event.operation}|${stack}|${normalizedMessage}`).digest("hex").slice(0, 24);
}

function resolveMergeTarget(id: string, overrides: Map<string, IssueOverride>): string {
  let current = id;
  const seen = new Set<string>();
  while (overrides.get(current)?.mergedInto && !seen.has(current)) {
    seen.add(current);
    current = overrides.get(current)!.mergedInto!;
  }
  return current;
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,256}$/.test(value);
}

function safeNote(value: string | undefined): string | undefined {
  return value?.trim().replace(/\b(Bearer\s+)[^\s]+/gi, "$1[REDACTED]").replace(/\b(token|password|secret|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]").slice(0, 2_000) || undefined;
}
