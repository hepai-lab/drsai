import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DesktopBackgroundTask } from "../api/desktopApi";
import {
  configureReusableTaskServices,
  configureReusableTaskStorage,
  listReusableTasks,
  prepareReusableTaskRun,
  saveReusableTask,
} from "../main/reusableTasks";

const root = await mkdtemp(join(tmpdir(), "opendrsai-reusable-tasks-"));
const workspacePath = join(root, "workspace");
const storagePath = join(root, "state", "reusable-tasks.json");
const inputPath = join(workspacePath, "input.csv");
const nextInputPath = join(workspacePath, "next.csv");
const outputPath = join(workspacePath, "report.md");
let owner = "user-a";

const sourceTask = {
  id: "source-task", kind: "agent_run", source: "agent", title: "Analyze input.csv and write report.md",
  status: "completed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), workspacePath,
  message: "Completed", verification: "Verify totals and citations",
  planSteps: [{ id: "read", phase: "input", title: "Read replacement input" }],
  deliverySummary: {
    findingSummary: "Done", importance: "medium", importanceReason: "Reusable analysis", suggestedAction: "Review",
    workSummary: "Analyzed input", coreConclusion: "Complete", verification: "Verified", remainingRisks: "None",
    artifacts: [{ id: "report", label: "Report", path: outputPath, kind: "report" }],
  },
} satisfies DesktopBackgroundTask;

try {
  await mkdir(workspacePath, { recursive: true });
  await writeFile(inputPath, "name,value\na,1\n", "utf8");
  await writeFile(outputPath, "result", "utf8");
  configureReusableTaskStorage(storagePath);
  configureReusableTaskServices({ getUserId: async () => owner, listBackgroundTasks: async () => [sourceTask] });

  const saved = await saveReusableTask({ sourceTaskId: sourceTask.id, name: "Monthly analysis" });
  assert.equal(saved.inputs[0]?.originalValue, inputPath);
  assert.match(saved.fixedRules.join("\n"), /replacement input/i);
  const sameName = await saveReusableTask({ sourceTaskId: sourceTask.id, name: "monthly analysis" });
  assert.equal(sameName.id, saved.id, "case-insensitive duplicate names update the same template");

  await Promise.all(Array.from({ length: 12 }, (_, index) => saveReusableTask({ sourceTaskId: sourceTask.id, name: `Concurrent ${index}` })));
  assert.equal((await listReusableTasks()).length, 13, "serialized mutations must not lose concurrent saves");
  await writeFile(nextInputPath, "name,value\nb,2\n", "utf8");
  owner = "user-b";
  assert.deepEqual(await listReusableTasks(), [], "templates must be isolated by authenticated user");
  owner = "user-a";

  const recipe = await prepareReusableTaskRun({
    reusableTaskId: saved.id, workspacePath, inputs: { primary_input: inputPath },
    adjustments: { outputLanguage: "zh", deadline: "Friday", checkItems: ["Verify totals", "Verify totals"] },
    adjustmentScope: "this_run",
  });
  assert.equal(recipe.cachePolicy, "force_fresh_input_read");
  assert.match(recipe.resolvedTask, /sha256 [a-f0-9]{64}/);
  assert.deepEqual(recipe.adjustments.checkItems, ["Verify totals"]);
  await assert.rejects(() => prepareReusableTaskRun({
    reusableTaskId: saved.id, workspacePath, inputs: { primary_input: inputPath }, adjustments: { checkItems: [] }, adjustmentScope: "this_run",
  }), /new input material/i);
  const updated = await prepareReusableTaskRun({
    reusableTaskId: saved.id, workspacePath, inputs: { primary_input: nextInputPath },
    adjustments: { outputLanguage: "en", checkItems: ["Check citations"] }, adjustmentScope: "update_template",
  });
  assert.equal(updated.adjustmentScope, "update_template");
  assert.equal((await listReusableTasks()).find((task) => task.id === saved.id)?.savedAdjustments.outputLanguage, "en");

  const outsidePath = join(root, "outside.csv");
  await writeFile(outsidePath, "secret", "utf8");
  await assert.rejects(() => prepareReusableTaskRun({
    reusableTaskId: saved.id, workspacePath, inputs: { primary_input: outsidePath }, adjustments: { checkItems: [] }, adjustmentScope: "this_run",
  }), /inside the selected workspace/i);

  const validStore = await readFile(storagePath, "utf8");
  await writeFile(`${storagePath}.bak`, validStore, "utf8");
  await writeFile(storagePath, "{corrupt", "utf8");
  assert.equal((await listReusableTasks()).length, 13, "corrupt primary store must recover from backup");
  console.log("Reusable task isolation, concurrency, freshness, adjustment, realpath and recovery tests passed.");
} finally {
  configureReusableTaskServices();
  configureReusableTaskStorage();
  await rm(root, { recursive: true, force: true });
}
