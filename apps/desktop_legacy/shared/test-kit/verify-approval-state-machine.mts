import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentApprovalStore } from "../main/approvalStore.ts";

const root = await mkdtemp(join(tmpdir(), "opendrsai-approval-test-"));
const file = join(root, "approvals.json");
let now = new Date("2026-01-01T00:00:00.000Z");
const request = { source: "shell" as const, actionKind: "shell.command" as const, title: "Run tests", detail: "Execute npm test", risk: "high" as const, idempotencyKey: "shell-command-0001" };
try {
  const first = new PersistentApprovalStore(file, { clock: () => now, ttlMs: 1_000 });
  for (const invalid of [null, {}, { ...request, title: "" }, { ...request, detail: "" }, { ...request, title: "x".repeat(201) }, { ...request, detail: "x".repeat(4001) }, { ...request, idempotencyKey: "short" }]) {
    await assert.rejects(() => first.propose(invalid), /invalid|object/i);
  }
  for (const invalid of [null, {}, { id: "bad", approved: true }, { id: `approval:${"a".repeat(64)}`, approved: "yes" }, { id: `approval:${"a".repeat(64)}`, approved: false, reason: "other" }]) {
    await assert.rejects(() => first.decide(invalid), /invalid|object/i);
  }
  await assert.rejects(() => first.propose({ ...request, source: "network", actionKind: "workflow.run" }), /source\/action pair/);
  const git = await first.propose({ ...request, source: "git", actionKind: "git.commit", idempotencyKey: "git-commit-0001" });
  assert.equal(git.requiresApproval, true, "Commit authorization must enter approval instead of being rejected before review.");
  await first.decide({ id: git.approval!.id, approved: false, reason: "cancel" });
  const proposed = await first.propose(request);
  assert.equal(proposed.queued, true); assert.ok(proposed.approval);
  assert.equal(await first.decide({ id: proposed.approval!.id, approved: true }), false, "Approval without a recovered executor must never execute.");
  assert.equal((await first.list()).length, 1, "Unsafe approval must remain recoverable.");
  assert.equal(await first.decide({ id: `approval:${"f".repeat(64)}`, approved: false }), false);

  const restarted = new PersistentApprovalStore(file, { clock: () => now, ttlMs: 1_000 });
  assert.equal((await restarted.list())[0]?.id, proposed.approval!.id, "Pending approval must survive restart.");
  assert.equal(await restarted.decide({ id: proposed.approval!.id, approved: false, reason: "reject" }), true);
  assert.equal((await restarted.list()).length, 0);

  let executions = 0;
  const executable = await restarted.propose({ ...request, idempotencyKey: "shell-command-0002" }, async () => { executions += 1; return true; });
  const decisions = await Promise.all([restarted.decide({ id: executable.approval!.id, approved: true }), restarted.decide({ id: executable.approval!.id, approved: true })]);
  assert.equal(decisions.filter(Boolean).length, 1); assert.equal(executions, 1, "Concurrent decisions must execute exactly once.");
  const executedReplay = await restarted.propose({ ...request, idempotencyKey: "shell-command-0002" });
  assert.equal(executedReplay.requiresApproval, false, "Executed idempotency key must not be queued again.");
  assert.equal(executedReplay.alreadyExecuted, true, "Callers must be able to distinguish a completed idempotent replay from a newly allowed execution.");

  let observed: boolean | undefined;
  const randomApproval = await restarted.propose({ ...request, idempotencyKey: undefined, businessAction: " ", businessObject: "repository", target: "workspace", scope: "write", impact: "changes files", checklist: ["review diff"] }, async () => false, async (approved) => { observed = approved; });
  assert.match(randomApproval.approval!.id, /^approval:[a-f0-9-]{36}$/);
  assert.equal(randomApproval.approval!.businessAction, undefined); assert.equal(randomApproval.approval!.businessObject, "repository");
  await assert.rejects(() => restarted.decide({ id: randomApproval.approval!.id, approved: true }), /did not confirm completion/);
  assert.equal(observed, undefined, "observer must not run before execution succeeds");
  assert.equal((await restarted.list()).find((item) => item.id === randomApproval.approval!.id)?.executionState, "ambiguous", "an attempted executor must never return to a replayable pending state");
  assert.equal(await restarted.decide({ id: randomApproval.approval!.id, approved: true }), true, "ambiguous execution must be acknowledged without replay");
  assert.equal(observed, true);

  const failing = await restarted.propose({ ...request, idempotencyKey: "shell-command-failure" }, async () => { throw new Error("controlled executor failure"); });
  await assert.rejects(() => restarted.decide({ id: failing.approval!.id, approved: true }), /controlled executor failure/);
  assert.equal((await restarted.list()).find((item) => item.id === failing.approval!.id)?.executionState, "ambiguous", "An executor failure must preserve an explicit non-replayable state.");
  assert.equal(await restarted.decide({ id: failing.approval!.id, approved: false, reason: "cancel" }), true);

  const interrupted = await restarted.propose({ ...request, idempotencyKey: "shell-command-interrupted" }, async () => { throw new Error("must not be restored"); });
  const interruptedState = JSON.parse(await readFile(file, "utf8"));
  interruptedState.pending = interruptedState.pending.map((item: { id: string }) => item.id === interrupted.approval!.id ? { ...item, executionState: "executing" } : item);
  await writeFile(file, JSON.stringify(interruptedState));
  const afterCrash = new PersistentApprovalStore(file, { clock: () => now, ttlMs: 1_000 });
  assert.equal((await afterCrash.list()).find((item) => item.id === interrupted.approval!.id)?.executionState, "ambiguous", "startup must convert an interrupted execution into a non-replayable ambiguous approval");
  assert.equal(await afterCrash.decide({ id: interrupted.approval!.id, approved: true }), true, "manual acknowledgement must clear the ambiguous approval without an executor");

  const expiring = await restarted.propose({ ...request, idempotencyKey: "shell-command-0003" });
  now = new Date(now.getTime() + 1_001);
  assert.equal((await restarted.list()).some((item) => item.id === expiring.approval!.id), false, "Expired approvals must not remain actionable.");
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.ok(persisted.decisions.some((item: { reason: string }) => item.reason === "expired"));
  assert.ok(JSON.parse(await readFile(`${file}.bak`, "utf8")).decisions.length > 0);
  await writeFile(file, JSON.stringify({ pending: null, decisions: null }));
  const recoveredDecisions = new PersistentApprovalStore(file, { clock: () => now, ttlMs: 1_000 });
  assert.equal((await recoveredDecisions.propose({ ...request, idempotencyKey: "shell-command-0002" })).requiresApproval, false, "schema-invalid primary state must not forget an already executed idempotent approval");
  const filteredFile = join(root, "filtered-approvals.json");
  await writeFile(filteredFile, JSON.stringify({ pending: [null, { id: "bad" }], decisions: [null, { id: "bad" }] }));
  assert.deepEqual(await new PersistentApprovalStore(filteredFile).list(), []);
  const corruptFile = join(root, "corrupt-approvals.json"); await writeFile(corruptFile, "not-json");
  assert.deepEqual(await new PersistentApprovalStore(corruptFile).list(), []);
  console.log("Persistent approval state-machine verification passed.");
} finally { await rm(root, { recursive: true, force: true }); }
