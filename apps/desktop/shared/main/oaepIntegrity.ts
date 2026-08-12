import { OAEP_VERSION, type OaepEvent, type OaepItem, type OaepSnapshot } from "../api/oaep.generated";
import { oaepItemsDigest } from "./oaepDigest";

const ITEM_TYPES = new Set(["message", "reasoning", "plan", "command_execution", "file_change", "tool_call", "artifact", "interaction", "subtask", "notice"]);
const ITEM_STATUSES = new Set(["pending", "running", "waiting", "completed", "failed", "cancelled"]);

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

export function canonicalOaepJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("oaep_checkpoint_number_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalOaepJson).join(",")}]`;
  const object = record(value, "oaep_checkpoint_value_invalid");
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalOaepJson(object[key])}`).join(",")}}`;
}

export function oaepProjectionDigest(items: readonly OaepItem[]): string {
  return oaepItemsDigest(items);
}

function assertItem(item: OaepItem, sessionId: string, runIds: ReadonlySet<string>): void {
  if (!item.id || item.session_id !== sessionId || !runIds.has(item.run_id)) throw new Error("oaep_snapshot_item_scope_invalid");
  if (!ITEM_TYPES.has(item.type) || !ITEM_STATUSES.has(item.status) || !Number.isSafeInteger(item.sequence) || item.sequence <= 0) {
    throw new Error("oaep_snapshot_item_invalid");
  }
  if (!item.source || typeof item.source.backend !== "string" || !item.content || typeof item.content !== "object") {
    throw new Error("oaep_snapshot_item_shape_invalid");
  }
}

export function assertOaepSnapshotIntegrity(snapshot: OaepSnapshot): void {
  if (snapshot.version !== OAEP_VERSION || !snapshot.session?.id || !Number.isSafeInteger(snapshot.snapshot_sequence)
    || snapshot.snapshot_sequence < 0 || !Array.isArray(snapshot.runs) || !Array.isArray(snapshot.items)) {
    throw new Error("oaep_snapshot_invalid");
  }
  const runIds = new Set<string>();
  for (const run of snapshot.runs) {
    if (!run.id || run.session_id !== snapshot.session.id || runIds.has(run.id)) throw new Error("oaep_snapshot_run_scope_invalid");
    runIds.add(run.id);
  }
  const itemIds = new Set<string>();
  const sequences = new Map<string, Set<number>>();
  for (const item of snapshot.items) {
    assertItem(item, snapshot.session.id, runIds);
    if (itemIds.has(item.id)) throw new Error("oaep_snapshot_item_duplicate");
    itemIds.add(item.id);
    const runSequences = sequences.get(item.run_id) ?? new Set<number>();
    if (runSequences.has(item.sequence)) throw new Error("oaep_snapshot_item_sequence_duplicate");
    runSequences.add(item.sequence);
    sequences.set(item.run_id, runSequences);
  }
  if (snapshot.checkpoint) {
    if (snapshot.checkpoint.sequence !== snapshot.snapshot_sequence || !/^[0-9a-f]{64}$/.test(snapshot.checkpoint.snapshot_hash)
      || snapshot.checkpoint.item_count < snapshot.items.length) throw new Error("oaep_snapshot_checkpoint_invalid");
    const complete = snapshot.window?.has_more === false && snapshot.checkpoint.item_count === snapshot.items.length;
    if (complete && oaepProjectionDigest(snapshot.items) !== snapshot.checkpoint.snapshot_hash) {
      throw new Error("oaep_snapshot_checkpoint_digest_mismatch");
    }
  }
  if (snapshot.window && (snapshot.window.limit < 1 || snapshot.window.limit > 500
    || snapshot.window.has_more !== Boolean(snapshot.window.next_cursor) || !snapshot.checkpoint)) {
    throw new Error("oaep_snapshot_window_invalid");
  }
}

export function assertOaepEventIntegrity(event: OaepEvent, expectedSessionId: string): void {
  if (event.version !== OAEP_VERSION || event.session_id !== expectedSessionId || !event.event_id || !event.dedupe_key
    || !Number.isSafeInteger(event.sequence) || event.sequence <= 0 || typeof event.type !== "string" || !event.type
    || !event.source?.backend || !event.data || typeof event.data !== "object") throw new Error("oaep_event_invalid");
  if (event.type.startsWith("event.item.") && (!event.run_id || !event.item_id)) throw new Error("oaep_item_event_scope_invalid");
  if ((event.type === "event.item.delta") !== Boolean(event.data.delta)) throw new Error("oaep_delta_shape_invalid");
  if (["event.item.completed", "event.item.failed"].includes(event.type) && !event.data.item) throw new Error("oaep_terminal_item_required");
  if (event.data.item && (event.data.item.id !== event.item_id || event.data.item.session_id !== event.session_id
    || event.data.item.run_id !== event.run_id)) throw new Error("oaep_event_item_scope_invalid");
}
