import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "drsai-background-tasks-"));
try {
  const [{ BackgroundTaskStore }, { WorkflowMarketplaceStore }, { WorkflowRunStore }] = await Promise.all([import("../main/backgroundTasks.ts"), import("../main/workflowMarketplace.ts"), import("../main/workflowRuns.ts")]);
  let owner = "user-a"; const file = join(root, "tasks.json"); const store = new BackgroundTaskStore(file, async () => owner);
  const request = { kind: "agent_run" as const, source: "agent" as const, title: "Analyze workspace", workspacePath: join(root, "workspace"), targetId: "run-1", idempotencyKey: "agent:run-1", maxAttempts: 2 };
  const concurrent = await Promise.all(Array.from({ length: 12 }, () => store.enqueue(request)));
  assert.equal(new Set(concurrent.map((task) => task.id)).size, 1, "concurrent idempotent enqueue must create one task");
  assert.equal((await store.list()).length, 1);
  const running = await store.update({ taskId: concurrent[0].id, status: "running", progress: 25, currentStep: "Inspect" }); assert.equal(running.progress, 25);
  await assert.rejects(() => store.update({ taskId: running.id, status: "queued" }), /not allowed/i);
  const cancelled = await store.cancel({ taskId: running.id, reason: "User requested cancellation" }); assert.equal(cancelled.status, "cancelled"); assert(cancelled.cancelledAt);
  assert.equal((await store.cancel({ taskId: running.id })).cancelledAt, cancelled.cancelledAt, "cancel must be idempotent");
  const retry = await store.retry({ taskId: running.id }); assert.equal(retry.status, "queued"); assert.equal(retry.attempt, 2); assert.equal(retry.retryOfTaskId, running.id);
  await store.update({ taskId: running.id, status: "failed", message: "Retry failed" }); await assert.rejects(() => store.retry({ taskId: running.id }), /limit/i);

  owner = "user-b"; assert.equal((await store.list()).length, 0, "owners must be isolated"); await assert.rejects(() => store.cancel({ taskId: running.id }), /not found/i); owner = "user-a";
  const recovering = await store.enqueue({ kind: "connector_sync", source: "connector", title: "Sync connector", idempotencyKey: "connector:sync:one" }); await store.update({ taskId: recovering.id, status: "running" });
  const recovered = await store.recover(); const recoveredTask = recovered.tasks.find((task) => task.id === recovering.id); assert.equal(recoveredTask?.status, "queued"); assert(recoveredTask?.recoveredAt); assert.match(recoveredTask?.message ?? "", /explicit dispatch/i);

  const marketplace = new WorkflowMarketplaceStore(join(root, "marketplace.json")); const workflowRuns = new WorkflowRunStore(join(root, "workflow-runs.json")); const prepared = await marketplace.prepare({ templateId: "plan-review-fix", workspacePath: request.workspacePath }); const started = await workflowRuns.start({ recipe: prepared.recipe });
  const mirrored = await store.upsertWorkflow(started.run); assert.equal(mirrored.kind, "workflow_run"); assert.equal(mirrored.status, "running"); assert.equal(mirrored.targetId, started.run.id);
  const mirroredAgain = await store.upsertWorkflow(started.run); assert.equal(mirroredAgain.id, mirrored.id); assert.equal((await store.list()).filter((task) => task.targetId === started.run.id).length, 1);

  await assert.rejects(() => store.enqueue({ ...request, idempotencyKey: "new-secret-key", title: "Bearer abc.def.ghi" }), /credentials/i);
  assert.equal(JSON.parse(await readFile(file, "utf8")).schemaVersion, 2);
  assert.equal(JSON.parse(await readFile(`${file}.bak`, "utf8")).schemaVersion, 2);
  await writeFile(file, "{truncated-background-state");
  const recoveredStore = new BackgroundTaskStore(file, async () => owner);
  assert((await recoveredStore.list()).some((task) => task.id === mirrored.id), "corrupt primary state must recover Workflow mirroring and task history from backup");
  await writeFile(join(root, "legacy.json"), JSON.stringify({ workspaces: { __global__: [{ bad: true }] } })); const legacy = new BackgroundTaskStore(join(root, "legacy.json")); assert.deepEqual(await legacy.list(), []);
  console.log("Background task idempotency, ownership, transitions, cancellation, bounded retry, restart recovery and Workflow mirroring passed.");
} finally { await rm(root, { recursive: true, force: true }); }
