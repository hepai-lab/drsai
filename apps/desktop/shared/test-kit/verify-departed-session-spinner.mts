import assert from "node:assert/strict";
import type { DesktopThread, DesktopThreadSnapshot } from "../api/desktopApi";
import {
  deriveThreadActivity,
  settleSnapshotForTerminalStatus,
  shouldSettleSnapshotForCatalogEvent,
} from "../renderer/src/threadActivity";

function streamingSnapshot(): DesktopThreadSnapshot {
  return {
    threadId: "thread-a",
    title: "Backgrounded chat",
    updatedAt: 1,
    messageCount: 2,
    messages: [
      { id: "u1", role: "user", content: "hi" },
      {
        id: "a1",
        role: "assistant",
        content: "partial",
        streaming: true,
        structuredTurn: { version: 2, turnId: "run-1", status: "running", parts: [] },
      },
    ],
  } as unknown as DesktopThreadSnapshot;
}

function catalogThread(status: DesktopThread["status"]): DesktopThread {
  return {
    id: "thread-a",
    kind: "chat",
    title: "Backgrounded chat",
    createdAt: "",
    updatedAt: "",
    status,
  };
}

// ── The spinner for a departed, still-streaming Session must survive ────────
// After leaving A, the row is derived from A's cached snapshot. While the
// assistant reply is still streaming the row must remain "running".
const runningThread = catalogThread("running");
const streaming = streamingSnapshot();
assert.equal(
  deriveThreadActivity({ thread: runningThread, snapshot: streaming }).kind,
  "running",
  "a departed, streaming Session must keep its running spinner",
);

// ── A plain idle catalog row must NOT settle a still-streaming snapshot ─────
// This is the regression: the Runtime catalog emits default-idle rows, and
// those must never wipe A's live progress the moment the user looks away.
assert.equal(
  shouldSettleSnapshotForCatalogEvent({
    settled: true,
    incomingThreadId: "thread-a",
    incomingStatus: "idle",
    activeThreadId: "thread-b",
  }),
  "idle",
  "an authoritative terminal broadcast for a non-active thread must settle",
);
assert.equal(
  shouldSettleSnapshotForCatalogEvent({
    settled: true,
    incomingThreadId: "thread-a",
    incomingStatus: "error",
    activeThreadId: "thread-b",
  }),
  "error",
  "an authoritative failed terminal must settle as error",
);
assert.equal(
  shouldSettleSnapshotForCatalogEvent({
    settled: undefined,
    incomingThreadId: "thread-a",
    incomingStatus: "idle",
    activeThreadId: "thread-b",
  }),
  null,
  "a plain idle row (no terminal broadcast) must NOT settle",
);
assert.equal(
  shouldSettleSnapshotForCatalogEvent({
    settled: true,
    incomingThreadId: "thread-a",
    incomingStatus: "running",
    activeThreadId: "thread-b",
  }),
  null,
  "a still-running row must NOT settle even if flagged",
);
assert.equal(
  shouldSettleSnapshotForCatalogEvent({
    settled: true,
    incomingThreadId: "thread-a",
    incomingStatus: "idle",
    activeThreadId: "thread-a",
  }),
  "idle",
  "an authoritative terminal broadcast must settle even the active thread (the composer is cleared by the matching terminal chat event / recovery, not by withholding the settle)",
);

// ── Only a real transition settles the snapshot, then the row goes idle ─────
const settled = settleSnapshotForTerminalStatus(streaming, "idle");
assert.ok(settled, "a pending snapshot must settle on a terminal transition");
assert.equal(settled!.messages[1].streaming, false);
assert.equal(settled!.messages[1].structuredTurn?.status, "completed");
assert.equal(
  deriveThreadActivity({ thread: catalogThread("idle"), snapshot: settled! }).kind,
  "idle",
  "after settling, the row must be idle",
);

// The settle is a no-op for a snapshot whose tail already settled.
const alreadyIdle: DesktopThreadSnapshot = {
  ...streaming,
  messages: streaming.messages.map((message) => message.structuredTurn
    ? { ...message, streaming: false, structuredTurn: { ...message.structuredTurn, status: "completed" as const } }
    : { ...message, streaming: false }),
};
assert.equal(settleSnapshotForTerminalStatus(alreadyIdle, "idle"), null);

console.log("Departed-session spinner verification passed.");
