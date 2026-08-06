import assert from "node:assert/strict";
import type { DesktopBackgroundTask } from "../../shared/api/desktopApi.ts";
import { CompletionDeliveryTracker } from "../../shared/renderer/src/completionDeliveryTracker.ts";

const startedAt = Date.parse("2026-08-05T08:00:00.000Z");
function task(id: string, status: DesktopBackgroundTask["status"], updatedAt: string, threadId: string): DesktopBackgroundTask {
  return {
    id,
    kind: "agent_run",
    source: "agent",
    title: `Task ${id}`,
    status,
    createdAt: "2026-08-05T07:00:00.000Z",
    updatedAt,
    threadId,
    targetId: `run-${id}`,
    message: "done",
    verification: "verified",
    ...(status === "completed" ? {
      deliverySummary: {
        workSummary: "Completed the requested work",
        coreConclusion: "The result is ready",
        findingSummary: "Result first",
        importance: "high",
        importanceReason: "Requested by the user",
        artifacts: [],
        verification: "All acceptance checks passed",
        remainingRisks: "None",
        suggestedAction: "Review the result",
        completionCriteria: { passed: ["Result verified"], incomplete: [] },
      },
    } : {}),
  };
}

const tracker = new CompletionDeliveryTracker(startedAt);
const historical = task("historical", "completed", "2026-08-05T07:59:00.000Z", "thread-active");
assert.equal(tracker.observe([historical], "thread-active"), null, "historical completion must not reopen on startup");

const running = task("active", "running", "2026-08-05T08:00:01.000Z", "thread-active");
assert.equal(tracker.observe([historical, running], "thread-active"), null, "running work must not be disclosed as a result");

const unrelated = task("other", "completed", "2026-08-05T08:00:03.000Z", "thread-other");
const active = task("active", "completed", "2026-08-05T08:00:02.000Z", "thread-active");
assert.equal(
  tracker.observe([historical, unrelated, active], "thread-active")?.id,
  "active",
  "current-session completion must win over a slightly newer unrelated result",
);
assert.equal(tracker.observe([historical, unrelated, active], "thread-active"), null, "a completion must be disclosed only once");

const firstPollTracker = new CompletionDeliveryTracker(startedAt);
const justCompleted = task("instant", "completed", "2026-08-05T08:00:00.100Z", "thread-active");
assert.equal(firstPollTracker.observe([historical, justCompleted], "thread-active")?.id, "instant", "fast completion after startup must not be lost in the initial poll");

console.log(JSON.stringify({
  ok: true,
  checks: {
    historicalCompletionSuppressed: true,
    runningTaskNotDisclosed: true,
    activeSessionPrioritized: true,
    completionDisclosedOnce: true,
    fastInitialCompletionDisclosed: true,
  },
}, null, 2));
