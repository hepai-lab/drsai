import { join } from "path";
import type { DesktopPendingApproval } from "../shared/desktopApi";
import { readDurableJson, writeDurableJson } from "../../../shared/main/durableJsonStore";
import { DRSAI_HOME } from "./paths";

export const DESKTOP_APPROVAL_PAYLOAD_KINDS = [
  "workspace_mutation", "workspace_checkpoint_restore", "git_commit", "remote_gateway_install",
  "fork_lifecycle", "fork_queue_start", "fork_conflict_draft",
  "channel_outbound", "mcp_enumeration", "mcp_tool_execution",
  "approval_review",
] as const;
export type DesktopApprovalPayloadKind = typeof DESKTOP_APPROVAL_PAYLOAD_KINDS[number];
export type DesktopApprovalPayload = { approvalId: string; kind: DesktopApprovalPayloadKind; value: unknown };
type State = { schemaVersion: 3; pending: DesktopPendingApproval[]; executed: Array<{ id: string; executedAt: string }>; payloads: DesktopApprovalPayload[] };
const MAX_PAYLOAD_STORE_CHARS = 8 * 1024 * 1024;
const MAX_APPROVAL_STATE_BYTES = 12 * 1024 * 1024;

export class DesktopApprovalStateStore {
  #queue = Promise.resolve();
  constructor(readonly filePath = join(DRSAI_HOME, "desktop", "desktop-approvals.json"), readonly maxBytes = MAX_APPROVAL_STATE_BYTES) {}

  load(): Promise<State> { return this.#run(async () => structuredClone((await readDurableJson(this.filePath, decode, { maxBytes: this.maxBytes }))?.value ?? empty())); }
  save(pending: Iterable<DesktopPendingApproval>, executedIds: Iterable<string>, payloads: Iterable<DesktopApprovalPayload> = []): Promise<void> { return this.#run(async () => {
    const payloadRows: DesktopApprovalPayload[] = [];
    let payloadChars = 0;
    for (const item of payloads) {
      if (payloadRows.length >= 500 || !isPayload(item, false)) continue;
      const size = JSON.stringify(item).length;
      if (payloadChars + size > MAX_PAYLOAD_STORE_CHARS) continue;
      payloadRows.push(structuredClone(item)); payloadChars += size;
    }
    const protectedIds = new Set(payloadRows.filter(isProtectedPayload).map((item) => item.approvalId));
    const pendingRows = [...pending].filter((item) => item.source !== "browser_task").slice(0, 500).map((item) =>
      protectedIds.has(item.id) ? protectedApprovalSummary(item) : structuredClone(item));
    const pendingIds = new Set(pendingRows.map((item) => item.id));
    const state: State = {
      schemaVersion: 3,
      pending: pendingRows,
      executed: [...executedIds].slice(-2_000).map((id) => ({ id, executedAt: new Date().toISOString() })),
      payloads: payloadRows.filter((item) => pendingIds.has(item.approvalId)),
    };
    await writeDurableJson(this.filePath, state, { maxBytes: this.maxBytes });
  }); }

  #run<T>(operation: () => Promise<T>): Promise<T> { const result = this.#queue.catch(() => undefined).then(operation); this.#queue = result.then(() => undefined, () => undefined); return result; }
}

function empty(): State { return { schemaVersion: 3, pending: [], executed: [], payloads: [] }; }
function decode(value: unknown): State {
  if (!value || typeof value !== "object") throw new Error("Desktop approval state schema is invalid.");
  const row = value as Partial<State>;
  if (!Array.isArray(row.pending) || !Array.isArray(row.executed)) throw new Error("Desktop approval state schema is invalid.");
  const pending = row.pending.filter(isApproval).filter((item) => item.source !== "browser_task").slice(0, 500);
  const pendingIds = new Set(pending.map((item) => item.id));
  const legacyV2 = (value as { schemaVersion?: unknown }).schemaVersion === 2;
  return {
    schemaVersion: 3,
    pending,
    executed: row.executed.filter((item): item is { id: string; executedAt: string } => Boolean(item && typeof item.id === "string" && typeof item.executedAt === "string")).slice(0, 2_000),
    payloads: boundedPayloads(Array.isArray(row.payloads) ? row.payloads : [], legacyV2, pendingIds),
  };
}
function boundedPayloads(values: unknown[], allowLegacyPlaintext: boolean, pendingIds: Set<string>): DesktopApprovalPayload[] {
  const output: DesktopApprovalPayload[] = []; let chars = 0;
  for (const value of values) {
    if (output.length >= 500 || !isPayload(value, allowLegacyPlaintext) || !pendingIds.has(value.approvalId)) continue;
    const size = JSON.stringify(value).length;
    if (chars + size > MAX_PAYLOAD_STORE_CHARS) continue;
    output.push(value); chars += size;
  }
  return output;
}
function isProtectedPayload(_item: DesktopApprovalPayload): boolean { return true; }
function protectedApprovalSummary(item: DesktopPendingApproval): DesktopPendingApproval {
  return {
    id: item.id, source: item.source, actionKind: item.actionKind,
    title: "Protected pending external approval",
    detail: "Sensitive review details are encrypted with the operating-system credential service and are restored only in memory.",
    createdAt: item.createdAt, risk: item.risk, ...(item.executionState ? { executionState: item.executionState } : {}),
  };
}
function isApproval(value: unknown): value is DesktopPendingApproval { const item = value as Partial<DesktopPendingApproval>; return Boolean(item && typeof item.id === "string" && typeof item.source === "string" && typeof item.actionKind === "string" && typeof item.title === "string" && typeof item.detail === "string" && typeof item.createdAt === "string" && (item.executionState === undefined || item.executionState === "executing" || item.executionState === "ambiguous")); }
function isPayload(value: unknown, allowLegacyPlaintext: boolean): value is DesktopApprovalPayload {
  const item = value as Partial<DesktopApprovalPayload>;
  if (!item || typeof item.approvalId !== "string" || !DESKTOP_APPROVAL_PAYLOAD_KINDS.includes(item.kind as DesktopApprovalPayloadKind) || item.value === undefined) return false;
  const envelope = item.value as { protectedPayload?: unknown };
  if (envelope && typeof envelope.protectedPayload === "string" && envelope.protectedPayload.length > 0 && envelope.protectedPayload.length <= 1_500_000) return true;
  return allowLegacyPlaintext && item.kind !== "approval_review" && item.kind !== "channel_outbound" && item.kind !== "mcp_enumeration" && item.kind !== "mcp_tool_execution";
}
