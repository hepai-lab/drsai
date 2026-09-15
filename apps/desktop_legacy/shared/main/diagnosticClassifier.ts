import { createHash } from "crypto";
import type {
  AgentDiagnosticPhase,
  DiagnosticDomain,
  DiagnosticEvent,
  DiagnosticEventInput,
  DiagnosticVisibility,
} from "../api/diagnostics";

type ClassifiableDiagnostic = DiagnosticEventInput | DiagnosticEvent;

export interface DiagnosticClassification {
  domain: DiagnosticDomain;
  visibility: DiagnosticVisibility;
  agentPhase?: AgentDiagnosticPhase;
  fingerprint?: string;
}

export function classifyDiagnosticEvent(input: ClassifiableDiagnostic): DiagnosticClassification {
  const domain = input.domain ?? inferDomain(input);
  const agentPhase = input.agentPhase ?? (domain === "agent" ? inferAgentPhase(input) : undefined);
  const visibility = input.visibility ?? inferVisibility(input, domain, agentPhase);
  const fingerprint = input.fingerprint ?? (isFailure(input) ? createDiagnosticFingerprint(input, domain) : undefined);
  return {
    domain,
    visibility,
    ...(agentPhase ? { agentPhase } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  };
}

function inferDomain(input: ClassifiableDiagnostic): DiagnosticDomain {
  const text = `${input.module} ${input.component} ${input.operation}`.toLowerCase();
  if (/\boaep\b|structured-conversation|conversation\.(event|snapshot)|protocol/.test(text)) return "protocol";
  if (
    input.runId || input.turnId || input.backendId
    || /chat\.run|chat\.(start|structured|tool|reasoning|status|chunk|done|error|aborted)|agent\.|tool\.|model\.|approval/.test(text)
  ) return "agent";
  return "app";
}

function inferAgentPhase(input: ClassifiableDiagnostic): AgentDiagnosticPhase {
  if (input.status === "failed" || input.level === "error") return "failed";
  if (input.status === "cancelled") return "cancelled";
  const text = `${input.operation} ${input.message}`.toLowerCase();
  if (/approval|input.request|input_request|waiting for user/.test(text)) return "waiting_approval";
  if (/tool|command|shell|terminal/.test(text)) return "calling_tool";
  if (/reasoning|thinking/.test(text)) return "reasoning";
  if (/message|respond|output_text|chat\.chunk/.test(text)) return "responding";
  if (/waiting.*(model|backend|gateway)|model.*wait|first.*event/.test(text)) return "waiting_model";
  if (/connect|stream|retry|reconnect|runtime\.request/.test(text)) return "connecting";
  if (input.status === "completed" || /completed|finished|chat\.done/.test(text)) return "completed";
  return "preparing";
}

function inferVisibility(
  input: ClassifiableDiagnostic,
  domain: DiagnosticDomain,
  phase: AgentDiagnosticPhase | undefined,
): DiagnosticVisibility {
  if (isFailure(input) || input.level === "warn") return "milestone";
  const text = `${input.operation} ${input.message}`.toLowerCase();
  if (domain === "protocol") return /delta|cursor|sequence|events\.page/.test(text) ? "raw" : "detail";
  if (domain === "agent" && phase && ["preparing", "waiting_model", "calling_tool", "waiting_approval", "completed", "cancelled"].includes(phase)) return "milestone";
  if (input.level === "debug") return "raw";
  return "detail";
}

function isFailure(input: ClassifiableDiagnostic): boolean {
  return input.status === "failed" || input.level === "error" || input.kind === "error";
}

function createDiagnosticFingerprint(input: ClassifiableDiagnostic, domain: DiagnosticDomain): string {
  const source = input.source?.file ? `${normalizeSource(input.source.file)}:${input.source.line ?? 0}` : "";
  const normalizedMessage = input.message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\b\d{3,}\b/g, "<n>")
    .replace(/\\/g, "/")
    .slice(0, 500);
  return createHash("sha256").update([
    domain, input.component, input.operation, input.errorCode ?? "", source, normalizedMessage,
  ].join("|")).digest("hex").slice(0, 24);
}

function normalizeSource(value: string): string {
  return value.replace(/\\/g, "/").replace(/^[a-z]:/i, "<drive>").toLowerCase();
}
