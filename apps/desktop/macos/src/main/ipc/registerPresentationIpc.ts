import { join } from "node:path";
import { app, BrowserWindow, type IpcMain } from "electron";
import type { ManagerPresentationCancelRequest, ManagerPresentationGenerateRequest, ManagerPresentationPauseRequest, ManagerPresentationProgressEvent, ManagerPresentationRecoveryDecisionRequest, ManagerPresentationRecoveryRequest, ManagerPresentationRequirementUpdateRequest } from "../../../../shared/api";
import { assertAllowedDesktopPath } from "../../../../shared/main/desktopPathPolicy";
import { generateManagerPresentation, ManagerPresentationCancelledError } from "../../../../shared/main/managerPresentation";
import { getManagerPresentationRecovery, recordManagerPresentationProgress, recordManagerPresentationStart, resolveManagerPresentationRecovery } from "../../../../shared/main/managerPresentationTasks";
import type { MacosServiceContainer } from "../serviceContainer";

interface ManagerPresentationRun {
  controller: AbortController; ownerId: number; request: ManagerPresentationGenerateRequest; paused: boolean;
  activeOperationController: AbortController | null; resumeWaiters: Set<() => void>;
  lastProgress: ManagerPresentationProgressEvent | null; requirements: string[];
}

const runs = new Map<string, ManagerPresentationRun>();
const injectedPackagedFailures = new Set<string>();
const managerPresentationTemplatePath = () => app.isPackaged
  ? join(process.resourcesPath, "presentation", "manager-deck-template.pptx")
  : join(app.getAppPath(), "..", "windows", "resources", "presentation", "manager-deck-template.pptx");
const sanitizeRequirements = (values: string[] | undefined) => !Array.isArray(values) ? [] : values.map((value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 240) : "").filter((value, index, all) => Boolean(value) && all.indexOf(value) === index).slice(0, 5);
const publishProgress = (progress: ManagerPresentationProgressEvent) => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send("desktop:manager-presentation-progress", progress); };
const resume = (run: ManagerPresentationRun) => { run.paused = false; for (const waiter of run.resumeWaiters) waiter(); run.resumeWaiters.clear(); };

export function registerMacosPresentationIpc(ipcMain: Pick<IpcMain, "handle">, services: Pick<MacosServiceContainer, "workspace">): void {
  ipcMain.handle("desktop:manager-presentation-generate", async (event, request: ManagerPresentationGenerateRequest) => {
    await services.workspace.assertPath(request?.workspacePath); assertAllowedDesktopPath(request?.sourcePath, [request.workspacePath]);
    const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";
    if (!requestId || requestId.length > 128) throw new Error("A valid presentation request id is required.");
    if (runs.has(requestId)) throw new Error("This presentation task is already running.");
    request.requirements = sanitizeRequirements(request.requirements);
    const run: ManagerPresentationRun = { controller: new AbortController(), ownerId: event.sender.id, request, paused: false, activeOperationController: null, resumeWaiters: new Set(), lastProgress: null, requirements: [...request.requirements] };
    const recovery = getManagerPresentationRecovery({ workspacePath: request.workspacePath, sourcePath: request.sourcePath }); recordManagerPresentationStart(request); runs.set(requestId, run);
    const packagedAcceptance = Boolean(process.env.OPENDRSAI_MACOS_PACKAGED_SMOKE_FILE?.trim());
    const injectFailure = packagedAcceptance && requestId === "packaged-l5-presentation-failure" && !injectedPackagedFailures.has(requestId);
    if (injectFailure) injectedPackagedFailures.add(requestId);
    try {
      return await generateManagerPresentation(request, (progress) => { run.lastProgress = progress; recordManagerPresentationProgress(request, progress); publishProgress(progress); }, { templatePath: managerPresentationTemplatePath(), signal: run.controller.signal, phaseDelayMs: packagedAcceptance ? 500 : 0, failAtPhase: injectFailure ? "planning" : undefined, failureMessage: injectFailure ? "Packaged presentation retry fixture" : undefined, isPaused: () => run.paused, waitUntilResumed: () => run.paused ? new Promise<void>((resolveWait) => run.resumeWaiters.add(resolveWait)) : Promise.resolve(), setActiveOperationController: (controller) => { run.activeOperationController = controller; }, getRequirements: () => [...run.requirements], initialStageArtifacts: recovery?.requestId === requestId ? recovery.stageArtifacts : [] });
    } catch (error) {
      if (!(error instanceof ManagerPresentationCancelledError)) { const failed: ManagerPresentationProgressEvent = { requestId, phase: "failed", activeStage: run.lastProgress?.activeStage, progress: 100, message: error instanceof Error ? error.message : String(error) }; recordManagerPresentationProgress(request, failed); publishProgress(failed); }
      throw error;
    } finally { runs.delete(requestId); }
  });
  ipcMain.handle("desktop:manager-presentation-cancel", (event, request: ManagerPresentationCancelRequest) => { const requestId = request?.requestId?.trim() || ""; const run = runs.get(requestId); if (!run || run.ownerId !== event.sender.id) return { requestId, accepted: false }; run.controller.abort(); resume(run); return { requestId, accepted: true }; });
  ipcMain.handle("desktop:manager-presentation-pause", (event, request: ManagerPresentationPauseRequest) => { const requestId = request?.requestId?.trim() || ""; const run = runs.get(requestId); if (!run || run.ownerId !== event.sender.id || run.paused) return { requestId, accepted: false }; run.paused = true; run.activeOperationController?.abort(); return { requestId, accepted: true }; });
  ipcMain.handle("desktop:manager-presentation-resume", (event, request: ManagerPresentationPauseRequest) => { const requestId = request?.requestId?.trim() || ""; const run = runs.get(requestId); if (!run || run.ownerId !== event.sender.id || !run.paused) return { requestId, accepted: false }; resume(run); return { requestId, accepted: true }; });
  ipcMain.handle("desktop:manager-presentation-requirement-update", (event, update: ManagerPresentationRequirementUpdateRequest) => { const requestId = update?.requestId?.trim() || ""; const run = runs.get(requestId); const activeStage = run?.lastProgress?.activeStage; const text = typeof update?.text === "string" ? update.text.trim().replace(/\s+/g, " ").slice(0, 240) : ""; if (!run || run.ownerId !== event.sender.id || !text || !activeStage || !["analyzing", "planning", "generating"].includes(activeStage)) return { requestId, accepted: false, activeStage, scope: "regenerate_required", requirements: run ? [...run.requirements] : [], message: "The requirement cannot be applied to the active generation stage." }; if (!run.requirements.includes(text)) run.requirements = [...run.requirements, text].slice(-5); run.request.requirements = [...run.requirements]; if (run.lastProgress) recordManagerPresentationProgress(run.request, run.lastProgress); return { requestId, accepted: true, activeStage, scope: "current_unfinished_stages", requirements: [...run.requirements], message: "The requirement will be applied to unfinished stages." }; });
  ipcMain.handle("desktop:manager-presentation-recovery", async (_event, request: ManagerPresentationRecoveryRequest) => { await services.workspace.assertPath(request?.workspacePath); assertAllowedDesktopPath(request?.sourcePath, [request.workspacePath]); const active = [...runs.values()].find((run) => run.request.workspacePath === request.workspacePath && run.request.sourcePath === request.sourcePath); return active?.lastProgress ? { ...active.lastProgress, workspacePath: request.workspacePath, sourcePath: request.sourcePath, updatedAt: new Date().toISOString() } : getManagerPresentationRecovery(request); });
  ipcMain.handle("desktop:manager-presentation-recovery-resolve", async (_event, request: ManagerPresentationRecoveryDecisionRequest) => { await services.workspace.assertPath(request?.workspacePath); assertAllowedDesktopPath(request?.sourcePath, [request.workspacePath]); if (!request || !["restart", "abandon"].includes(request.decision)) throw new Error("Presentation recovery decision is invalid."); return resolveManagerPresentationRecovery(request); });
}
