import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decideRuntimeRestartRecovery } from "../../shared/api/runtimeRestartRecovery.ts";
import { normalizeRuntimeErrorEnvelope } from "../../shared/api/errorEnvelope.ts";
import { describeUserFacingError } from "../../shared/renderer/src/userFacingErrors.ts";

const runtime = { runtime_id: "runtime-stable", instance_id: "instance-current" };
for (let round = 1; round <= 20; round += 1) {
  const completed = decideRuntimeRestartRecovery({
    status: "completed", runtime_id: "runtime-stable", instance_id: `instance-old-${round}`,
  }, runtime);
  assert.deepEqual(completed, { kind: "terminal", status: "completed", reexecute: false });

  const live = decideRuntimeRestartRecovery({
    status: round % 2 ? "running" : "waiting_approval",
    runtime_id: "runtime-stable", instance_id: "instance-current",
  }, runtime);
  assert.equal(live.kind, "reconnect");
  assert.equal(live.reexecute, false);

  const interrupted = decideRuntimeRestartRecovery({
    status: round % 2 ? "running" : "queued",
    runtime_id: "runtime-stable", instance_id: `instance-old-${round}`,
  }, runtime);
  assert.equal(interrupted.kind, "interrupted");
  assert.equal(interrupted.reexecute, false);
  if (interrupted.kind === "interrupted") assert.deepEqual(interrupted.actions, ["continue", "redo", "abandon"]);
}

const envelope = normalizeRuntimeErrorEnvelope({
  code: "runtime_restart_interrupted",
  category: "runtime",
  retryable: false,
  recovery_actions: ["continue", "redo", "abandon"],
  diagnostic_reference: "run:redacted",
});
assert.deepEqual(envelope.recovery_actions, ["continue", "redo", "abandon"]);
for (const language of ["zh", "en"] as const) {
  const described = describeUserFacingError(envelope, language);
  assert.deepEqual(described.actions.map((action) => action.id), ["continue", "redo", "abandon"]);
  assert.ok(described.title.length > 10 && described.action.length > 20);
}

const repoRoot = resolve(process.cwd(), "../../..");
const chat = readFileSync(resolve(repoRoot, "apps/desktop/shared/main/chat.ts"), "utf8");
const recoveryStart = chat.indexOf("export async function recoverChatRun");
const recoveryEnd = chat.indexOf("export async function respondChatInput", recoveryStart);
const recovery = chat.slice(recoveryStart, recoveryEnd);
assert.ok(recovery.includes("decideRuntimeRestartRecovery(authoritativeRun, runtimeIdentity)"));
assert.ok(recovery.includes('recoveryDecision.kind === "reconnect"') && recovery.includes("subscribeOaepSession"));
assert.ok(recovery.includes("current.listOaepEvents(thread!.runtimeSessionId!, cursor, 2_000)"), "Recovery must page the complete OAEP journal.");
assert.ok(recovery.includes("withCurrentRecoveryClient") && recovery.includes("isRuntimeClientGenerationInvalidated(error)") && recovery.includes("attempt >= 4"), "Recovery must reconnect with a bounded retry when the Runtime generation changes.");
assert.ok(recovery.includes('recoveryDecision.kind === "interrupted"') && recovery.includes("current.cancelAgentRun(thread!.lastRunId!)"));
assert.ok(recovery.includes('recovery_actions: ["continue", "redo", "abandon"]'));
assert.equal(recovery.includes("runChat("), false, "Restart recovery must never resend the original chat turn.");
assert.ok(recovery.includes("waitingForCapability && authoritativeRun.input_message"), "Only an explicit recovered capability choice may continue an existing Run.");
assert.ok(recovery.indexOf('recoveryDecision.kind === "interrupted"') < recovery.indexOf("current.cancelAgentRun(thread!.lastRunId!)"));

const app = readFileSync(resolve(repoRoot, "apps/desktop/shared/renderer/src/App.tsx"), "utf8");
assert.ok(app.includes('action === "continue"') && app.includes("不要重复已经发生的副作用"));
assert.ok(app.includes('action === "redo"') && app.includes("originalInput"));
assert.ok(app.includes('action === "abandon"') && app.includes("dismissRecoveryActions"));

console.log("M07-F04 restart recovery policy passed: 20/20 completed/live/interrupted matrices and 3/3 user actions.");
