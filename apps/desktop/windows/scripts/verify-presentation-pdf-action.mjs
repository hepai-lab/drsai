import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const action = read("../shared/renderer/src/components/files/presentationPdfAction.ts");
const panel = read("../shared/renderer/src/components/files/FilesContextPanel.tsx");
const app = read("../shared/renderer/src/App.tsx");
const css = read("../shared/renderer/src/styles.css");
const sharedApi = read("../shared/api/desktopApi.ts");
const preload = read("../shared/main/preload.ts");
const main = read("src/main/index.ts");
const generator = read("../shared/main/managerPresentation.ts");
const parser = read("../shared/main/presentationPdf.ts");
const taskStore = read("../shared/main/managerPresentationTasks.ts");
const backgroundTasks = read("src/main/backgroundTasks.ts");
const e2eSmoke = read("src/main/e2eSmoke.ts");
const skillSquare = read("../shared/renderer/src/components/SkillSquareView.tsx");

const checks = [
  ["presentation PDFs require the structured backend marker", action.includes('content.includes("PDF type: presentation_pdf")')],
  ["presentation action does not depend on a long preview retaining the blueprint tail", !action.includes('content.includes("Manager PPTX blueprint:")')],
  ["Chinese contract targets non-expert managers", action.includes("给非专业管理者看的中文 PPTX")],
  ["contract requires an 8–12 slide editable deck", action.includes("8–12 页") && action.includes("可编辑的原生文本")],
  ["contract requires source pages and speaker notes", action.includes("原 PDF 页码") && action.includes("为每一页写可直接演讲的讲稿")],
  ["contract prohibits full-page PDF screenshots", action.includes("不得把原 PDF 整页截图")],
  ["contract preserves uncertainty", action.includes("尚未确认")],
  ["panel exposes the user-facing manager deck action", panel.includes("生成管理者版 PPT") && panel.includes("Create manager PPT")],
  ["action attaches the selected PDF before preparing the task", panel.includes("commitAttachments([createFileAttachment(selectedNode, preview)])")],
  ["untrusted workspaces can cancel before task preparation", panel.includes("!commitAttachments") && panel.includes("return;")],
  ["app writes the complete task into the composer", app.includes("onPrepareTask={(task)") && app.includes("chat.setInput(task)")],
  ["action has visible product styling", css.includes(".presentation-pdf-action")],
  ["generated result exposes source-page review", panel.includes("核对原始依据") && panel.includes("data-source-page={page}")],
  ["every source page uses the same bounded open action", panel.includes("desktopApi.openPdfPage") && panel.includes("managerPresentationResult?.sourcePath")],
  ["PDF page opening is part of the typed desktop API", sharedApi.includes("openPdfPage(request: PdfPageOpenRequest)")],
  ["preload exposes only the typed PDF page IPC", preload.includes('ipcRenderer.invoke("desktop:open-pdf-page", request)')],
  ["main validates PDF paths and page numbers before opening", main.includes("openPdfSourcePage") && main.includes('extname(rawPath).toLowerCase() !== ".pdf"') && main.includes("Number.isInteger(page)")],
  ["validated source page opens through the system PDF handler", main.includes("shell.openExternal(viewerUrl.href)") && main.includes("!isE2eSmokeProcess")],
  ["source review has visible keyboard focus styling", css.includes(".presentation-source-page-links button:focus-visible")],
  ["manager generation exposes a typed cancel API", sharedApi.includes("cancelManagerPresentation(") && preload.includes('desktop:manager-presentation-cancel')],
  ["cancel is scoped to the trusted current renderer task", main.includes("managerPresentationRuns") && main.includes("canControlManagerPresentation(event, run)")],
  ["PDF parsing accepts AbortSignal instead of blocking the main process", parser.includes("export async function extractPresentationPdf(") && parser.includes("signal,") && generator.includes("await extractPresentationPdf(sourcePath, operationController.signal)")],
  ["cancelled generation removes incomplete PPTX and provenance files", generator.includes("ManagerPresentationCancelledError") && generator.includes("unlinkSync(path)")],
  ["cancelled and failed tasks expose the same retry entry", panel.includes('["failed", "cancelled"]') && panel.includes("重试生成")],
  ["manager generation exposes typed pause and resume APIs", sharedApi.includes("pauseManagerPresentation(") && sharedApi.includes("resumeManagerPresentation(") && preload.includes("desktop:manager-presentation-pause") && preload.includes("desktop:manager-presentation-resume")],
  ["pausing interrupts active parsing and waits for explicit resume", main.includes("activeOperationController?.abort()") && main.includes("waitUntilManagerPresentationResumed") && generator.includes('await honorPause("analyzing")')],
  ["pause and cancellation preserve the active work stage end to end", sharedApi.includes("activeStage?: ManagerPresentationWorkStage") && generator.includes("activeStage: currentWorkStage") && panel.includes("data-active-stage={managerPresentationProgress.activeStage}") && backgroundTasks.includes("event.activeStage")],
  ["packaged acceptance covers pause-resume across reading computing and output", e2eSmoke.includes("parsingPausedAtReadingStage") && e2eSmoke.includes("planningPausedAtComputingStage") && e2eSmoke.includes("generatingPausedAtOutputStage")],
  ["packaged acceptance covers cancellation record cleanup and retry", e2eSmoke.includes("cancelledInUnifiedBackgroundQueue") && e2eSmoke.includes("cancelledNoPartialFiles") && e2eSmoke.includes("cancel-planning-retry") && e2eSmoke.includes("cancel-generating-retry")],
  ["running tasks expose a typed requirement update API", sharedApi.includes("ManagerPresentationRequirementUpdateRequest") && sharedApi.includes("updateManagerPresentationRequirement(") && preload.includes("desktop:manager-presentation-requirement-update")],
  ["requirement updates declare their scope and reject late silent changes", main.includes('scope: "current_unfinished_stages"') && main.includes('scope: "regenerate_required"') && main.includes("需要重新执行规划和生成阶段")],
  ["live requirements are re-read before output side effects", generator.includes("getRequirements?: () => string[]") && generator.includes("latestRequirements") && generator.indexOf("latestRequirements") < generator.indexOf("writeArtifact(outputPath")],
  ["applied requirements change the actual deck and provenance", generator.includes("本次补充重点") && generator.includes("优先决策") && generator.includes("appliedRequirements")],
  ["requirement scope and outcome are visible to the user", panel.includes("manager-presentation-requirement-input") && panel.includes("应用到当前任务") && panel.includes("manager-presentation-applied-requirements")],
  ["packaged acceptance checks PPTX content provenance and late-update recovery", e2eSmoke.includes("requirementPresentInGeneratedPptx") && e2eSmoke.includes("requirementPersistedInManifest") && e2eSmoke.includes("lateRequirementRequiresRegeneration")],
  ["paused tasks expose resume and remain cancellable", panel.includes("resume-manager-presentation") && panel.includes("继续生成") && panel.includes("cancel-manager-presentation")],
  ["unfinished presentation tasks are persisted atomically", taskStore.includes("manager-presentation-tasks.json") && taskStore.includes("renameSync(temporaryPath, tasksPath)") && main.includes("recordManagerPresentationProgress")],
  ["recovery cleans only bounded PPTX partial artifacts", taskStore.includes("cleanupPartialArtifacts") && taskStore.includes("pathWithinWorkspace.startsWith") && taskStore.includes('extname(outputPath).toLowerCase() !== ".pptx"')],
  ["the PDF panel exposes an unfinished-task recovery action", sharedApi.includes("getManagerPresentationRecovery(") && preload.includes("desktop:manager-presentation-recovery") && panel.includes("继续未完成任务")],
  ["presentation generation is mirrored into the generic background queue", backgroundTasks.includes("upsertBackgroundTaskForManagerPresentation") && backgroundTasks.includes('kind: "presentation_generation"') && main.includes("upsertBackgroundTaskForManagerPresentation(request, progress)")],
  ["background tasks preserve progress completed steps and pending decisions", sharedApi.includes("completedSteps?: string[]") && sharedApi.includes("pendingDecisions?: string[]") && backgroundTasks.includes("completedPresentationSteps") && skillSquare.includes("Needs you:")],
  ["active work keeps running when the Windows window closes", main.includes('mainWindow.on("close"') && main.includes("event.preventDefault()") && main.includes("hasActiveForegroundIndependentWork()") && main.includes("mainWindow?.hide()")],
  ["destroyed renderers fail closed instead of controlling presentation work", main.includes("function canControlManagerPresentation") && main.includes("event.sender.isDestroyed()")],
];

const failures = checks.filter(([, ok]) => !ok).map(([label]) => label);
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.map(([label]) => label) }, null, 2));
