import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configureManagerPresentationTaskStorage,
  getManagerPresentationRecovery,
  recordManagerPresentationProgress,
  recordManagerPresentationStart,
  resolveManagerPresentationRecovery,
} from "../main/managerPresentationTasks";
import type { ManagerPresentationGenerateRequest, ManagerPresentationProgressEvent } from "../api/desktopApi";

const root = await mkdtemp(join(tmpdir(), "opendrsai-presentation-"));
const workspacePath = join(root, "workspace");
const sourcePath = join(workspacePath, "source.pdf");
const outputPath = join(workspacePath, "artifacts", "manager.pptx");
const storagePath = join(root, "state", "tasks.json");

try {
  await mkdir(join(workspacePath, "artifacts"), { recursive: true });
  await writeFile(sourcePath, "%PDF-1.4\n", "utf8");
  configureManagerPresentationTaskStorage(storagePath);
  const request: ManagerPresentationGenerateRequest = {
    requestId: "presentation-test",
    workspacePath,
    sourcePath,
    audience: "non_expert_managers",
    requirements: ["  concise   summary  ", "concise summary", "include risks"],
  };
  recordManagerPresentationStart(request);
  const progress: ManagerPresentationProgressEvent = {
    requestId: request.requestId,
    phase: "generating",
    activeStage: "generating",
    progress: 61,
    message: "Generating editable slides",
    outputPath,
    stageArtifacts: [],
  };
  recordManagerPresentationProgress(request, progress);
  const recovery = getManagerPresentationRecovery({ workspacePath, sourcePath });
  assert.equal(recovery?.phase, "interrupted");
  assert.equal(recovery?.progress, 61);
  assert.deepEqual(recovery?.requirements, ["concise summary", "include risks"]);

  await writeFile(outputPath, "partial", "utf8");
  await writeFile(outputPath.replace(/\.pptx$/i, ".provenance.json"), "{}", "utf8");
  const resolved = resolveManagerPresentationRecovery({ requestId: request.requestId, workspacePath, sourcePath, decision: "abandon" });
  assert.equal(resolved.accepted, true);
  await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  assert.equal(getManagerPresentationRecovery({ workspacePath, sourcePath }), null);

  await writeFile(storagePath, "{corrupt", "utf8");
  await writeFile(`${storagePath}.bak`, JSON.stringify([{
    requestId: "backup-task", workspacePath, sourcePath, phase: "paused", activeStage: "planning",
    progress: 35, message: "Paused", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }]), "utf8");
  assert.equal(getManagerPresentationRecovery({ workspacePath, sourcePath })?.requestId, "backup-task");
  console.log("Manager presentation task recovery tests passed.");
} finally {
  configureManagerPresentationTaskStorage();
  await rm(root, { recursive: true, force: true });
}
