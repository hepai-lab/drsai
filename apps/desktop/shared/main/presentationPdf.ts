import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { DRSAI_PYTHON, getEnhancedPath } from "./paths";

const PDF_PARSE_TIMEOUT_MS = 30_000;
const PDF_PARSE_MAX_BUFFER = 512_000;

export interface PresentationPdfPage {
  page: number;
  role: "cover" | "agenda" | "section" | "content" | "summary" | "questions";
  width: number;
  height: number;
  text: string;
}

export interface PresentationPdfResult {
  schemaVersion: 1;
  type: "presentation_pdf" | "document_pdf";
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  landscapeRatio: number;
  medianTextChars: number;
  metadata: Record<string, string>;
  pages: PresentationPdfPage[];
  analysis?: {
    title: string;
    agenda: Array<{ text: string; page: number }>;
    storySections: Array<{ title: string; page: number }>;
    summaryPoints: Array<{ text: string; page: number }>;
    numericHighlights: Array<{ text: string; page: number }>;
    sourcePageCount: number;
    managerDeckBlueprint?: {
      schemaVersion: 1;
      audience: "non_expert_managers";
      language: "zh-CN";
      format: "pptx";
      slideCount: number;
      slides: Array<{
        slide: number;
        role: string;
        title: string;
        sourcePages: number[];
        evidence: string[];
        speakerNotesRequired: boolean;
      }>;
      minimumSpeakerNotesCoverage: number;
      wholePageScreenshotReuseAllowed: false;
      sourceMappingRequired: true;
    };
  };
  safety: {
    javascriptExecuted: false;
    linksOpened: false;
    attachmentsExtracted: false;
    networkAccessed: false;
  };
}

function pythonExecutable(): string {
  const override = process.env.OPENDRSAI_PDF_PYTHON?.trim();
  return override || DRSAI_PYTHON;
}

function commandArgs(filePath: string, format: "json" | "context", maxChars?: number): string[] {
  const script = process.env.OPENDRSAI_PDF_SCRIPT?.trim();
  return [
    ...(script ? [script] : ["-m", "drsai.content.pdf.presentation"]),
    filePath,
    "--format",
    format,
    ...(maxChars ? ["--max-chars", String(maxChars)] : []),
  ];
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: getEnhancedPath(),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

export function canExtractPresentationPdf(): boolean {
  const executable = pythonExecutable();
  return existsSync(executable) || executable === "python" || executable === "python3";
}

export function extractPresentationPdfSync(filePath: string): PresentationPdfResult | null {
  if (!canExtractPresentationPdf()) return null;
  try {
    const output = execFileSync(pythonExecutable(), commandArgs(filePath, "json"), {
      encoding: "utf8",
      env: commandEnvironment(),
      timeout: PDF_PARSE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: PDF_PARSE_MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(output) as PresentationPdfResult;
  } catch {
    return null;
  }
}

export async function extractPresentationPdf(
  filePath: string,
  signal?: AbortSignal,
): Promise<PresentationPdfResult | null> {
  if (!canExtractPresentationPdf()) return null;
  if (signal?.aborted) throw new DOMException("Presentation PDF parsing was cancelled.", "AbortError");
  return new Promise((resolve, reject) => {
    execFile(
      pythonExecutable(),
      commandArgs(filePath, "json"),
      {
        encoding: "utf8",
        env: commandEnvironment(),
        timeout: PDF_PARSE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: PDF_PARSE_MAX_BUFFER,
        signal,
      },
      (error, stdout) => {
        if (signal?.aborted || error?.name === "AbortError" || (error as NodeJS.ErrnoException | null)?.code === "ABORT_ERR") {
          reject(error || new DOMException("Presentation PDF parsing was cancelled.", "AbortError"));
          return;
        }
        if (error) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(stdout) as PresentationPdfResult);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

export async function extractPresentationPdfContext(
  filePath: string,
  maxChars: number,
): Promise<string> {
  if (!canExtractPresentationPdf()) return "";
  return new Promise((resolve) => {
    execFile(
      pythonExecutable(),
      commandArgs(filePath, "context", maxChars),
      {
        encoding: "utf8",
        env: commandEnvironment(),
        timeout: PDF_PARSE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: PDF_PARSE_MAX_BUFFER,
      },
      (error, stdout) => resolve(error ? "" : stdout.trim()),
    );
  });
}

export function formatPresentationPdfSummary(result: PresentationPdfResult, maxChars: number): string {
  const title = result.metadata.title || result.pages[0]?.text.split("\n")[0] || "(not set)";
  const header = [
    `PDF type: ${result.type}`,
    `Pages: ${result.pageCount}`,
    `Title: ${title}`,
    `Creator: ${result.metadata.creator || "(not set)"}`,
    "Safety: text and page geometry only; PDF scripts, links, forms, and attachments were not executed or opened.",
  ];
  const analysis = result.analysis;
  const outline = analysis
    ? [
        "Presentation analysis:",
        analysis.agenda.length > 0
          ? `Agenda: ${analysis.agenda.map((item) => `${item.text} (p.${item.page})`).join("; ")}`
          : "",
        analysis.storySections.length > 0
          ? `Story sections: ${analysis.storySections.map((item) => `${item.title} (p.${item.page})`).join("; ")}`
          : "",
        analysis.summaryPoints.length > 0
          ? `Summary: ${analysis.summaryPoints.map((item) => `${item.text} (p.${item.page})`).join(" | ")}`
          : "",
        analysis.numericHighlights.length > 0
          ? `Numeric highlights: ${analysis.numericHighlights.map((item) => `${item.text} (p.${item.page})`).join(" | ")}`
          : "",
        analysis.managerDeckBlueprint
          ? `Manager PPTX blueprint: ${analysis.managerDeckBlueprint.slideCount} slides; ${analysis.managerDeckBlueprint.slides.map((slide) => `${slide.slide}. ${slide.title} [${slide.role}] (sources: ${slide.sourcePages.map((page) => `p.${page}`).join(", ")})`).join(" | ")}`
          : "",
      ].filter(Boolean)
    : [];
  const pages = result.pages
    .filter((page) => page.text)
    .map((page) => `[Page ${page.page} | ${page.role}]\n${page.text}`);
  return [...header, ...outline, ...pages].join("\n").slice(0, maxChars);
}
