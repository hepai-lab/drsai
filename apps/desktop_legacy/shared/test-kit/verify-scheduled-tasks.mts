import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "drsai-scheduled-tasks-"));
try {
  process.env.DRSAI_HOME = root;
  const [{ ScheduledTaskStore, startScheduledTaskWorker }, { WorkflowMarketplaceStore }, { WorkflowRunStore }, { writeDurableJson }] = await Promise.all([
    import("../main/scheduledTasks.ts"), import("../main/workflowMarketplace.ts"), import("../main/workflowRuns.ts"), import("../main/durableJsonStore.ts"),
  ]);
  const workspace = join(root, "workspace");
  const marketplace = new WorkflowMarketplaceStore(join(root, "marketplace.json"));
  const runs = new WorkflowRunStore(join(root, "runs.json"));
  let approvalQueued = false;
  const preparedTriggerKeys: string[] = [];
  const runtime = {
    prepare: async (request: { templateId: string; workspacePath?: string; triggerKey: string }) => {
      preparedTriggerKeys.push(request.triggerKey);
      const result = await marketplace.prepare(request);
      if (!approvalQueued) return result;
      return { ...result, queued: true, reason: "Approval required.", recipe: { ...result.recipe, status: "approval_queued" as const, approvalId: `approval:${"a".repeat(64)}` } };
    },
    start: (request: Parameters<WorkflowRunStore["start"]>[0]) => runs.start(request),
    listRuns: (path?: string) => runs.list(path),
  };
  const store = new ScheduledTaskStore(join(root, "scheduled.json"));
  const dueAt = "2025-01-01T00:00:00.000Z";
  const task = await store.create({ kind: "scheduled", title: "Hourly review", cadence: "hourly", target: "Review workspace", workspacePath: workspace, workflowTemplateId: "plan-review-fix", nextRunAt: dueAt });
  const [first, concurrent] = await Promise.all([store.runDue({ now: "2025-01-01T04:00:00.000Z" }, runtime), store.runDue({ now: "2025-01-01T04:00:00.000Z" }, runtime)]);
  assert.equal(first.triggered + concurrent.triggered, 1, "serialized scans must not double-trigger");
  assert.equal(first.items[0]?.triggerAudit?.missed, true);
  assert.equal(first.items[0]?.triggerAudit?.missedRunPolicy, "run_once_immediately");
  assert.equal((await store.list({ workspacePath: workspace }))[0].nextRunAt, "2025-01-01T05:00:00.000Z");

  const paused = await store.create({ kind: "monitor", title: "Paused monitor", cadence: "daily", target: "Observe", workspacePath: workspace, workflowTemplateId: "plan-review-fix", nextRunAt: dueAt, status: "paused" });
  assert.equal((await store.runDue({ now: "2025-01-02T00:00:00.000Z" }, runtime)).items.some((item) => item.taskId === paused.id), false);
  const resumed = await store.update({ taskId: paused.id, status: "enabled", title: "Resumed monitor", cadence: "weekly", target: "Observe safely", nextRunAt: dueAt });
  assert.equal(resumed.title, "Resumed monitor");

  approvalQueued = true;
  const approvalTask = await store.create({ kind: "scheduled", title: "Approval task", cadence: "daily", target: "Protected workflow", workspacePath: workspace, workflowTemplateId: "plan-review-fix", nextRunAt: dueAt });
  const queued = await store.runDue({ workspacePath: workspace, now: "2025-01-03T00:00:00.000Z" }, runtime);
  assert.equal(queued.items.find((item) => item.taskId === approvalTask.id)?.status, "queued_approval");
  const queuedTriggerKey = queued.items.find((item) => item.taskId === approvalTask.id)?.triggerAudit?.triggerKey;
  assert.equal((await store.list({ workspacePath: workspace })).find((item) => item.id === approvalTask.id)?.nextRunAt, dueAt, "approval must retain the due time");
  const stillQueued = await store.runDue({ workspacePath: workspace, now: "2025-01-03T00:00:00.500Z" }, runtime);
  assert.equal(stillQueued.items.find((item) => item.taskId === approvalTask.id)?.triggerAudit?.triggerKey, queuedTriggerKey, "the same due occurrence must reuse one approval key");
  assert.equal(preparedTriggerKeys.filter((key) => key === queuedTriggerKey).length, 2);
  approvalQueued = false;
  const approved = await store.runDue({ workspacePath: workspace, now: "2025-01-03T00:00:01.000Z" }, runtime);
  assert.equal(approved.items.find((item) => item.taskId === approvalTask.id)?.status, "started");
  const scheduledBackup = await readFile(join(root, "scheduled.json.bak"), "utf8");
  assert.doesNotThrow(() => JSON.parse(scheduledBackup));
  await writeFile(join(root, "scheduled.json"), "{partial-write");
  assert((await new ScheduledTaskStore(join(root, "scheduled.json")).list({ workspacePath: workspace })).some((item) => item.id === approvalTask.id), "a corrupt primary schedule must recover from its last committed backup");

  const failureStore = new ScheduledTaskStore(join(root, "scheduled-failures.json"));
  await failureStore.create({ kind: "scheduled", title: "First due", cadence: "daily", target: "Fail independently", workspacePath: workspace, workflowTemplateId: "plan-review-fix", nextRunAt: dueAt });
  await failureStore.create({ kind: "scheduled", title: "Second due", cadence: "daily", target: "Continue independently", workspacePath: workspace, workflowTemplateId: "plan-review-fix", nextRunAt: dueAt });
  let failNextStart = true;
  const isolatedRuntime = {
    prepare: async (request: { templateId: string; workspacePath?: string; triggerKey: string }) => marketplace.prepare(request),
    start: async (request: Parameters<WorkflowRunStore["start"]>[0]) => {
      if (failNextStart) { failNextStart = false; throw new Error("Bearer test-secret must be redacted"); }
      return runs.start(request);
    },
    listRuns: (path?: string) => runs.list(path),
  };
  const isolated = await failureStore.runDue({ workspacePath: workspace, now: "2025-01-05T00:00:00.000Z" }, isolatedRuntime);
  assert.equal(isolated.failed, 1); assert.equal(isolated.items.filter((item) => item.status === "started").length, 1, "one task failure must not abort other due tasks");
  assert.equal(isolated.items.find((item) => item.status === "failed")?.message.includes("test-secret"), false, "trigger failures must be redacted");
  const retried = await failureStore.runDue({ workspacePath: workspace, now: "2025-01-05T00:00:01.000Z" }, isolatedRuntime);
  assert.equal(retried.items.filter((item) => item.status === "started").length, 1, "the failed due occurrence must remain retryable");

  const idempotentPrepared = await marketplace.prepare({ templateId: "plan-review-fix", workspacePath: workspace });
  idempotentPrepared.recipe.id = `workflow:plan-review-fix:11111111-1111-1111-1111-111111111111`;
  const stableTriggerKey = "1".repeat(64);
  const [sameRunA, sameRunB] = await Promise.all([runs.start({ recipe: idempotentPrepared.recipe, idempotencyKey: stableTriggerKey }), runs.start({ recipe: idempotentPrepared.recipe, idempotencyKey: stableTriggerKey })]);
  assert.equal(sameRunA.run.id, sameRunB.run.id, "a stable recipe id must return the existing Workflow run");
  assert.equal((await runs.list(workspace)).filter((run) => run.recipeId === idempotentPrepared.recipe.id).length, 1);
  const workflowBackup = await readFile(join(root, "runs.json.bak"), "utf8");
  assert.doesNotThrow(() => JSON.parse(workflowBackup));
  await writeFile(join(root, "runs.json"), JSON.stringify({ schemaVersion: 2, workspaces: null }));
  assert((await new WorkflowRunStore(join(root, "runs.json")).list(workspace)).some((run) => run.id === sameRunA.run.id), "schema-invalid Workflow history must recover from backup");

  const missing = await store.create({ kind: "scheduled", title: "No workflow", cadence: "daily", target: "No target", nextRunAt: dueAt });
  assert.equal((await store.runDue({ now: "2025-01-04T00:00:00.000Z" }, runtime)).items.find((item) => item.taskId === missing.id)?.status, "skipped");
  const deleted = await store.delete({ taskId: approvalTask.id }); assert.equal(deleted.removed, true); assert.equal(deleted.historyPolicy, "retain_results");
  assert.equal((await store.delete({ taskId: approvalTask.id })).removed, false);
  assert.equal(JSON.parse(await readFile(join(root, "scheduled.json"), "utf8")).schemaVersion, 2);
  await assert.rejects(() => store.create({ kind: "scheduled", title: "Bearer secret-token", cadence: "daily", target: "x" }), /credentials/i);
  await assert.rejects(() => store.create({ kind: "scheduled", title: "Bad timezone", cadence: "daily", target: "x", userDefinition: { sourceText: "daily", timeDescription: "noon", materialDescription: "workspace", actionDescription: "review", notificationDescription: "notify", timezone: "Mars/Olympus", localTime: "12:00", confirmedAt: dueAt } }), /timezone/i);

  const validationStore = new ScheduledTaskStore(join(root, "scheduled-validation.json"));
  const validDefinition = { sourceText: "Every Monday", timeDescription: "at noon", materialDescription: "current workspace", actionDescription: "review changes", notificationDescription: "notify me", timezone: "UTC", weekday: 1, localTime: "12:00", confirmedAt: dueAt };
  const manual = await validationStore.create({ kind: "monitor", title: "Manual monitor", cadence: "manual", target: "Observe", approvalRequired: false, message: "Ready", verification: "Inspect result", status: "blocked", userDefinition: validDefinition });
  assert.equal(manual.nextRunAt, undefined); assert.equal(manual.approvalRequired, false); assert.equal(manual.userDefinition?.weekday, 1);
  assert.deepEqual(await validationStore.list(null), [manual]);
  assert.equal((await validationStore.list({ limit: 999.8 })).length, 1);
  assert.equal((await validationStore.list({ limit: -4 })).length, 1);
  const updatedManual = await validationStore.update({ taskId: manual.id, status: "paused", nextRunAt: "", message: "Paused", verification: "Resume later", userDefinition: { ...validDefinition, weekday: undefined, localTime: undefined } });
  assert.equal(updatedManual.nextRunAt, undefined); assert.equal(updatedManual.userDefinition?.weekday, undefined);
  assert.equal((await validationStore.runDue({}, runtime)).checked, 0);

  const invalidCreates: unknown[] = [
    null,
    {},
    { kind: "other", title: "x", cadence: "daily", target: "x" },
    { kind: "scheduled", title: "", cadence: "daily", target: "x" },
    { kind: "scheduled", title: "x", cadence: "never", target: "x" },
    { kind: "scheduled", title: "x", cadence: "daily", target: "" },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", workflowTemplateId: "INVALID" },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", nextRunAt: "not-a-date" },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", workspacePath: "bad\0path" },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", userDefinition: null },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", userDefinition: { ...validDefinition, weekday: -1 } },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", userDefinition: { ...validDefinition, weekday: 7 } },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", userDefinition: { ...validDefinition, weekday: 1.5 } },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", userDefinition: { ...validDefinition, localTime: "24:00" } },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", userDefinition: { ...validDefinition, localTime: 1200 } },
    { kind: "scheduled", title: "x", cadence: "daily", target: "x", userDefinition: { ...validDefinition, confirmedAt: "bad" } },
  ];
  for (const invalid of invalidCreates) await assert.rejects(() => validationStore.create(invalid), /invalid|timezone/i);
  await assert.rejects(() => validationStore.update(null), /invalid/i);
  await assert.rejects(() => validationStore.update({ taskId: manual.id, status: "unknown" }), /status/i);
  await assert.rejects(() => validationStore.update({ taskId: "scheduled-task:scheduled:not-a-uuid", status: "enabled" }), /id/i);
  await assert.rejects(() => validationStore.update({ taskId: `scheduled-task:scheduled:${randomUUID()}`, status: "enabled" }), /not found/i);
  await assert.rejects(() => validationStore.runDue({ now: "bad" }, runtime), /timestamp/i);
  await assert.rejects(() => validationStore.delete(null), /id/i);

  await writeFile(join(root, "scheduled-corrupt.json"), "not-json");
  assert.deepEqual(await new ScheduledTaskStore(join(root, "scheduled-corrupt.json")).list(), []);
  const blockedParent = join(root, "not-a-directory");
  await writeFile(blockedParent, "block writes below this path");
  await assert.rejects(() => writeDurableJson(join(blockedParent, "state.json"), { workspaces: {} }), /EEXIST|ENOTDIR|directory/i, "persistence failures must propagate instead of reporting a commit");
  await writeFile(join(root, "scheduled-filter.json"), JSON.stringify({ workspaces: { invalid: [manual], __global__: "bad", ["a".repeat(64)]: [{}, { ...manual, id: "bad" }] } }));
  assert.deepEqual(await new ScheduledTaskStore(join(root, "scheduled-filter.json")).list(), []);

  const worker = startScheduledTaskWorker(store, runtime, { initialDelayMs: 300_000, intervalMs: 1 });
  assert.equal(worker.getStatus().intervalMs, 60_000);
  await worker.runOnce(); assert(worker.getStatus().lastFinishedAt); worker.stop();
  assert.equal(worker.getStatus().stopped, true); assert.equal(await worker.runOnce(), null);
  console.log("Scheduled task CRUD, serialized due scans, missed-run collapse, approval retention, history policy and worker lifecycle passed.");
} finally { await rm(root, { recursive: true, force: true }); }
