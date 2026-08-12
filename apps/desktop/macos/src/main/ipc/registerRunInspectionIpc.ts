import { app, dialog, type IpcMain } from "electron";
import { rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RunInspectionOpenRequest,
  RunItemLocatorRequest,
  RunManifestExportResult,
  RunManifestReadRequest,
  SessionRunsReadRequest,
} from "../../../../shared/api/runInspection";
import {
  sanitizeRunInspection,
  sanitizeRunReproductionManifest,
  sanitizeSessionRunList,
} from "../../../../shared/api/runInspectionSafety";
import type {
  ApplyRunAdoptionRequest,
  ApplyWorktreeAdoptionRequest,
  CreateReplayPlanRequest,
  CreateRunComparisonRequest,
  CreateRunExperimentRequest,
  DeleteRunExperimentRequest,
  DiscardRunAdoptionRequest,
  ExecuteReplayPlanRequest,
  FinalizeRunExperimentCandidateRequest,
  GetReplayBoundariesRequest,
  GetReplayPlanRequest,
  GetRunAdoptionPreviewRequest,
  GetRunComparisonRequest,
  GetRunExperimentCapabilitiesRequest,
  GetRunExperimentRequest,
  GetRunRelationsRequest,
  GetWorktreeAdoptionPreviewRequest,
  RunExperimentPackageExportResult,
  RuntimeRunApprovalDecisionRequest,
  RuntimeSecurityApprovalDecisionRequest,
  UpdateRunExperimentRequest,
} from "../../../../shared/api/runExperiment";
import { RemoteProtocolError } from "../../../../shared/api/remoteSshProtocol";
import { requireAuthContext } from "../../../../shared/main/auth";
import { assertExperimentReleaseEnabled, readExperimentReleaseGate } from "../../../../shared/main/experimentReleaseGate";
import { connectRuntimeClientForWorkspace, withRuntimeClientForWorkspace } from "../../../../shared/main/runtimeClient";

let releaseGatePromise: ReturnType<typeof readExperimentReleaseGate> | undefined;

function getReleaseGate() {
  releaseGatePromise ??= readExperimentReleaseGate([
    join(app.getAppPath(), "resources", "release", "experiment-release-gate.json"),
    join(process.resourcesPath, "app.asar.unpacked", "resources", "release", "experiment-release-gate.json"),
  ]);
  return releaseGatePromise;
}

async function requireReleaseGate(): Promise<void> {
  assertExperimentReleaseEnabled(await getReleaseGate());
}

function approvalRequired(error: unknown) {
  if (error instanceof RemoteProtocolError && error.code === "approval_required" && error.detail.approvalId) {
    return { approval_required: true as const, approval_id: error.detail.approvalId, code: "approval_required" as const, message: error.message };
  }
  throw error;
}

async function chooseJsonExport(suggestedName: string, title: string) {
  return dialog.showSaveDialog({
    title,
    defaultPath: join(app.getPath("downloads"), suggestedName),
    buttonLabel: "Export",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.opendrsai-${process.pid}-${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Registers Runtime-backed traceability, experimentation, replay, and adoption APIs. */
export function registerMacosRunInspectionIpc(ipcMain: Pick<IpcMain, "handle">): void {
  ipcMain.handle("desktop:run-list", async (_event, request: SessionRunsReadRequest) => {
    const auth = await requireAuthContext();
    return withRuntimeClientForWorkspace(request.workspacePath, request.workspaceId, async ({ client }) =>
      sanitizeSessionRunList(await client.listSessionRuns(request.sessionId, request.cursor, request.limit, request.status, auth)));
  });
  ipcMain.handle("desktop:run-inspection", async (_event, request: RunInspectionOpenRequest) => {
    const auth = await requireAuthContext();
    return withRuntimeClientForWorkspace(request.workspacePath, request.workspaceId, async ({ client }) =>
      sanitizeRunInspection(await client.getRunInspection(request.runId, request.timelineCursor, request.limit, request.itemType, request.status, auth)));
  });
  ipcMain.handle("desktop:run-item-locator", async (_event, request: RunItemLocatorRequest) => {
    const auth = await requireAuthContext();
    return withRuntimeClientForWorkspace(request.workspacePath, request.workspaceId, ({ client }) =>
      client.locateRunItem(request.runId, request.itemId, request.itemType, request.status, auth));
  });
  ipcMain.handle("desktop:run-manifest", async (_event, request: RunManifestReadRequest) => {
    const auth = await requireAuthContext();
    return withRuntimeClientForWorkspace(request.workspacePath, request.workspaceId, async ({ client }) =>
      sanitizeRunReproductionManifest(await client.getRunReproductionManifest(request.runId, auth)));
  });
  ipcMain.handle("desktop:run-manifest-export", async (_event, request: RunManifestReadRequest): Promise<RunManifestExportResult> => {
    const auth = await requireAuthContext();
    const manifest = await withRuntimeClientForWorkspace(request.workspacePath, request.workspaceId, async ({ client }) =>
      sanitizeRunReproductionManifest(await client.exportRunReproductionManifest(request.runId, auth)));
    const suggestedName = `opendrsai-run-${request.runId}-manifest.json`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const selected = await chooseJsonExport(suggestedName, "Export redacted Run manifest");
    if (selected.canceled || !selected.filePath) return { manifest, savedPath: null, cancelled: true };
    await writeJsonAtomically(selected.filePath, manifest);
    return { manifest, savedPath: selected.filePath, cancelled: false };
  });
  ipcMain.handle("desktop:experiment-release-gate", () => getReleaseGate());
  ipcMain.handle("desktop:run-experiment-create", async (_event, request: CreateRunExperimentRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.createRunExperiment(request.runId, { idempotencyKey: request.idempotencyKey, title: request.title, forkedFromItemId: request.forkedFromItemId, replayMode: request.replayMode }, await requireAuthContext());
  });
  ipcMain.handle("desktop:run-experiment-capabilities", async (_event, request: GetRunExperimentCapabilitiesRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunExperimentCapabilities(request.runId, await requireAuthContext());
  });
  ipcMain.handle("desktop:run-experiment-candidate-snapshot", async (_event, request: FinalizeRunExperimentCandidateRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    try { return await resolved.client.finalizeRunExperimentCandidate(request.experimentId, request.approvalId, await requireAuthContext()); }
    catch (error) { return approvalRequired(error); }
  });
  ipcMain.handle("desktop:run-experiment-get", async (_event, request: GetRunExperimentRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunExperiment(request.experimentId, await requireAuthContext());
  });
  ipcMain.handle("desktop:run-experiment-export", async (_event, request: GetRunExperimentRequest): Promise<RunExperimentPackageExportResult> => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const packageValue = await resolved.client.exportRunExperimentPackage(request.experimentId, await requireAuthContext());
    const suggestedName = `opendrsai-experiment-${request.experimentId}-package.json`.replace(/[^a-zA-Z0-9._-]/g, "-");
    const selected = await chooseJsonExport(suggestedName, "Export redacted experiment package");
    if (selected.canceled || !selected.filePath) return { package: packageValue, savedPath: null, cancelled: true };
    await writeJsonAtomically(selected.filePath, packageValue);
    return { package: packageValue, savedPath: selected.filePath, cancelled: false };
  });
  ipcMain.handle("desktop:run-experiment-update", async (_event, request: UpdateRunExperimentRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.updateRunExperiment(request.experimentId, { expectedVersion: request.expectedVersion, idempotencyKey: request.idempotencyKey, patch: request.patch }, await requireAuthContext());
  });
  ipcMain.handle("desktop:run-experiment-delete", async (_event, request: DeleteRunExperimentRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    await resolved.client.deleteRunExperiment(request.experimentId, await requireAuthContext());
    return true;
  });
  ipcMain.handle("desktop:replay-plan-create", async (_event, request: CreateReplayPlanRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    const capabilities = await resolved.client.getCapabilities();
    return resolved.client.createReplayPlan(request.experimentId, { expectedDraftVersion: request.expectedDraftVersion, expiresInSeconds: request.expiresInSeconds, availability: { ...(request.availability ?? {}), worktree: capabilities.capabilities.includes("worktree"), runtime_location: resolved.client.location } }, await requireAuthContext());
  });
  ipcMain.handle("desktop:replay-plan-get", async (_event, request: GetReplayPlanRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getReplayPlan(request.replayPlanId, await requireAuthContext());
  });
  ipcMain.handle("desktop:replay-boundaries-get", async (_event, request: GetReplayBoundariesRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getReplayBoundaries(request.runId, await requireAuthContext());
  });
  ipcMain.handle("desktop:run-relations-get", async (_event, request: GetRunRelationsRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunRelations(request.runId, await requireAuthContext());
  });
  ipcMain.handle("desktop:replay-plan-execute", async (_event, request: ExecuteReplayPlanRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    try { return await resolved.client.executeReplayPlan(request.replayPlanId, { draftVersion: request.draftVersion, planDigest: request.planDigest, baseManifestDigest: request.baseManifestDigest, idempotencyKey: request.idempotencyKey, approvalId: request.approvalId, isolatedWorktreeId: request.isolatedWorktreeId, runtimeApprovalId: request.runtimeApprovalId }, await requireAuthContext()); }
    catch (error) { return approvalRequired(error); }
  });
  ipcMain.handle("desktop:run-comparison-create", async (_event, request: CreateRunComparisonRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.createRunComparison(request.baselineRunId, request.candidateRunId, await requireAuthContext());
  });
  ipcMain.handle("desktop:run-comparison-get", async (_event, request: GetRunComparisonRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunComparison(request.comparisonId, await requireAuthContext());
  });
  ipcMain.handle("desktop:worktree-adoption-preview", async (_event, request: GetWorktreeAdoptionPreviewRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getWorktreeAdoptionPreview(request.sourceWorkspaceId, request.worktreeId, await requireAuthContext());
  });
  ipcMain.handle("desktop:worktree-adoption-apply", async (_event, request: ApplyWorktreeAdoptionRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.applyWorktreeAdoption(request.sourceWorkspaceId, request.worktreeId, { previewDigest: request.previewDigest, selectedPaths: request.selectedPaths, approvalId: request.approvalId }, await requireAuthContext());
  });
  ipcMain.handle("desktop:run-adoption-preview", async (_event, request: GetRunAdoptionPreviewRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.getRunAdoptionPreview(request.comparisonId, await requireAuthContext());
  });
  ipcMain.handle("desktop:run-adoption-apply", async (_event, request: ApplyRunAdoptionRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    try { return await resolved.client.applyRunAdoption(request.adoptionId, request.selectedPaths, request.approvalId, await requireAuthContext()); }
    catch (error) { return approvalRequired(error); }
  });
  ipcMain.handle("desktop:run-adoption-discard", async (_event, request: DiscardRunAdoptionRequest) => {
    await requireReleaseGate();
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    try { return await resolved.client.discardRunAdoption(request.adoptionId, request.cleanup !== false, request.approvalId, await requireAuthContext()); }
    catch (error) { return approvalRequired(error); }
  });
  ipcMain.handle("desktop:runtime-security-approval-decision", async (_event, request: RuntimeSecurityApprovalDecisionRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.decideSecurityApproval(request.approvalId, request.decision, await requireAuthContext());
  });
  ipcMain.handle("desktop:runtime-run-approval-decision", async (_event, request: RuntimeRunApprovalDecisionRequest) => {
    const resolved = await connectRuntimeClientForWorkspace(request.workspacePath, request.workspaceId);
    return resolved.client.decideRunApproval(request.approvalId, request.decision, await requireAuthContext());
  });
}
