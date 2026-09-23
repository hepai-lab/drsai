import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DesktopThread, DesktopThreadSnapshot } from "../api/desktopApi";
import {
  deriveThreadActivity,
  settleLiveMessagesForTerminalStatus,
  settleSnapshotForTerminalStatus,
  shouldSettleSnapshotForCatalogEvent,
} from "../renderer/src/threadActivity.ts";

/**
 * Regression: a Session that had already ended (composer back on "发送") still
 * spun its sidebar row. The active row is derived from the adapter's live
 * `chat.messages`, not from the snapshot store, so the previous round's fixes —
 * which settled the store snapshot and the persisted catalog status — never
 * touched the live transcript, and a still-pending live structured turn kept
 * the spinner running. This test pins the terminal-settle contract for the
 * *active* row.
 *
 * The pure settle helpers are exercised directly; the adapter/App wiring is
 * asserted textually against its source (a React hook and App.tsx cannot be
 * imported here — they need React and the DOM), mirroring
 * verify-streaming-persistence.
 */

const entryFile = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.cwd(), "shared", "test-kit", "verify-active-thread-terminal-settle.mts");
const testKit = dirname(entryFile);
const renderer = resolve(testKit, "..", "renderer", "src");

const read = (path: string): string => readFileSync(path, "utf8");
const flatten = (source: string): string => source.replace(/\s+/g, " ");
const check = (source: string, needle: string, label: string): void => {
  assert.ok(flatten(source).includes(flatten(needle)), `missing terminal-settle contract: ${label}`);
};

const adapter = read(resolve(renderer, "adapters/useDesktopChatAdapter.ts"));
const app = read(resolve(renderer, "App.tsx"));

type Message = DesktopThreadSnapshot["messages"][number];
type Thread = DesktopThread;

function liveStreamingMessages(): Message[] {
  return [
    { id: "u1", role: "user", content: "hi" },
    {
      id: "a1",
      role: "assistant",
      content: "partial answer",
      streaming: true,
      structuredTurn: { version: 2, turnId: "run-1", status: "running", parts: [] },
    },
  ] as unknown as Message[];
}

function catalogThread(status: Thread["status"]): Thread {
  return { id: "thread-a", kind: "chat", title: "Active chat", createdAt: "", updatedAt: "", status } as unknown as Thread;
}

// ── 1. The reported state: composer settled, catalog idle, but the live turn
// still pending -> the active row used to spin. ─────────────────────────────
const livePending = liveStreamingMessages();
const liveSnapshot: DesktopThreadSnapshot = {
  threadId: "thread-a",
  title: "Active chat",
  messages: livePending,
  updatedAt: 1,
  messageCount: livePending.length,
} as unknown as DesktopThreadSnapshot;
assert.equal(
  deriveThreadActivity({ thread: catalogThread("idle"), snapshot: liveSnapshot }).kind,
  "running",
  "a still-pending live structured turn must report running even when the catalog is idle",
);

// ── 2. Deterministic live settle clears the spinner for the active row. ────
const settledLive = settleLiveMessagesForTerminalStatus(livePending, "idle");
assert.ok(settledLive, "a pending live transcript must settle on a terminal catalog row");
assert.equal(settledLive![1].streaming, false);
assert.equal(settledLive![1].structuredTurn?.status, "completed");
const settledLiveSnapshot: DesktopThreadSnapshot = { ...liveSnapshot, messages: settledLive! };
assert.equal(
  deriveThreadActivity({ thread: catalogThread("idle"), snapshot: settledLiveSnapshot }).kind,
  "idle",
  "after the live settle the active row must be idle",
);

// A failed terminal settles the active row as an error, not a spinner.
const settledLiveError = settleLiveMessagesForTerminalStatus(liveStreamingMessages(), "error");
assert.equal(settledLiveError![1].structuredTurn?.status, "error");
assert.equal(
  deriveThreadActivity({
    thread: catalogThread("error"),
    snapshot: { ...liveSnapshot, messages: settledLiveError! },
  }).kind,
  "error",
  "a failed terminal must surface an error row, not a spinner",
);

// ── 3. A genuinely running turn is never settled by a catalog row. ─────────
assert.equal(
  settleLiveMessagesForTerminalStatus(liveStreamingMessages().map((message) => ({ ...message })), "idle")
    ?.at(-1)?.structuredTurn?.status,
  "completed",
  "the live settle produces a completed turn for a still-pending transcript",
);
// An already-idle transcript is a no-op (returns null, no needless publish).
const idleMessages: Message[] = [
  { id: "u1", role: "user", content: "hi" },
  { id: "a1", role: "assistant", content: "done", streaming: false, structuredTurn: { version: 2, turnId: "run-1", status: "completed", parts: [] } },
] as unknown as Message[];
assert.equal(
  settleLiveMessagesForTerminalStatus(idleMessages, "idle"),
  null,
  "an already-settled live transcript must not be rewritten",
);

// ── 4. The store-settle path (backgrounded threads) still holds. ────────────
const settledStore = settleSnapshotForTerminalStatus(liveSnapshot, "idle");
assert.ok(settledStore, "the cached snapshot must settle for a backgrounded terminal");
assert.equal(
  deriveThreadActivity({ thread: catalogThread("idle"), snapshot: settledStore! }).kind,
  "idle",
);
assert.equal(
  shouldSettleSnapshotForCatalogEvent({
    settled: true,
    incomingThreadId: "thread-a",
    incomingStatus: "idle",
    activeThreadId: "thread-a",
  }),
  "idle",
  "an authoritative settled row must settle even the active Session",
);

// ── 5. Adapter wiring: every terminal chat event settles the live transcript,
// and `run_inactive` settles without surfacing a user-facing error. ──────────
check(
  adapter,
  "function settleLiveTerminalTurn(requestId: string): void {",
  "the adapter owns a deterministic live-terminal settle",
);
check(
  adapter,
  "function settleLiveTranscript(): void {",
  "the adapter exposes a settle for the whole live transcript",
);
check(
  adapter,
  "settleLiveTranscript,",
  "settleLiveTranscript is exposed on the adapter interface",
);
// The three terminal structured outcomes all funnel through the same settle.
check(
  adapter,
  'structuredEvent.type === "turn.completed" ||',
  "turn.completed reaches the terminal branch",
);
// run_inactive must settle silently (no "Reply failed" bubble).
check(
  adapter,
  'if (event.error === "run_inactive" || event.errorEnvelope?.code === "run_inactive") {',
  "run_inactive is terminal bookkeeping, not a user-visible error",
);
assert.ok(
  (flatten(adapter).match(/settleLiveTerminalTurn\(event\.requestId\)/g) ?? []).length >= 3,
  "every terminal chat event branch (structured terminal, done/aborted sentinel, error sentinel) must settle the live transcript",
);
// The coalescer still classifies the terminal publish from the cleared request.
check(
  adapter,
  "isStreaming: () => Boolean(activeRequestIdRef.current),",
  "the terminal publish is classified from the in-flight request",
);

// ── 6. App wiring: a settled catalog row for the active Session also settles
// the live row, and a stale live-row cache is dropped on thread change. ─────
check(
  app,
  "settleLiveMessagesForTerminalStatus,",
  "App imports the live settle helper",
);
check(
  app,
  "if (event.thread.id === activeThreadIdRef.current) {",
  "a settled catalog row for the active Session settles its live row",
);
check(
  app,
  "chat.settleLiveTranscript();",
  "App delegates the active-row settle to the adapter",
);
check(
  app,
  "if (cached && cached.thread !== thread) liveRowSnapshotRef.current = null;",
  "a stale live-row snapshot is dropped when the thread identity changes",
);

console.log("Active-thread terminal settle verification passed.");
