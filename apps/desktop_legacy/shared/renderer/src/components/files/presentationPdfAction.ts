import type { WorkspaceFilePreview } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export function isPresentationPdfPreview(preview: WorkspaceFilePreview | null): boolean {
  if (!preview || preview.kind !== "pdf") return false;
  const content = preview.content ?? "";
  return content.includes("PDF type: presentation_pdf");
}

export function buildManagerPresentationTask(language: AppLanguage): string {
  if (language === "zh") {
    return [
      "请分析已附加的演示型 PDF，生成一份给非专业管理者看的中文 PPTX。",
      "要求：8–12 页；提炼结论、关键数字、影响和建议，不照抄原文；所有内容必须是可编辑的原生文本、形状、表格或图表；每个事实型页面标注对应的原 PDF 页码；为每一页写可直接演讲的讲稿；明确标记来源中尚未确认的目标或结论；不得把原 PDF 整页截图作为新版幻灯片。",
      "完成后请给出 PPTX 文件，并说明页数、讲稿覆盖率、来源页码覆盖率以及自动验收结果。",
    ].join("\n\n");
  }

  return [
    "Analyze the attached presentation-style PDF and create an English PPTX for non-expert managers.",
    "Requirements: 8–12 slides; synthesize conclusions, key numbers, impact, and recommendations instead of copying the source; keep all content editable as native text, shapes, tables, or charts; cite the original PDF page on every factual slide; add presentation-ready speaker notes to every slide; explicitly flag targets or conclusions that remain unconfirmed in the source; never use full-page screenshots of the source PDF as redesigned slides.",
    "Return the PPTX and report its slide count, speaker-note coverage, source-page coverage, and automated acceptance results.",
  ].join("\n\n");
}
