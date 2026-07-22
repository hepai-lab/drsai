import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "fs";
import { dirname, join } from "path";
import { DRSAI_HOME } from "./paths";

const TELEMETRY_PATH = join(DRSAI_HOME, "logs", "agent-telemetry.jsonl");
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export type AgentTelemetryEvent =
  | "catalog_refresh"
  | "agent_selected"
  | "execution_started"
  | "execution_completed"
  | "execution_failed"
  | "execution_cancelled";

export interface AgentTelemetryRecord {
  event: AgentTelemetryEvent;
  agentId?: string;
  mode?: string;
  source?: "local" | "platform";
  status?: string;
  durationMs?: number;
  errorCode?: string;
  count?: number;
}

/** Records operational metadata only. User messages, URLs, tokens and config are not accepted. */
export function recordAgentTelemetry(record: AgentTelemetryRecord): void {
  try {
    mkdirSync(dirname(TELEMETRY_PATH), { recursive: true });
    rotateIfNeeded();
    const safe = {
      timestamp: new Date().toISOString(),
      event: record.event,
      ...(record.agentId ? { agentId: sanitize(record.agentId, 160) } : {}),
      ...(record.mode ? { mode: sanitize(record.mode, 40) } : {}),
      ...(record.source ? { source: record.source } : {}),
      ...(record.status ? { status: sanitize(record.status, 40) } : {}),
      ...(Number.isFinite(record.durationMs) ? { durationMs: Math.max(0, Math.round(record.durationMs!)) } : {}),
      ...(record.errorCode ? { errorCode: sanitize(record.errorCode, 80) } : {}),
      ...(Number.isFinite(record.count) ? { count: Math.max(0, Math.round(record.count!)) } : {}),
    };
    appendFileSync(TELEMETRY_PATH, `${JSON.stringify(safe)}\n`, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Telemetry must never interrupt catalog or chat execution.
  }
}

function rotateIfNeeded(): void {
  if (!existsSync(TELEMETRY_PATH) || statSync(TELEMETRY_PATH).size < MAX_FILE_BYTES) return;
  renameSync(TELEMETRY_PATH, `${TELEMETRY_PATH}.${Date.now()}`);
}

function sanitize(value: string, maxLength: number): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, maxLength);
}
