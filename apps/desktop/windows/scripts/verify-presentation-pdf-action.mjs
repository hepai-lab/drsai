import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const action = read("src/renderer/src/components/files/presentationPdfAction.ts");
const panel = read("src/renderer/src/components/files/FilesContextPanel.tsx");
const app = read("src/renderer/src/App.tsx");
const css = read("src/renderer/src/styles.css");
const sharedApi = read("src/shared/desktopApi.ts");
const preload = read("src/preload/index.ts");
const main = read("src/main/index.ts");
const generator = read("src/main/managerPresentation.ts");
const parser = read("src/main/presentationPdf.ts");

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
  ["every source page uses the same bounded open action", panel.includes("desktopApi.openPdfPage") && panel.includes("managerPresentationResult.sourcePath")],
  ["PDF page opening is part of the typed desktop API", sharedApi.includes("openPdfPage(request: PdfPageOpenRequest)")],
  ["preload exposes only the typed PDF page IPC", preload.includes('ipcRenderer.invoke("desktop:open-pdf-page", request)')],
  ["main validates PDF paths and page numbers before opening", main.includes("openPdfSourcePage") && main.includes('extname(rawPath).toLowerCase() !== ".pdf"') && main.includes("Number.isInteger(page)")],
  ["validated source page opens through the system PDF handler", main.includes("shell.openExternal(viewerUrl.href)") && main.includes("!isE2eSmokeProcess")],
  ["source review has visible keyboard focus styling", css.includes(".presentation-source-page-links button:focus-visible")],
  ["manager generation exposes a typed cancel API", sharedApi.includes("cancelManagerPresentation(") && preload.includes('desktop:manager-presentation-cancel')],
  ["cancel is scoped to the originating renderer task", main.includes("managerPresentationRuns") && main.includes("run.webContentsId !== event.sender.id")],
  ["PDF parsing accepts AbortSignal instead of blocking the main process", parser.includes("export async function extractPresentationPdf(") && parser.includes("signal,") && generator.includes("await extractPresentationPdf(sourcePath, operationController.signal)")],
  ["cancelled generation removes incomplete PPTX and provenance files", generator.includes("ManagerPresentationCancelledError") && generator.includes("unlinkSync(path)")],
  ["cancelled and failed tasks expose the same retry entry", panel.includes('["failed", "cancelled"]') && panel.includes("重试生成")],
  ["manager generation exposes typed pause and resume APIs", sharedApi.includes("pauseManagerPresentation(") && sharedApi.includes("resumeManagerPresentation(") && preload.includes("desktop:manager-presentation-pause") && preload.includes("desktop:manager-presentation-resume")],
  ["pausing interrupts active parsing and waits for explicit resume", main.includes("activeOperationController?.abort()") && main.includes("waitUntilManagerPresentationResumed") && generator.includes("await honorPause()")],
  ["paused tasks expose resume and remain cancellable", panel.includes("resume-manager-presentation") && panel.includes("继续生成") && panel.includes("cancel-manager-presentation")],
];

const failures = checks.filter(([, ok]) => !ok).map(([label]) => label);
if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checks: checks.map(([label]) => label) }, null, 2));
