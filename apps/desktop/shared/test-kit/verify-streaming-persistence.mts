import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { deriveThreadActivity } from "../renderer/src/threadActivity.ts";
import {
  createThreadSnapshotPublishScheduler,
  THREAD_SNAPSHOT_STREAM_INTERVAL_MS,
} from "../renderer/src/threadSnapshotPublishScheduler.ts";

/**
 * A streaming turn used to republish the *whole* conversation on every
 * animation frame, and every publish persisted it: the renderer serialized a
 * full snapshot over IPC and the main process rewrote that snapshot file plus
 * the entire thread catalog. A 600 KiB conversation therefore wrote ~35 MiB/s
 * while an answer streamed, which saturated the main process, delayed the SSE
 * dispatch that produced the next delta, and fed the backpressure controller's
 * own throttle - a self-amplifying loop whose cost was paid by the user as a
 * stuttering transcript.
 *
 * The property under test is therefore not "the UI renders fast" but the
 * *shape* of everything that runs once per frame during a turn:
 *
 *   1.  threadSnapshotPublishScheduler - a streaming publish is coalesced into
 *       a trailing window and the snapshot is built only when that window
 *       fires, while a terminal or one-shot publish goes out immediately.
 *   2.  threadSnapshotPublishScheduler - a thread swap or a discarded
 *       conversation can never drop or misattribute a pending publish, and the
 *       next conversation opens its own window rather than inheriting the
 *       previous one's write cadence.
 *   3.  useDesktopChatAdapter - wires the window to the live request state and
 *       clears the streaming flag *before* flushing buffered deltas, so the
 *       last publish of a turn is never classified as streaming.
 *   4.  threadActivity - the per-frame activity derivation finds a run at the
 *       tail instead of by scanning the whole transcript, so the streaming path
 *       is a single pass over the conversation rather than two.
 *   5.  ChatWorkspace - the message-array comparison starts at the tail, where
 *       a delta lands, instead of at the oldest message. Callback changes
 *       refresh the workspace while stable row events retain fresh closures
 *       without invalidating unchanged historical messages.
 *   6.  App.tsx - sidebar rows are derived once per change rather than three
 *       times per frame, the catalog row is only rewritten when one of the
 *       fields the catalog stores moved, and a row's relative time label still
 *       tracks the clock.
 *   7.  streamingDisplayBuffer - display releases are quantized to an animation
 *       frame while keeping the same budget, so the state update lands in the
 *       frame that paints it.
 *
 * The scheduler and the activity derivation are exercised through their own
 * interfaces, because a React hook, a React component and App.tsx cannot be
 * imported here (they need React, the DOM and the whole application graph).
 * The workspace memo/event behavior reuses the isolated source-execution
 * harness in verify-chat-workspace-memo; the remaining wiring contracts are
 * asserted textually against their sources.
 */

// Resolve the checkout from the entry path the runner was given rather than
// from `import.meta.url`: the bundled runner executes a copy under a temporary
// directory, so module-relative *file reads* would resolve outside the
// checkout. Both runners pass the entry as argv[2], so this works either way.
// (Module imports above are resolved by the runner, which rewrites them.)
const entryFile = process.argv[2]
  ? resolve(process.argv[2])
  : join(process.cwd(), "shared", "test-kit", "verify-streaming-persistence.mts");
const testKit = dirname(entryFile);
const desktop = resolve(testKit, "..");
const renderer = resolve(desktop, "renderer/src");

const read = (path: string): string => readFileSync(path, "utf8");
const flatten = (source: string): string => source.replace(/\s+/g, " ");
const count = (source: string, needle: string): number => source.split(needle).length - 1;

function check(source: string, needle: string, label: string): void {
  assert.ok(flatten(source).includes(flatten(needle)), `missing streaming-persistence contract: ${label}`);
}

function countOf(source: string, needle: string, expected: number, label: string): void {
  assert.equal(count(flatten(source), flatten(needle)), expected, `unexpected occurrence count: ${label}`);
}

function bodyOf(source: string, signature: string, nextSignature: string): string {
  const flat = flatten(source);
  const start = flat.indexOf(flatten(signature));
  assert.ok(start >= 0, `missing declaration: ${signature}`);
  const end = flat.indexOf(flatten(nextSignature), start);
  assert.ok(end > start, `missing following declaration: ${nextSignature}`);
  return flat.slice(start, end);
}

const adapter = read(resolve(renderer, "adapters/useDesktopChatAdapter.ts"));
const app = read(resolve(renderer, "App.tsx"));
const scheduler = read(resolve(renderer, "threadSnapshotPublishScheduler.ts"));
const chatWorkspace = read(resolve(renderer, "components/ChatWorkspace.tsx"));
const displayBuffer = read(resolve(renderer, "streamingDisplayBuffer.ts"));

// 1. The coalescing window, exercised directly.
//
// The scheduler is the only place that decides when a snapshot is built, so the
// cost model is asserted against the real implementation: a frame may schedule
// as often as it likes, and the number of publishes - not the number of calls -
// is what stays bounded.
function createSchedulerHarness() {
  const publishes: string[][] = [];
  const timers: Array<{ handle: number; run: () => void; delay: number }> = [];
  const microtasks: Array<() => void> = [];
  const state = { now: 1_000, streaming: true, nextHandle: 0 };
  const publishScheduler = createThreadSnapshotPublishScheduler<string[]>({
    isStreaming: () => state.streaming,
    publish: (messages) => {
      publishes.push(messages);
      return true;
    },
    now: () => state.now,
    setTimeout: (run, delay) => {
      state.nextHandle += 1;
      timers.push({ handle: state.nextHandle, run, delay });
      return state.nextHandle;
    },
    clearTimeout: (handle) => {
      const index = timers.findIndex((candidate) => candidate.handle === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    queueMicrotask: (run) => microtasks.push(run),
  });
  return {
    publishScheduler,
    publishes,
    timers,
    state,
    drainMicrotasks: () => {
      while (microtasks.length) microtasks.shift()?.();
    },
    fireTimers: () => {
      while (timers.length) timers.shift()?.run();
    },
  };
}

const burst = createSchedulerHarness();
for (let frame = 0; frame < 600; frame += 1) burst.publishScheduler.schedule([`frame-${frame}`]);
assert.equal(burst.publishes.length, 0, "A streaming publish must wait out its coalescing window.");
assert.equal(burst.timers.length, 1, "600 rendered frames must arm one window, not one per frame.");
// The window is measured from the previous publish, so the first update of a
// turn is not held back: the answer appears the moment it starts.
assert.equal(burst.timers[0]?.delay, 0, "The first streaming update of a turn must not be delayed.");
burst.fireTimers();
assert.deepEqual(burst.publishes, [["frame-599"]], "The window publishes the newest state exactly once.");

// A burst that starts right after a publish waits out the rest of the window -
// this is the case that used to become one publish per animation frame.
for (let frame = 0; frame < 600; frame += 1) burst.publishScheduler.schedule([`later-${frame}`]);
assert.equal(burst.timers.length, 1, "A later burst still arms exactly one window.");
assert.equal(burst.timers[0]?.delay, THREAD_SNAPSHOT_STREAM_INTERVAL_MS, "A burst right after a publish waits out the full window.");
burst.fireTimers();
assert.deepEqual(burst.publishes.at(-1), ["later-599"], "The second window publishes the newest state.");
assert.equal(burst.publishes.length, 2, "1,200 rendered frames must produce two publishes, not 1,200.");

// The window is trailing but never slower than one interval: the time a burst
// already spent waiting counts against the window it reopened.
const cadence = createSchedulerHarness();
cadence.publishScheduler.schedule(["first"]);
cadence.fireTimers();
assert.deepEqual(cadence.publishes, [["first"]]);
cadence.state.now += 700;
cadence.publishScheduler.schedule(["second"]);
assert.equal(cadence.timers[0]?.delay, 50, "A recent publish shortens the next window instead of restarting it.");
cadence.fireTimers();
assert.deepEqual(cadence.publishes.at(-1), ["second"]);

// A terminal update must not wait out a window that started mid-run, and the
// window it replaces must be cancelled rather than left to fire late.
const terminal = createSchedulerHarness();
terminal.publishScheduler.schedule(["mid-run"]);
assert.equal(terminal.timers.length, 1, "A streaming update arms the window.");
terminal.state.streaming = false;
terminal.publishScheduler.schedule(["done"]);
assert.deepEqual(terminal.publishes, [["done"]], "A terminal update publishes without waiting.");
assert.equal(terminal.timers.length, 0, "The mid-run window is cancelled, not left to fire late.");

// A one-shot update (nothing in flight) is not deferred behind a window at all.
const oneShot = createSchedulerHarness();
oneShot.state.streaming = false;
oneShot.publishScheduler.schedule(["one-shot"]);
assert.equal(oneShot.timers.length, 0, "A one-shot publish must not arm a window.");
assert.deepEqual(oneShot.publishes, [], "A one-shot publish goes out on the microtask queue.");
oneShot.drainMicrotasks();
assert.deepEqual(oneShot.publishes, [["one-shot"]]);

// 2. A coalescing window must never swallow or misattribute the tail, and it
// must stay scoped to the conversation that opened it.
const swap = createSchedulerHarness();
swap.publishScheduler.flush();
assert.deepEqual(swap.publishes, [], "Flushing an idle scheduler must not publish.");
swap.publishScheduler.schedule(["tail"]);
swap.publishScheduler.flush();
assert.deepEqual(swap.publishes, [["tail"]], "A thread swap must publish the pending tail.");
assert.equal(swap.timers.length, 0, "A flush must cancel the window it replaces.");
swap.publishScheduler.flush();
assert.equal(swap.publishes.length, 1, "A flush with nothing pending must stay free.");

const discarded = createSchedulerHarness();
discarded.publishScheduler.schedule(["previous-thread"]);
assert.equal(discarded.timers.length, 1, "The previous conversation armed its own window.");
discarded.state.now += 200;
discarded.publishScheduler.reset();
assert.equal(discarded.timers.length, 0, "Discarding a conversation must cancel its window.");
discarded.fireTimers();
discarded.drainMicrotasks();
assert.deepEqual(discarded.publishes, [], "A discarded conversation must not publish its tail.");
// The window belongs to the conversation that opened it: the next conversation
// starts with a fresh one, so its first update is not held back for the rest of
// the previous thread's interval.
discarded.publishScheduler.schedule(["next-thread"]);
assert.equal(
  discarded.timers[0]?.delay,
  0,
  "A new conversation must not wait out the previous conversation's window.",
);
discarded.fireTimers();
assert.deepEqual(discarded.publishes, [["next-thread"]], "The next conversation still publishes normally.");
discarded.state.streaming = false;
discarded.publishScheduler.schedule(["next-thread-done"]);
discarded.drainMicrotasks();
assert.deepEqual(discarded.publishes.at(-1), ["next-thread-done"], "A terminal update still publishes without waiting.");

// The interval lives with the window it bounds.
check(scheduler, "export const THREAD_SNAPSHOT_STREAM_INTERVAL_MS = 750;", "streaming coalescing window");

// 3. The adapter wiring: the window is fed from live request state, and the
// snapshot is built on the publish path only.
const schedule = bodyOf(
  adapter,
  "function scheduleThreadUpdate(nextMessages: UiMessage[]): void {",
  "function flushThreadSnapshot(leavingThreadId?: string): void {",
);
assert.ok(
  schedule.includes("threadSnapshotScheduler().schedule(nextMessages);"),
  "A per-frame update must be handed to the coalescing window.",
);
// The hot path is reached once per frame, so it may schedule work but must
// neither build a snapshot nor hand one to the main process.
assert.ok(
  !schedule.includes("createThreadSnapshot"),
  "The per-frame publish path must not serialize a conversation snapshot.",
);
assert.ok(
  !schedule.includes("notifyThreadUpdated"),
  "The per-frame publish path must not persist a conversation snapshot.",
);
check(
  adapter,
  "isStreaming: () => Boolean(activeRequestIdRef.current),",
  "the window classifies a publish from the in-flight request",
);
check(
  adapter,
  "publish: (nextMessages, publishThreadId) => { const snapshot = createThreadSnapshot(nextMessages, false, publishThreadId); if",
  "the window persists through the adapter's single publish path",
);
// A thread switch runs the render before the cleanup: the live thread ref
// already names the incoming conversation when the leaving one is flushed. The
// leaving id must therefore be threaded through the flush, or the coalesced
// tail is persisted under the NEW thread's id and pollutes it.
countOf(adapter, "flushThreadSnapshot(threadId); cacheLiveThreadView(threadId);", 3, "all thread-change cleanups flush a pending publish under the leaving thread id");
check(adapter, "structuredFlushTimerRef.current = window.setTimeout(flushStructuredEventDeltas, 50);", "structured deltas have a timer fallback when requestAnimationFrame is delayed");
check(adapter, "assistantId = assistantId || `stream:${requestId}`;", "structured events recreate a missing active assistant shell instead of being dropped");
check(
  adapter,
  "threadId: threadIdOverride ?? threadIdRef.current,",
  "a flushed snapshot keeps the leaving thread's id",
);
// The leaving thread's run stays tracked through its cached live view; the
// refs themselves must be cleared so the incoming thread does not inherit a
// stale "active" request (stuck "running" composer, Stop cancelling the wrong
// session, snapshot restore blocked by the stale-ref guard).
check(
  adapter,
  "activeRequestIdRef.current = null; setCancellingRequestId(null); cancellingRequestIdRef.current = null; setActiveRequestId(null);",
  "the non-cached thread switch clears the in-flight request refs before restoring the incoming thread",
);
check(
  adapter,
  "threadSnapshotScheduler().reset();",
  "a new conversation must not inherit the previous thread's pending publish",
);

// Terminal events must not wait out a window that started mid-run, and the
// final buffered delta must be merged with the terminal state before the one
// publish. Flushing first would build and persist a full snapshot twice.
countOf(
  adapter,
  "if (activeRequestIdRef.current === event.requestId) activeRequestIdRef.current = null; const terminalDeltas = takePendingDeltas();",
  2,
  "done/aborted and error must clear the streaming flag before taking their deltas",
);
assert.ok(
  !flatten(adapter).includes(flatten("activeRequestIdRef.current = null; flushPendingDeltas();")),
  "A terminal event must not publish buffered deltas separately from its terminal state.",
);
assert.ok(
  adapter.match(/applyPendingDeltas\(current, terminalDeltas\)/g)?.length === 4,
  "Every structured/unstructured terminal branch must merge deltas into its single terminal publish.",
);

// 4. The per-frame activity derivation, exercised directly.
//
// The sidebar derives a row's activity on every frame a turn streams, and that
// derivation used to walk the whole transcript once to decide whether anything
// was running and again to find a pending interaction. The message list is
// wrapped in a proxy that counts element reads, so "one pass" is measured
// rather than described.
type ActivityInput = Parameters<typeof deriveThreadActivity>[0];
type Snapshot = NonNullable<ActivityInput["snapshot"]>;
type Message = Snapshot["messages"][number];
type Thread = ActivityInput["thread"];

const MESSAGE_COUNT = 5_000;

function conversation(): Message[] {
  const messages = Array.from({ length: MESSAGE_COUNT }, (_, index) => ({
    id: `message-${index}`,
    role: "assistant",
    structuredTurn: { status: "completed", parts: [] as Array<Record<string, unknown>> },
  }));
  return messages as unknown as Message[];
}

function indexReadsOf(messages: Message[]): { messages: Message[]; reads: () => number } {
  let reads = 0;
  const counted = new Proxy(messages, {
    get(target, property, receiver) {
      // Only element reads (0, 1, ...) are what make the walk expensive;
      // `.length` and the array methods are not.
      if (typeof property === "string" && /^[0-9]+$/.test(property)) reads += 1;
      return Reflect.get(target, property, receiver);
    },
  });
  return { messages: counted, reads: () => reads };
}

function snapshotOf(messages: Message[], threadId: string): Snapshot {
  return {
    threadId,
    title: "Conversation",
    messages,
    updatedAt: 0,
    messageCount: messages.length,
  } as unknown as Snapshot;
}

function idleThreadOf(id: string): Thread {
  return {
    id,
    kind: "chat",
    title: "Conversation",
    createdAt: "",
    updatedAt: "",
    status: "idle",
  } as unknown as Thread;
}

function structuredTurnOf(message: Message): { status: string; parts: Array<Record<string, unknown>> } {
  return (message as unknown as {
    structuredTurn: { status: string; parts: Array<Record<string, unknown>> };
  }).structuredTurn;
}

// A run at the tail must be found without re-walking the conversation.
const running = conversation();
structuredTurnOf(running[MESSAGE_COUNT - 1]).status = "running";
const runningReads = indexReadsOf(running);
assert.deepEqual(
  deriveThreadActivity({
    thread: idleThreadOf("thread-running"),
    snapshot: snapshotOf(runningReads.messages, "thread-running"),
  }),
  { kind: "running" },
  "A run at the tail marks its row as running.",
);
assert.ok(
  runningReads.reads() <= MESSAGE_COUNT + 2,
  `The per-frame derivation must not make a second pass over the transcript (${runningReads.reads()} reads for ${MESSAGE_COUNT} messages).`,
);

// The same holds for the settled conversation the sidebar shows most of the
// time: at most the two passes the derivation needs (one to look for a pending
// interaction anywhere, one to confirm nothing is running), never a third.
const settledReads = indexReadsOf(conversation());
assert.deepEqual(
  deriveThreadActivity({
    thread: idleThreadOf("thread-idle"),
    snapshot: snapshotOf(settledReads.messages, "thread-idle"),
  }),
  { kind: "idle" },
  "A settled conversation marks its row as idle.",
);
assert.ok(
  settledReads.reads() <= 2 * MESSAGE_COUNT + 3,
  `A settled conversation must not exceed two passes over the transcript (${settledReads.reads()} reads for ${MESSAGE_COUNT} messages).`,
);

// A pending approval is what the sidebar has to surface, and it sits on the
// turn being streamed: finding it must not cost a scan of its own.
const approval = conversation();
const approvalTurn = structuredTurnOf(approval[MESSAGE_COUNT - 1]);
approvalTurn.status = "running";
approvalTurn.parts = [{ kind: "interaction", status: "pending", interactionType: "approval" }];
const approvalReads = indexReadsOf(approval);
assert.deepEqual(
  deriveThreadActivity({
    thread: idleThreadOf("thread-approval"),
    snapshot: snapshotOf(approvalReads.messages, "thread-approval"),
  }),
  { kind: "attention", reason: "approval" },
  "A pending approval is surfaced as attention.",
);
assert.ok(
  approvalReads.reads() <= 2,
  `A pending interaction is found at the tail (${approvalReads.reads()} reads).`,
);

// 5. ChatWorkspace: the message array is compared from the tail, where a delta
// lands, and the array-prop set is not rebuilt inside the comparator.
check(
  chatWorkspace,
  "for (let index = left.length - 1; index >= 0; index -= 1) {",
  "the message-array comparison scans from the tail",
);
check(
  chatWorkspace,
  "const CHAT_WORKSPACE_ARRAY_PROPS: ReadonlySet<keyof ChatWorkspaceProps> = new Set<keyof ChatWorkspaceProps>([",
  "the array-prop set is hoisted out of the comparator",
);
// Callback-only updates MUST cross the outer memo boundary to refresh event
// refs. The performance contract is unchanged history-row stability, not a
// frozen workspace: skipping callbacks here would retain stale closures.
// Reuse the behavioral harness (same test-kit-relative argv[2] source lookup)
// rather than prescribing an unsafe comparator implementation as source text.
await import("./verify-chat-workspace-memo.mts");

// 6. App.tsx: the sidebar derives each row once, and the catalog row is only
// rewritten when a field the catalog actually stores moved.
check(app, "const workspaceRowCacheRef = useRef(new Map<string, {", "sidebar rows are cached against their inputs");
check(app, "&& cached.thread === thread", "a cached row is reused only for the thread it was built for");
check(app, "&& cached.snapshot === snapshot", "a cached row is reused only while its snapshot is unchanged");
check(app, "&& cached.timeLabelKey === timeLabelKey", "a cached row's relative time label must still track the clock");
check(app, "function threadTimeLabelKey(updatedAt: string): number {", "the time-label key is derived from elapsed whole minutes");
countOf(app, "buildWorkspaceThread(thread, chat.messages)", 3, "every sidebar list reuses the cached row builder");
check(app, "const sidebarThreads = useMemo(() => canonicalizeSidebarThreads(threads), [threads]);", "the catalog derivation is not repeated per frame");
check(app, "const unarchivedSidebarThreads = useMemo(", "the workspace list is not re-sorted per frame");

const catalogGuard = bodyOf(
  app,
  "const catalogRowIsCurrent = Boolean(existingThread)",
  "let thread: DesktopThread;",
);
assert.ok(
  catalogGuard.includes("existingThread!.status === nextStatus"),
  "The catalog row must still be rewritten when the derived status moved.",
);
assert.ok(
  catalogGuard.includes("existingThread!.messageCount === snapshot.messageCount"),
  "The catalog row must still be rewritten when the message count moved.",
);
countOf(
  app,
  "if (catalogRowIsCurrent) return;",
  1,
  "a streaming publish that moved no catalog field must not rewrite the catalog row",
);

// 7. The display buffer: releases stay frame-aligned within the same budget, so
// the state update lands in the frame that paints it.
countOf(displayBuffer, "setTimeout(", 0, "a display release must not be timer-driven");
check(displayBuffer, "export const STREAMING_MARKDOWN_BUDGET_MS = 64;", "the display release keeps its budget");
check(displayBuffer, "frameRef.current = window.requestAnimationFrame(onFrame);", "display releases are frame-aligned");
countOf(displayBuffer, "window.cancelAnimationFrame(frameRef.current);", 2, "every scheduled frame can be cancelled");
check(displayBuffer, "return streaming ? displayed : authoritative;", "a finished turn shows the authoritative text");

console.log(
  "Streaming persistence, publish coalescing, per-frame derivation and frame-aligned display release verification passed.",
);
