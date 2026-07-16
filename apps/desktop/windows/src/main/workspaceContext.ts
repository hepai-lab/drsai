import { execFile } from "child_process";
import { createReadStream, existsSync } from "fs";
import { open, readdir, readFile, realpath, stat } from "fs/promises";
import { createHash } from "crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { inflateRawSync } from "zlib";
import type {
  MaterialConsistencyAnalysisRequest,
  MaterialConsistencyAnalysisResult,
  MaterialConsistencyFinding,
  MaterialConsistencyFindingKind,
  MaterialConsistencySource,
  MaterialQueryCitation,
  MaterialQueryKind,
  MaterialQueryRequest,
  MaterialQueryResult,
  MaterialRole,
  MaterialRoleAnalysisRequest,
  MaterialRoleAnalysisResult,
  MaterialRoleItem,
  WorkspaceContextOverview,
  WorkspaceFileGitStatus,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceFilePreviewRequest,
  WorkspaceFileTreeRequest,
  WorkspaceFileTreeResult,
  WorkspaceFolderSummaryFile,
  WorkspaceFolderSummaryRequest,
  WorkspaceFolderSummaryResult,
  WorkspaceGitFileAtRefRequest,
  WorkspaceGitFileAtRefResult,
  WorkspaceGitDiffRequest,
  WorkspaceGitDiffResult,
  WorkspaceGitStatus,
  WorkspaceHunkActionRequest,
  WorkspaceHunkActionResult,
  WorkspaceInstructionSummary,
  WorkspacePreviewKind,
  WorkspaceRevertFileRequest,
  WorkspaceRevertFileResult,
  WorkspaceStageFileRequest,
  WorkspaceStageFileResult,
} from "../shared/desktopApi";
import {
  extractPresentationPdf,
  extractPresentationPdfContext,
  formatPresentationPdfSummary,
  type PresentationPdfResult,
} from "./presentationPdf";

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_PREVIEW_BYTES = 120_000;
const DEFAULT_DIFF_CHARS = 80_000;
const DEFAULT_GIT_REF_FILE_BYTES = 120_000;
const DEFAULT_FOLDER_SUMMARY_DEPTH = 3;
const DEFAULT_FOLDER_SUMMARY_ENTRIES = 240;
const DEFAULT_FOLDER_SUMMARY_FILES = 16;
const DEFAULT_FOLDER_SUMMARY_CHARS = 12_000;
const MAX_FOLDER_SUMMARY_FILE_BYTES = 24_000;
const MAX_INSTRUCTION_CHARS = 12_000;
const MAX_IMAGE_DATA_URL_BYTES = 1_500_000;
const NOISY_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);

const TEXT_EXTENSIONS = new Set([
  ".bat",
  ".cmd",
  ".conf",
  ".css",
  ".csv",
  ".env",
  ".html",
  ".ini",
  ".js",
  ".jsx",
  ".log",
  ".md",
  ".mjs",
  ".ps1",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const CONFIG_EXTENSIONS = new Set([
  ".conf",
  ".config",
  ".env",
  ".ini",
  ".properties",
  ".toml",
  ".yaml",
  ".yml",
]);

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);

const IMAGE_MIME: Record<string, string> = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const MEDIA_MIME: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

const OFFICE_EXTENSIONS = new Set([".docx", ".pptx", ".xlsx", ".doc", ".ppt", ".xls"]);

export async function getWorkspaceContextOverview(
  rawWorkspacePath: unknown,
  trusted = true,
): Promise<WorkspaceContextOverview> {
  const workspacePath = await resolveWorkspaceRoot(rawWorkspacePath);
  const git = await getGitStatus(workspacePath);
  const changedFiles = await getGitChangedFiles(workspacePath);
  const instructions = await readInstructionChain(workspacePath);
  return {
    workspacePath,
    trusted,
    git: git
      ? {
          ...git,
          changedFiles,
        }
      : undefined,
    instructions,
    stats: {
      instructionCount: instructions.length,
      changedFileCount: changedFiles.length,
    },
  };
}

export async function listWorkspaceFiles(
  rawRequest: unknown,
): Promise<WorkspaceFileTreeResult> {
  const request = validateTreeRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const query = request.query?.trim().toLowerCase() || "";
  const maxDepth = clampInt(request.maxDepth, 1, 8, DEFAULT_MAX_DEPTH);
  const maxEntries = clampInt(request.maxEntries, 50, 2_000, DEFAULT_MAX_ENTRIES);
  const gitStatuses = new Map(
    (await getGitChangedFiles(workspacePath)).map((item) => [normalizeRel(item.path), item.status]),
  );
  let totalEntries = 0;
  let truncated = false;

  async function walk(dirPath: string, depth: number): Promise<WorkspaceFileNode[]> {
    if (totalEntries >= maxEntries) {
      truncated = true;
      return [];
    }
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return [];
    }
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

    const nodes: WorkspaceFileNode[] = [];
    for (const entry of entries) {
      if (totalEntries >= maxEntries) {
        truncated = true;
        break;
      }
      if (entry.name.startsWith(".") && entry.name !== ".claude" && entry.name !== ".env.example") {
        if (entry.name !== ".env" && entry.name !== ".github") continue;
      }
      if (entry.isDirectory() && NOISY_DIRS.has(entry.name)) continue;

      const absolutePath = join(dirPath, entry.name);
      const relativePath = normalizeRel(relative(workspacePath, absolutePath));
      const matchesQuery = !query || relativePath.toLowerCase().includes(query);
      let children: WorkspaceFileNode[] | undefined;
      if (entry.isDirectory() && depth < maxDepth) {
        children = await walk(absolutePath, depth + 1);
      }
      if (!matchesQuery && (!children || children.length === 0)) continue;

      const fileStat = await safeStat(absolutePath);
      const fileSize = toSafeNumber(fileStat?.size);
      totalEntries += 1;
      nodes.push({
        name: entry.name,
        path: absolutePath,
        relativePath,
        type: entry.isDirectory() ? "directory" : "file",
        extension: entry.isFile() ? extname(entry.name).toLowerCase() : undefined,
        size: fileSize,
        modifiedAt: fileStat?.mtime.toISOString(),
        gitStatus: gitStatuses.get(relativePath) ?? "clean",
        previewKind: entry.isFile() ? classifyPreviewKind(entry.name, fileSize ?? 0) : undefined,
        children,
        truncated: entry.isDirectory() && depth >= maxDepth,
      });
    }
    return nodes;
  }

  return {
    workspacePath,
    nodes: await walk(workspacePath, 0),
    totalEntries,
    truncated,
  };
}

export async function summarizeWorkspaceFolder(
  rawRequest: unknown,
): Promise<WorkspaceFolderSummaryResult> {
  const request = validateFolderSummaryRequest(rawRequest);
  const folderPath = await resolveWorkspaceRoot(request.path);
  const maxDepth = clampInt(request.maxDepth, 1, 6, DEFAULT_FOLDER_SUMMARY_DEPTH);
  const maxEntries = clampInt(request.maxEntries, 20, 1_000, DEFAULT_FOLDER_SUMMARY_ENTRIES);
  const maxSampleFiles = clampInt(request.maxSampleFiles, 1, 80, DEFAULT_FOLDER_SUMMARY_FILES);
  const maxChars = clampInt(request.maxChars, 1_000, 40_000, DEFAULT_FOLDER_SUMMARY_CHARS);
  const extensionCounts = new Map<string, number>();
  const sampledFiles: WorkspaceFolderSummaryFile[] = [];
  let totalEntries = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let skippedDirectoryCount = 0;
  let importedFileCount = 0;
  let skippedFileCount = 0;
  let failedFileCount = 0;
  const unsupportedExtensions = new Set<string>();
  let truncated = false;

  async function walk(dirPath: string, depth: number): Promise<void> {
    if (totalEntries >= maxEntries) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

    for (const entry of entries) {
      if (totalEntries >= maxEntries) {
        truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) {
        skippedFileCount += 1;
        continue;
      }
      if (entry.name.startsWith(".") && entry.name !== ".claude" && entry.name !== ".env.example") {
        if (entry.name !== ".env" && entry.name !== ".github") {
          if (entry.isDirectory()) skippedDirectoryCount += 1;
          else skippedFileCount += 1;
          continue;
        }
      }
      if (entry.isDirectory() && NOISY_DIRS.has(entry.name)) {
        skippedDirectoryCount += 1;
        continue;
      }

      const absolutePath = join(dirPath, entry.name);
      totalEntries += 1;
      if (entry.isDirectory()) {
        directoryCount += 1;
        if (depth < maxDepth) {
          await walk(absolutePath, depth + 1);
        } else {
          truncated = true;
        }
        continue;
      }
      if (!entry.isFile()) continue;

      fileCount += 1;
      const fileStat = await safeStat(absolutePath);
      const extension = extname(entry.name).toLowerCase() || "(none)";
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
      if (!fileStat) {
        failedFileCount += 1;
        continue;
      }
      const size = toSafeNumber(fileStat.size) ?? 0;
      const kind = classifyPreviewKind(absolutePath, size);
      if (kind === "unknown") {
        skippedFileCount += 1;
        unsupportedExtensions.add(extension);
        continue;
      }
      if (!(await hasValidImportSignature(absolutePath, extension))) {
        failedFileCount += 1;
        continue;
      }
      importedFileCount += 1;
      if (sampledFiles.length >= maxSampleFiles) continue;
      sampledFiles.push({
        path: absolutePath,
        relativePath: normalizeRel(relative(folderPath, absolutePath)),
        kind,
        size,
        outline: await summarizeFileForFolder(absolutePath, kind, size),
      });
    }
  }

  await walk(folderPath, 0);
  const extensionSummary = [...extensionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([extension, count]) => `${extension}: ${count}`)
    .join(", ");
  const sampledSummary = sampledFiles.map((file, index) => {
    const outline = file.outline?.length
      ? `\n   ${file.outline.slice(0, 4).join("\n   ")}`
      : "";
    return `${index + 1}. ${file.relativePath} (${file.kind}, ${file.size} B)${outline}`;
  });
  const rawSummary = [
    `Folder summary: ${basename(folderPath)}`,
    `Path: ${folderPath}`,
    `Entries scanned: ${totalEntries}${truncated ? " (truncated)" : ""}`,
    `Files: ${fileCount}`,
    `Imported: ${importedFileCount}`,
    `Skipped files: ${skippedFileCount}`,
    `Failed files: ${failedFileCount}`,
    `Folders: ${directoryCount}`,
    skippedDirectoryCount ? `Skipped noisy folders: ${skippedDirectoryCount}` : "",
    unsupportedExtensions.size ? `Unsupported extensions: ${[...unsupportedExtensions].sort().join(", ")}` : "",
    extensionSummary ? `Top file types: ${extensionSummary}` : "",
    sampledSummary.length ? "Sampled files:" : "No readable files sampled.",
    ...sampledSummary,
  ].filter(Boolean).join("\n");
  const summary = rawSummary.length > maxChars
    ? `${rawSummary.slice(0, maxChars)}\n[folder summary truncated]`
    : rawSummary;
  return {
    path: folderPath,
    name: basename(folderPath),
    totalEntries,
    fileCount,
    directoryCount,
    skippedDirectoryCount,
    importedFileCount,
    skippedFileCount,
    failedFileCount,
    unsupportedExtensions: [...unsupportedExtensions].sort(),
    truncated: truncated || rawSummary.length > maxChars,
    estimatedTokens: Math.ceil(summary.length / 4),
    sampledFiles,
    summary,
  };
}

const MATERIAL_DATA_EXTENSIONS = new Set([".csv", ".tsv", ".xls", ".xlsx", ".ods"]);
const MATERIAL_REPORT_EXTENSIONS = new Set([".doc", ".docx", ".odt", ".rtf", ".md", ".txt"]);

export async function analyzeMaterialRoles(
  rawRequest: unknown,
): Promise<MaterialRoleAnalysisResult> {
  const request = validateMaterialRoleAnalysisRequest(rawRequest);
  const items: MaterialRoleItem[] = [];
  for (const rawPath of request.paths) {
    const target = await realpath(resolve(rawPath));
    const fileStat = await stat(target);
    if (!fileStat.isFile()) continue;
    items.push(await analyzeMaterialRole(target, fileStat.size));
  }
  const roleCounts: Record<MaterialRole, number> = {
    previous_report: 0,
    latest_data: 0,
    result_image: 0,
    reference_material: 0,
  };
  for (const item of items) roleCounts[item.role] += 1;
  const summary = [
    `材料角色识别：共 ${items.length} 项。`,
    `旧报告 ${roleCounts.previous_report} 项；最新数据 ${roleCounts.latest_data} 项；结果图片 ${roleCounts.result_image} 项；参考材料 ${roleCounts.reference_material} 项。`,
    ...items.map((item) => `${item.name}：${materialRoleLabel(item.role)}（${Math.round(item.confidence * 100)}%）。${item.suggestedUse}`),
  ].join("\n");
  return { items, roleCounts, summary };
}

type MaterialFact = {
  key: string;
  label: string;
  value: string;
  comparableValue: string;
  numericValue?: number;
  source: MaterialConsistencySource;
};

export async function analyzeMaterialConsistency(
  rawRequest: unknown,
): Promise<MaterialConsistencyAnalysisResult> {
  const request = validateMaterialConsistencyRequest(rawRequest);
  const facts: MaterialFact[] = [];
  let filesAnalyzed = 0;
  for (const rawPath of request.paths) {
    try {
      const target = await realpath(resolve(rawPath));
      const fileStat = await stat(target);
      if (!fileStat.isFile()) continue;
      const role = await analyzeMaterialRole(target, fileStat.size);
      const text = await readMaterialConsistencyText(target, extname(target).toLowerCase(), fileStat.size);
      filesAnalyzed += 1;
      facts.push(...extractMaterialFacts(text, target, role));
    } catch {
      // A single unreadable material must not block comparison of the remaining files.
    }
  }

  const findings: MaterialConsistencyFinding[] = [];
  const byKey = new Map<string, MaterialFact[]>();
  for (const fact of facts) byKey.set(fact.key, [...(byKey.get(fact.key) || []), fact]);
  for (const [key, grouped] of byKey) {
    findings.push(...compareMaterialFacts(key, grouped));
  }
  const order: Record<MaterialConsistencyFindingKind, number> = {
    source_conflict: 0,
    outdated_number: 1,
    chart_mismatch: 2,
    evidence_gap: 3,
    consensus: 4,
  };
  findings.sort((left, right) => order[left.kind] - order[right.kind] || left.title.localeCompare(right.title, "zh-CN"));
  const counts: Record<MaterialConsistencyFindingKind, number> = {
    consensus: 0,
    source_conflict: 0,
    outdated_number: 0,
    chart_mismatch: 0,
    evidence_gap: 0,
  };
  for (const finding of findings) counts[finding.kind] += 1;
  return {
    findings,
    counts,
    filesAnalyzed,
    summary: findings.length
      ? `比较了 ${filesAnalyzed} 份材料：发现 ${counts.consensus} 项共识、${counts.source_conflict} 项来源冲突、${counts.outdated_number} 个过期数字、${counts.chart_mismatch} 项图文不一致和 ${counts.evidence_gap} 项证据缺口。`
      : `比较了 ${filesAnalyzed} 份材料，暂未发现可确定的材料关系或冲突。`,
  };
}

type QueryMaterialDocument = {
  path: string;
  name: string;
  title: string;
  segments: Array<{ locator: string; text: string }>;
};

const queryMaterialDocumentCache = new Map<string, { size: number; document: QueryMaterialDocument }>();

export async function queryMaterials(rawRequest: unknown): Promise<MaterialQueryResult> {
  const request = validateMaterialQueryRequest(rawRequest);
  const documents: QueryMaterialDocument[] = [];
  for (const rawPath of request.paths) {
    try {
      const target = await realpath(resolve(rawPath));
      const fileStat = await stat(target);
      if (fileStat.isFile()) {
        const cached = queryMaterialDocumentCache.get(target);
        if (cached?.size === fileStat.size) documents.push(cached.document);
        else {
          const document = await readQueryMaterialDocument(target, fileStat.size);
          queryMaterialDocumentCache.set(target, { size: fileStat.size, document });
          documents.push(document);
        }
      }
    } catch {
      // Continue searching the remaining user-selected materials.
    }
  }
  const question = request.question.trim();
  const queryKind = classifyMaterialQuery(question);
  if (queryKind === "comparison" && documents.length >= 2) {
    const comparison = await analyzeMaterialConsistency({ paths: documents.map((item) => item.path) });
    const finding = pickComparisonFinding(comparison.findings, question);
    if (finding) {
      return {
        status: "answered",
        queryKind,
        answer: finding.explanation,
        confidence: 0.96,
        citations: finding.sources.map(({ path, name, locator, excerpt }) => ({ path, name, locator, excerpt })),
        filesSearched: documents.length,
      };
    }
  }
  if (queryKind === "title") {
    const document = pickNamedDocument(documents, question) || documents[0];
    if (document?.title) {
      return answeredMaterialQuery(queryKind, `标题是“${document.title}”。`, [{
        path: document.path,
        name: document.name,
        locator: document.segments[0]?.locator || "文档标题",
        excerpt: document.title,
      }], documents.length, 0.99);
    }
  }
  const terms = materialQueryTerms(question);
  const ranked = rankMaterialSegments(documents, terms, queryKind);
  const best = ranked[0];
  const requiredMatches = queryKind === "general" && terms.length > 1 ? 2 : 1;
  if (best && best.score >= (queryKind === "method" ? 5 : 3) && best.matchedTerms >= requiredMatches) {
    const citations = ranked
      .filter((item) => item.score >= Math.max(3, best.score - 2))
      .slice(0, queryKind === "comparison" ? 2 : 3)
      .map(({ document, segment }) => ({
        path: document.path,
        name: document.name,
        locator: segment.locator,
        excerpt: segment.text.slice(0, 900),
      }));
    const prefix = queryKind === "method" ? "材料中描述的方法是：" : queryKind === "numeric" ? "材料中的相关数字是：" : "材料中写到：";
    return answeredMaterialQuery(queryKind, `${prefix}${best.segment.text.slice(0, 900)}`, citations, documents.length, Math.min(0.98, 0.72 + best.score / 40));
  }
  return {
    status: "not_found",
    queryKind,
    answer: "没有在已导入材料中找到这个问题的可靠答案。我不会编造来源或位置。",
    confidence: 0,
    citations: [],
    filesSearched: documents.length,
  };
}

function validateMaterialQueryRequest(rawRequest: unknown): MaterialQueryRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Material query request is invalid.");
  const { paths, question } = rawRequest as Partial<MaterialQueryRequest>;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) throw new Error("Material query requires between 1 and 100 files.");
  if (typeof question !== "string" || !question.trim() || question.length > 2_000 || /[\r\n]/.test(question)) throw new Error("Material query question is invalid.");
  const normalized = paths.map((value) => {
    if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error("Material path is invalid.");
    return value.trim();
  });
  return { paths: [...new Set(normalized)], question: question.trim() };
}

async function readQueryMaterialDocument(filePath: string, size: number): Promise<QueryMaterialDocument> {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".pdf") {
    const presentation = await extractPresentationPdf(filePath);
    if (presentation) {
      const title = presentation.analysis?.title || presentation.metadata.title || firstMeaningfulLine(presentation.pages[0]?.text || "");
      return {
        path: filePath,
        name: basename(filePath),
        title,
        segments: presentation.pages.filter((page) => page.text.trim()).map((page) => ({ locator: `第 ${page.page} 页`, text: page.text.replace(/\s+/g, " ").trim() })),
      };
    }
  }
  const text = await readMaterialConsistencyText(filePath, extension, size);
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const titleLine = lines.find((line) => /^#{1,3}\s+/.test(line)) || lines[0] || "";
  return {
    path: filePath,
    name: basename(filePath),
    title: titleLine.replace(/^#{1,3}\s+/, "").slice(0, 240),
    segments: lines.map((line, index) => ({ locator: extension === ".csv" || extension === ".tsv" ? `数据行 ${index + 1}` : `第 ${index + 1} 行`, text: line })),
  };
}

function firstMeaningfulLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 2) || "";
}

function classifyMaterialQuery(question: string): MaterialQueryKind {
  if (/标题|题目|title/i.test(question)) return "title";
  if (/差异|不同|区别|冲突|不一致|比较|对比|difference|compare|conflict/i.test(question)) return "comparison";
  if (/方法|实验设计|研究设计|流程|method|methodology|protocol/i.test(question)) return "method";
  if (/多少|数字|数值|比例|百分比|容量|带宽|样本量|均值|tbps|gbps|%|number|value|how many|bandwidth|sample size/i.test(question)) return "numeric";
  return "general";
}

function pickNamedDocument(documents: QueryMaterialDocument[], question: string): QueryMaterialDocument | undefined {
  const normalized = question.toLowerCase();
  return documents.find((document) => normalized.includes(document.name.toLowerCase()) || normalized.includes(document.name.replace(/\.[^.]+$/, "").toLowerCase()));
}

function materialQueryTerms(question: string): string[] {
  const normalized = question.toLowerCase()
    .replace(/这份|这个|材料中|文档中|报告中|论文中|请问|告诉我|分别|相关|是多少|是什么|有哪些|如何|怎么|多少|数字|数值|方法|标题|题目|差异|不同|区别|比较|对比/g, " ")
    .replace(/\b(?:what|is|the|does|do|a|an|in|of|was|were|used|for|across|and|please|tell|me)\b/g, " ")
    .replace(/[^\p{L}\p{N}.%-]+/gu, " ");
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  return [...new Set(tokens)];
}

function rankMaterialSegments(documents: QueryMaterialDocument[], terms: string[], kind: MaterialQueryKind) {
  return documents.flatMap((document) => document.segments.map((segment) => {
    const haystack = `${document.name} ${segment.text}`.toLowerCase();
    const matchedTerms = terms.filter((term) => haystack.includes(term)).length;
    let score = terms.reduce((total, term) => total + (haystack.includes(term) ? Math.min(8, 2 + term.length) : 0), 0);
    if (kind === "method" && /方法|实验设计|研究设计|method|methodology|protocol/i.test(segment.text)) score += 50;
    if (kind === "numeric" && /\d+(?:\.\d+)?\s*(?:%|tbps|gbps|mbps|人|例|项|个)?/i.test(segment.text)) score += 2;
    return { document, segment, score, matchedTerms };
  })).sort((left, right) => right.score - left.score || left.segment.text.length - right.segment.text.length);
}

function pickComparisonFinding(findings: MaterialConsistencyFinding[], question: string): MaterialConsistencyFinding | undefined {
  const terms = materialQueryTerms(question);
  const ranked = findings.map((finding) => ({
    finding,
    score: terms.reduce((total, term) => total + (`${finding.title} ${finding.explanation}`.toLowerCase().includes(term) ? 1 : 0), 0)
      + (finding.kind === "source_conflict" || finding.kind === "outdated_number" || finding.kind === "chart_mismatch" ? 1 : 0),
  })).sort((left, right) => right.score - left.score);
  return ranked[0]?.score ? ranked[0].finding : undefined;
}

function answeredMaterialQuery(queryKind: MaterialQueryKind, answer: string, citations: MaterialQueryCitation[], filesSearched: number, confidence: number): MaterialQueryResult {
  return { status: "answered", queryKind, answer, confidence, citations, filesSearched };
}

function validateMaterialConsistencyRequest(rawRequest: unknown): MaterialConsistencyAnalysisRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Material consistency request is invalid.");
  const paths = (rawRequest as Partial<MaterialConsistencyAnalysisRequest>).paths;
  if (!Array.isArray(paths) || paths.length < 2 || paths.length > 100) {
    throw new Error("Material consistency analysis requires between 2 and 100 files.");
  }
  const normalized = paths.map((value) => {
    if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error("Material path is invalid.");
    return value.trim();
  });
  return { paths: [...new Set(normalized)] };
}

async function readMaterialConsistencyText(filePath: string, extension: string, size: number): Promise<string> {
  const maxBytes = Math.min(size, 160_000);
  try {
    if (extension === ".svg") {
      return decodeXmlEntities((await readFileSlice(filePath, maxBytes)).toString("utf8")
        .replace(/<\/(?:text|title|desc)>/gi, "\n")
        .replace(/<[^>]+>/g, " "));
    }
    if (OFFICE_EXTENSIONS.has(extension)) return await extractOfficeText(filePath, extension, maxBytes);
    if (extension === ".pdf" || extension in IMAGE_MIME) return "";
    const buffer = await readFileSlice(filePath, maxBytes);
    return looksBinary(buffer) ? "" : buffer.toString("utf8").replace(/\u0000/g, "");
  } catch {
    return "";
  }
}

function extractMaterialFacts(text: string, filePath: string, role: MaterialRoleItem): MaterialFact[] {
  if (!text.trim()) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const facts: MaterialFact[] = [];
  const csvHeader = lines[0]?.split(",").map((cell) => cell.trim().toLowerCase()) || [];
  const metricColumn = csvHeader.findIndex((cell) => /^(metric|指标|项目)$/.test(cell));
  const valueColumn = csvHeader.findIndex((cell) => /^(current|value|最新值|当前值)$/.test(cell));
  if (metricColumn >= 0 && valueColumn >= 0) {
    for (let index = 1; index < lines.length; index += 1) {
      const cells = lines[index]!.split(",").map((cell) => cell.trim());
      if (cells[metricColumn] && cells[valueColumn]) {
        const fact = createMaterialFact(cells[metricColumn]!, cells[valueColumn]!, filePath, role, `数据行 ${index + 1}`, lines[index]!);
        if (fact) facts.push(fact);
      }
    }
    return facts;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.match(/^([^:=：,]{2,80})\s*(?::|：|=)\s*(.{1,160})$/);
    if (!match) continue;
    const fact = createMaterialFact(match[1]!, match[2]!, filePath, role, `${extname(filePath).toLowerCase() === ".svg" ? "图中文字" : "第"} ${index + 1} ${extname(filePath).toLowerCase() === ".svg" ? "项" : "行"}`, lines[index]!);
    if (fact) facts.push(fact);
  }
  return facts;
}

function createMaterialFact(
  rawKey: string,
  rawValue: string,
  filePath: string,
  role: MaterialRoleItem,
  locator: string,
  excerpt: string,
): MaterialFact | null {
  const key = normalizeMaterialFactKey(rawKey);
  const value = rawValue.replace(/[。；;]+$/, "").trim();
  if (!key || !value) return null;
  const numericMatch = value.match(/-?\d+(?:\.\d+)?/);
  return {
    key,
    label: materialFactLabel(key, rawKey.trim()),
    value,
    comparableValue: numericMatch ? numericMatch[0]! : normalizeMaterialFactValue(value),
    numericValue: numericMatch ? Number(numericMatch[0]) : undefined,
    source: {
      path: filePath,
      name: basename(filePath),
      role: role.role,
      locator,
      value,
      excerpt: excerpt.slice(0, 240),
    },
  };
}

function normalizeMaterialFactKey(value: string): string {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (/样本量|samplesize|samplecount|样本数/.test(normalized)) return "sample_size";
  if (/平均值|平均分|均值|mean|average/.test(normalized)) return "mean";
  if (/实施成本|执行成本|cost/.test(normalized)) return "implementation_cost";
  if (/短期记忆|shorttermmemory|shorttermeffect/.test(normalized)) return "short_term_memory";
  if (/长期稳定|长期效果|longtermstability|longtermeffect/.test(normalized)) return "long_term_stability";
  return normalized.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 80);
}

function materialFactLabel(key: string, fallback: string): string {
  if (key === "sample_size") return "样本量";
  if (key === "mean") return "平均值";
  if (key === "implementation_cost") return "实施成本";
  if (key === "short_term_memory") return "短期记忆效果";
  if (key === "long_term_stability") return "长期稳定性";
  return fallback;
}

function normalizeMaterialFactValue(value: string): string {
  return value.toLowerCase().replace(/[\s，,。；;、]+/g, "");
}

function isEvidenceGapValue(value: string): boolean {
  return /证据不足|数据不足|尚无|未知|不确定|未验证|insufficient|unknown|uncertain|not verified/i.test(value);
}

function compareMaterialFacts(key: string, facts: MaterialFact[]): MaterialConsistencyFinding[] {
  const findings: MaterialConsistencyFinding[] = [];
  const label = facts[0]?.label || key;
  const latest = facts.find((fact) => fact.source.role === "latest_data" && fact.numericValue !== undefined);
  if (latest) {
    for (const fact of facts) {
      if (fact === latest || fact.numericValue === undefined || fact.numericValue === latest.numericValue) continue;
      if (fact.source.role === "previous_report") {
        findings.push(makeMaterialFinding("outdated_number", key, label, [fact, latest],
          `旧报告中的${label}为 ${fact.value}，最新数据已经是 ${latest.value}。`,
          `用 ${latest.source.name} 中的最新值替换旧值，并保留修改依据。`));
      } else if (fact.source.role === "result_image") {
        findings.push(makeMaterialFinding("chart_mismatch", key, label, [fact, latest],
          `结果图中的${label}为 ${fact.value}，与最新数据 ${latest.value} 不一致。`,
          "重新生成或修正图表，并检查坐标、标签和图注。"));
      }
    }
  }

  const gaps = facts.filter((fact) => isEvidenceGapValue(fact.value));
  for (const gap of gaps) {
    findings.push(makeMaterialFinding("evidence_gap", key, label, [gap],
      `${gap.source.name} 明确说明${label}证据不足，当前不能写成确定结论。`,
      "保留不确定性说明，并补充时间跨度或独立验证材料。"));
  }

  const comparable = facts.filter((fact) => !isEvidenceGapValue(fact.value));
  const buckets = new Map<string, MaterialFact[]>();
  for (const fact of comparable) buckets.set(fact.comparableValue, [...(buckets.get(fact.comparableValue) || []), fact]);
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    findings.push(makeMaterialFinding("consensus", key, label, bucket,
      `${bucket.map((fact) => fact.source.name).join("、")} 对${label}给出一致结果：${bucket[0]!.value}。`,
      "可以作为多来源共同支持的结论使用，同时保留来源。"));
  }
  if (!latest && buckets.size > 1) {
    const conflicting = [...buckets.values()].map((bucket) => bucket[0]!).slice(0, 4);
    findings.push(makeMaterialFinding("source_conflict", key, label, conflicting,
      `不同材料对${label}给出互相冲突的结果：${conflicting.map((fact) => `${fact.source.name} 为“${fact.value}”`).join("；")}。`,
      "并列保留冲突双方，不要合并为确定结论；建议使用统一方法重新验证。"));
  }
  return findings;
}

function makeMaterialFinding(
  kind: MaterialConsistencyFindingKind,
  key: string,
  label: string,
  facts: MaterialFact[],
  explanation: string,
  recommendation: string,
): MaterialConsistencyFinding {
  const titles: Record<MaterialConsistencyFindingKind, string> = {
    consensus: `${label}存在多来源共识`,
    source_conflict: `${label}存在来源冲突`,
    outdated_number: `旧报告中的${label}已经过期`,
    chart_mismatch: `结果图中的${label}与数据不一致`,
    evidence_gap: `${label}仍缺少证据`,
  };
  return {
    id: `${kind}-${key}-${facts.map((fact) => fact.source.name).join("-")}`.replace(/[^\p{L}\p{N}_.-]+/gu, "-").slice(0, 180),
    kind,
    severity: kind === "source_conflict" || kind === "outdated_number" || kind === "chart_mismatch" ? "high" : kind === "evidence_gap" ? "medium" : "info",
    title: titles[kind],
    explanation,
    recommendation,
    sources: facts.map((fact) => fact.source),
  };
}

async function analyzeMaterialRole(filePath: string, size: number): Promise<MaterialRoleItem> {
  const name = basename(filePath);
  const extension = extname(name).toLowerCase();
  const preview = await readMaterialRolePreview(filePath, extension, size);
  const evidence = `${name}\n${preview}`.toLowerCase();
  const isImage = extension in IMAGE_MIME;
  const isData = MATERIAL_DATA_EXTENSIONS.has(extension);
  const oldCue = /(?:旧|历史|上一版|原报告|old|previous|prior|baseline|archive|202[0-5])/.test(evidence);
  const latestCue = /(?:最新|本期|当前|更新|latest|current|updated|new[-_ ]?data|2026)/.test(evidence);
  const reportCue = /(?:报告|汇报|总结|report|summary|review|draft)/.test(evidence);

  if (isImage) {
    return {
      path: filePath,
      name,
      role: "result_image",
      confidence: 0.98,
      reason: "图片格式，适合作为结果图或图表核对材料。",
      suggestedUse: "建议与最新数据核对趋势、坐标和标注，再用于更新报告。",
    };
  }
  if (isData) {
    return {
      path: filePath,
      name,
      role: "latest_data",
      confidence: latestCue ? 0.98 : 0.92,
      reason: latestCue ? "表格内容或名称包含最新/当前时间线索。" : "结构化表格适合作为本次更新的数据依据。",
      suggestedUse: "建议先检查字段、单位和异常值，再替换旧报告中的过期数字。",
    };
  }
  if (MATERIAL_REPORT_EXTENSIONS.has(extension) && (oldCue || reportCue)) {
    return {
      path: filePath,
      name,
      role: "previous_report",
      confidence: oldCue ? 0.98 : 0.91,
      reason: oldCue ? "文档包含旧版、历史或基线时间线索。" : "文档结构和名称表明它是待更新的报告。",
      suggestedUse: "建议保留原文件，以它为结构基线生成更新版本。",
    };
  }
  return {
    path: filePath,
    name,
    role: "reference_material",
    confidence: 0.95,
    reason: "未发现旧报告或最新数据特征，作为背景和引用依据处理。",
    suggestedUse: "建议用于补充背景、术语和出处，不直接覆盖最新数据。",
  };
}

async function readMaterialRolePreview(filePath: string, extension: string, size: number): Promise<string> {
  const maxBytes = Math.min(size, 80_000);
  try {
    if (OFFICE_EXTENSIONS.has(extension)) return await extractOfficeText(filePath, extension, maxBytes);
    if (extension === ".pdf" || extension in IMAGE_MIME) return "";
    const buffer = await readFileSlice(filePath, maxBytes);
    return looksBinary(buffer) ? "" : buffer.toString("utf8").replace(/\u0000/g, "");
  } catch {
    return "";
  }
}

function validateMaterialRoleAnalysisRequest(rawRequest: unknown): MaterialRoleAnalysisRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Material role analysis request is invalid.");
  const paths = (rawRequest as Partial<MaterialRoleAnalysisRequest>).paths;
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 100) {
    throw new Error("Material role analysis requires between 1 and 100 files.");
  }
  const normalized = paths.map((value) => {
    if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) throw new Error("Material path is invalid.");
    return value.trim();
  });
  return { paths: [...new Set(normalized)] };
}

function materialRoleLabel(role: MaterialRole): string {
  if (role === "previous_report") return "旧报告";
  if (role === "latest_data") return "最新数据";
  if (role === "result_image") return "结果图片";
  return "参考材料";
}

export async function previewWorkspaceFile(
  rawRequest: unknown,
): Promise<WorkspaceFilePreview> {
  const request = validatePreviewRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const target = await resolveInsideWorkspace(workspacePath, request.path);
  const fileStat = await stat(target);
  if (!fileStat.isFile()) throw new Error("Workspace preview target must be a file.");

  const maxBytes = clampInt(request.maxBytes, 8_000, 500_000, DEFAULT_PREVIEW_BYTES);
  const mode = request.mode ?? "auto";
  const extension = extname(target).toLowerCase();
  const relativePath = normalizeRel(relative(workspacePath, target));
  const name = basename(target);
  const kind = classifyPreviewKind(target, fileStat.size);
  const fileHash = await hashFile(target);
  const base: WorkspaceFilePreview = {
    workspacePath,
    path: target,
    relativePath,
    name,
    kind,
    mime: getMime(extension, kind),
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    truncated: fileStat.size > maxBytes,
    fileHash,
    mode,
  };

  if (kind === "image") {
    if (fileStat.size <= MAX_IMAGE_DATA_URL_BYTES) {
      const buffer = await readFile(target);
      return {
        ...base,
        dataUrl: `data:${base.mime};base64,${buffer.toString("base64")}`,
        metadata: readImageMetadata(buffer, extension),
      };
    }
    return {
      ...base,
      message: "Image is large; preview shows metadata only.",
    };
  }

  if (kind === "media") {
    return {
      ...base,
      message: "Media preview is rendered directly in the file preview pane.",
    };
  }

  if (mode === "outline") {
    const buffer = await readFileSlice(target, Math.min(fileStat.size, maxBytes));
    const content = buffer.toString("utf8").replace(/\u0000/g, "");
    return {
      ...base,
      kind: kind === "large" ? "text" : kind,
      outline: createTextOutline(content),
      content: undefined,
      message: "Outline preview generated from file headings and symbols.",
    };
  }

  if (kind === "large" && (mode === "head" || mode === "tail")) {
    const buffer = mode === "tail"
      ? await readFileTail(target, Math.min(fileStat.size, maxBytes))
      : await readFileSlice(target, Math.min(fileStat.size, maxBytes));
    const content = buffer.toString("utf8").replace(/\u0000/g, "");
    return {
      ...base,
      kind: "text",
      content,
      truncated: true,
      message: mode === "tail" ? "Showing file tail only." : "Showing file head only.",
    };
  }

  if (kind === "pdf") {
    const presentation = await extractPresentationPdf(target);
    const pdfText = presentation
      ? formatPresentationPdfSummary(presentation, Math.max(maxBytes, 120_000))
      : await extractPdfText(target, Math.min(fileStat.size, maxBytes));
    return {
      ...base,
      content: pdfText || undefined,
      ...(presentation?.type === "presentation_pdf" && presentation.analysis
        ? { presentationStory: buildPresentationStory(presentation) }
        : {}),
      message: pdfText
        ? "Extracted structured PDF text with page roles for analysis."
        : getMetadataOnlyMessage(kind),
    };
  }

  if (
    kind === "office"
  ) {
    const officeText = await extractOfficeText(target, extension, Math.min(fileStat.size, maxBytes));
    return {
      ...base,
      content: officeText || undefined,
      message: officeText
        ? "Extracted a basic text preview from the Office document."
        : getMetadataOnlyMessage(kind),
    };
  }

  if (
    kind === "binary" ||
    kind === "large" ||
    kind === "unknown"
  ) {
    return {
      ...base,
      message: getMetadataOnlyMessage(kind),
    };
  }

  const buffer = await readFileSlice(target, Math.min(fileStat.size, maxBytes));
  const content = buffer.toString("utf8").replace(/\u0000/g, "");

  if (kind === "notebook") {
    return {
      ...base,
      content: createNotebookCellPreview(content),
      outline: createNotebookOutline(content),
      message: "Notebook cell preview generated from ipynb JSON.",
    };
  }

  if (looksBinary(buffer)) {
    return {
      ...base,
      kind: "binary",
      mime: "application/octet-stream",
      content: undefined,
      message: "Binary-looking file; preview shows metadata only.",
    };
  }

  if (kind === "json") {
    try {
      return {
        ...base,
        content: JSON.stringify(JSON.parse(content), null, 2),
      };
    } catch {
      return { ...base, content };
    }
  }

  if (kind === "table") {
    const rows = parseDelimitedRows(content, extension === ".tsv" ? "\t" : ",");
    return {
      ...base,
      columns: rows[0] ?? [],
      rows: rows.slice(1, 26),
      content,
    };
  }

  return {
    ...base,
    content,
  };
}

async function hasValidImportSignature(filePath: string, extension: string): Promise<boolean> {
  const expected = extension === ".pdf"
    ? "%PDF-"
    : [".docx", ".xlsx", ".pptx"].includes(extension)
      ? "PK"
      : [".doc", ".xls", ".ppt"].includes(extension)
        ? "D0CF"
        : extension === ".png"
          ? "PNG"
          : "";
  if (!expected) return true;
  try {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(8);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (expected === "%PDF-") return buffer.subarray(0, bytesRead).toString("ascii").startsWith(expected);
      if (expected === "PK") return buffer[0] === 0x50 && buffer[1] === 0x4b;
      if (expected === "D0CF") return buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
      return buffer.subarray(1, 4).toString("ascii") === expected;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

function buildPresentationStory(result: PresentationPdfResult): NonNullable<WorkspaceFilePreview["presentationStory"]> {
  const analysis = result.analysis;
  if (!analysis) throw new Error("Presentation analysis is unavailable.");
  const agenda = analysis.agenda.map((item) => ({ text: item.text, page: item.page }));
  const storySections = analysis.storySections.map((item) => ({ text: item.title, page: item.page }));
  const summaryPoints = analysis.summaryPoints.map((item) => ({ text: item.text, page: item.page }));
  const numericHighlights = analysis.numericHighlights.map((item) => ({ text: item.text, page: item.page }));
  const allItems = [...agenda, ...storySections, ...summaryPoints, ...numericHighlights];
  const pageByNumber = new Map(result.pages.map((page) => [page.page, page.text]));
  const sourceMappedItems = allItems.filter((item) => item.page >= 1 && item.page <= result.pageCount && pageByNumber.has(item.page)).length;
  const numericSourceMatches = numericHighlights.filter((item) => {
    const source = pageByNumber.get(item.page) ?? "";
    const expectedNumbers = item.text.match(/\d+(?:\.\d+)?/g) ?? [];
    return expectedNumbers.length > 0 && expectedNumbers.every((value) => source.includes(value));
  }).length;
  const structuralChecks = {
    title: Boolean(analysis.title.trim()),
    agenda: agenda.length > 0,
    story: storySections.length >= 3,
    summary: summaryPoints.length > 0,
    numeric: numericHighlights.length > 0,
    mapping: sourceMappedItems === allItems.length,
    numericMapping: numericSourceMatches === numericHighlights.length,
  };
  const checks = [
    structuralChecks.title ? "标题已提取" : "标题缺失",
    structuralChecks.agenda ? `议程 ${agenda.length} 项` : "议程缺失",
    structuralChecks.story ? `故事线 ${storySections.length} 章` : "故事线章节不足",
    structuralChecks.summary ? `总结 ${summaryPoints.length} 项` : "总结缺失",
    structuralChecks.numeric ? `关键数据 ${numericHighlights.length} 项` : "关键数据缺失",
    structuralChecks.mapping ? `来源页码 ${sourceMappedItems}/${allItems.length} 有效` : `来源页码仅 ${sourceMappedItems}/${allItems.length} 有效`,
    structuralChecks.numericMapping ? `关键数据 ${numericSourceMatches}/${numericHighlights.length} 可回查原页` : `关键数据仅 ${numericSourceMatches}/${numericHighlights.length} 可回查原页`,
  ];
  return {
    title: analysis.title,
    agenda,
    storySections,
    summaryPoints,
    numericHighlights,
    quality: {
      status: Object.values(structuralChecks).every(Boolean) ? "passed" : "failed",
      checkedAt: new Date().toISOString(),
      sourcePageCount: result.pageCount,
      agendaItems: agenda.length,
      storySections: storySections.length,
      summaryPoints: summaryPoints.length,
      numericHighlights: numericHighlights.length,
      sourceMappedItems,
      sourceMappingExpected: allItems.length,
      numericSourceMatches,
      numericSourceExpected: numericHighlights.length,
      checks,
    },
  };
}

export async function getWorkspaceGitDiff(
  rawRequest: unknown,
): Promise<WorkspaceGitDiffResult> {
  const request = validateDiffRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const maxChars = clampInt(request.maxChars, 4_000, 300_000, DEFAULT_DIFF_CHARS);
  const args = request.staged ? ["diff", "--cached", "--"] : ["diff", "--"];
  let safeRelativePath: string | undefined;
  if (request.path) {
    const target = await resolvePossiblyMissingInsideWorkspace(workspacePath, request.path);
    safeRelativePath = normalizeRel(relative(workspacePath, target));
    args.push(safeRelativePath);
  }
  const diff = (await runGit(workspacePath, args, 8000)) ?? "";
  return {
    workspacePath,
    path: safeRelativePath,
    diff: diff.slice(0, maxChars),
    diffHash: hashString(diff),
    truncated: diff.length > maxChars,
    staged: request.staged === true,
  };
}

export async function getWorkspaceGitFileAtRef(
  rawRequest: unknown,
): Promise<WorkspaceGitFileAtRefResult> {
  const request = validateGitFileAtRefRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const target = await resolvePossiblyMissingInsideWorkspace(workspacePath, request.path);
  const safeRelativePath = normalizeRel(relative(workspacePath, target));
  const maxBytes = clampInt(request.maxBytes, 4_000, 500_000, DEFAULT_GIT_REF_FILE_BYTES);
  const content = await runGitRaw(
    workspacePath,
    ["show", `${request.ref}:${safeRelativePath}`],
    8000,
  );
  if (content === null) {
    return {
      workspacePath,
      ref: request.ref,
      path: safeRelativePath,
      content: "",
      truncated: false,
      missing: true,
      message: `No file content was found at ${request.ref}:${safeRelativePath}.`,
    };
  }
  const normalized = content.replace(/\u0000/g, "");
  return {
    workspacePath,
    ref: request.ref,
    path: safeRelativePath,
    content: normalized.slice(0, maxBytes),
    contentHash: hashString(normalized),
    truncated: normalized.length > maxBytes,
    missing: false,
    message: normalized.length > maxBytes
      ? "Git ref file preview loaded with truncation."
      : "Git ref file preview loaded.",
  };
}

export async function revertWorkspaceFile(
  rawRequest: unknown,
): Promise<WorkspaceRevertFileResult> {
  const request = validateRevertRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const target = await resolvePossiblyMissingInsideWorkspace(workspacePath, request.path);
  const safeRelativePath = normalizeRel(relative(workspacePath, target));
  const currentDiff = (await runGit(workspacePath, ["diff", "--", safeRelativePath], 8000)) ?? "";
  const currentHash = hashString(currentDiff);
  if (!currentDiff.trim()) {
    return {
      workspacePath,
      path: safeRelativePath,
      reverted: false,
      message: "No unstaged diff exists for this file.",
    };
  }
  if (currentHash !== request.expectedDiffHash) {
    throw new Error("File diff changed since review; refresh before reverting.");
  }
  await runGit(workspacePath, ["restore", "--worktree", "--", safeRelativePath], 8000);
  return {
    workspacePath,
    path: safeRelativePath,
    reverted: true,
    message: "Reverted unstaged file changes.",
  };
}

export async function stageWorkspaceFile(
  rawRequest: unknown,
): Promise<WorkspaceStageFileResult> {
  const request = validateStageRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const target = await resolvePossiblyMissingInsideWorkspace(workspacePath, request.path);
  const safeRelativePath = normalizeRel(relative(workspacePath, target));
  const currentDiff = (await runGit(workspacePath, ["diff", "--", safeRelativePath], 8000)) ?? "";
  const currentHash = hashString(currentDiff);
  if (!currentDiff.trim()) {
    return {
      workspacePath,
      path: safeRelativePath,
      staged: false,
      message: "No unstaged diff exists for this file.",
    };
  }
  if (currentHash !== request.expectedDiffHash) {
    throw new Error("File diff changed since review; refresh before approving.");
  }
  await runGit(workspacePath, ["add", "--", safeRelativePath], 8000);
  return {
    workspacePath,
    path: safeRelativePath,
    staged: true,
    message: "Approved file changes by staging them.",
  };
}

export async function stageWorkspaceHunk(
  rawRequest: unknown,
): Promise<WorkspaceHunkActionResult> {
  const { request, safeRelativePath, workspacePath } = await prepareHunkAction(rawRequest);
  const applied = await runGitWithInput(workspacePath, ["apply", "--cached", "--"], request.patch, 8000);
  return {
    workspacePath,
    path: safeRelativePath,
    applied,
    message: applied ? "Approved hunk by staging it." : "Could not apply this hunk to the index.",
  };
}

export async function revertWorkspaceHunk(
  rawRequest: unknown,
): Promise<WorkspaceHunkActionResult> {
  const { request, safeRelativePath, workspacePath } = await prepareHunkAction(rawRequest);
  const applied = await runGitWithInput(workspacePath, ["apply", "--reverse", "--"], request.patch, 8000);
  return {
    workspacePath,
    path: safeRelativePath,
    applied,
    message: applied ? "Rejected hunk by reverting it from the worktree." : "Could not revert this hunk.",
  };
}

async function readInstructionChain(workspacePath: string): Promise<WorkspaceInstructionSummary[]> {
  const summaries: WorkspaceInstructionSummary[] = [];
  const candidates = [
    "AGENTS.md",
    "DRSAI.md",
    "CLAUDE.md",
    join(".claude", "rules", "project.md"),
  ] as const;
  for (const candidate of candidates) {
    const filePath = join(workspacePath, candidate);
    if (!existsSync(filePath)) continue;
    try {
      const raw = await readFile(filePath, "utf8");
      const normalized = raw.replace(/\u0000/g, "").trim();
      summaries.push({
        name: basename(candidate) as WorkspaceInstructionSummary["name"],
        path: filePath,
        content: normalized.slice(0, MAX_INSTRUCTION_CHARS),
        truncated: normalized.length > MAX_INSTRUCTION_CHARS,
      });
    } catch {
      // Ignore unreadable instruction files.
    }
  }
  return summaries;
}

async function getGitStatus(workspacePath: string): Promise<WorkspaceGitStatus | undefined> {
  const repoRoot = await runGit(workspacePath, ["rev-parse", "--show-toplevel"], 3000);
  if (!repoRoot) return undefined;
  const branch = await runGit(workspacePath, ["branch", "--show-current"], 3000);
  const status = await runGit(workspacePath, ["status", "--porcelain"], 3000);
  return {
    repoRoot,
    branch: branch || undefined,
    hasChanges: Boolean(status),
  };
}

async function getGitChangedFiles(
  workspacePath: string,
): Promise<Array<{ path: string; status: WorkspaceFileGitStatus }>> {
  const output = await runGit(workspacePath, ["status", "--porcelain"], 3000);
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => parsePorcelainLine(line))
    .filter(Boolean) as Array<{ path: string; status: WorkspaceFileGitStatus }>;
}

function parsePorcelainLine(line: string): { path: string; status: WorkspaceFileGitStatus } | null {
  if (line.length < 4) return null;
  const code = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const path = normalizeRel(rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath);
  if (!path) return null;
  if (code === "??") return { path, status: "untracked" };
  if (code.includes("D")) return { path, status: "deleted" };
  if (code.includes("A")) return { path, status: "added" };
  if (code.includes("R")) return { path, status: "renamed" };
  return { path, status: "modified" };
}

function validateTreeRequest(rawRequest: unknown): WorkspaceFileTreeRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace file tree request is invalid.");
  const request = rawRequest as Partial<WorkspaceFileTreeRequest>;
  return {
    workspacePath: String(request.workspacePath ?? ""),
    query: typeof request.query === "string" ? request.query.slice(0, 200) : undefined,
    maxDepth: typeof request.maxDepth === "number" ? request.maxDepth : undefined,
    maxEntries: typeof request.maxEntries === "number" ? request.maxEntries : undefined,
  };
}

function validateFolderSummaryRequest(rawRequest: unknown): WorkspaceFolderSummaryRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace folder summary request is invalid.");
  const request = rawRequest as Partial<WorkspaceFolderSummaryRequest>;
  return {
    path: String(request.path ?? ""),
    maxDepth: typeof request.maxDepth === "number" ? request.maxDepth : undefined,
    maxEntries: typeof request.maxEntries === "number" ? request.maxEntries : undefined,
    maxSampleFiles: typeof request.maxSampleFiles === "number" ? request.maxSampleFiles : undefined,
    maxChars: typeof request.maxChars === "number" ? request.maxChars : undefined,
  };
}

function validatePreviewRequest(rawRequest: unknown): WorkspaceFilePreviewRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace file preview request is invalid.");
  const request = rawRequest as Partial<WorkspaceFilePreviewRequest>;
  return {
    workspacePath: String(request.workspacePath ?? ""),
    path: String(request.path ?? ""),
    maxBytes: typeof request.maxBytes === "number" ? request.maxBytes : undefined,
    mode: ["auto", "head", "tail", "outline"].includes(String(request.mode))
      ? request.mode
      : undefined,
  };
}

function validateDiffRequest(rawRequest: unknown): WorkspaceGitDiffRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace git diff request is invalid.");
  const request = rawRequest as Partial<WorkspaceGitDiffRequest>;
  return {
    workspacePath: String(request.workspacePath ?? ""),
    path: typeof request.path === "string" ? request.path : undefined,
    maxChars: typeof request.maxChars === "number" ? request.maxChars : undefined,
    staged: request.staged === true,
  };
}

function validateGitFileAtRefRequest(rawRequest: unknown): WorkspaceGitFileAtRefRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace git ref file request is invalid.");
  const request = rawRequest as Partial<WorkspaceGitFileAtRefRequest>;
  const ref = typeof request.ref === "string" ? request.ref.trim() : "";
  if (
    !ref ||
    ref.length > 160 ||
    /[\r\n\u0000]/.test(ref) ||
    ref.startsWith("-") ||
    ref.includes("..") ||
    !/^[A-Za-z0-9._/@{}^~:-]+$/.test(ref)
  ) {
    throw new Error("Git ref is invalid for file preview.");
  }
  return {
    workspacePath: String(request.workspacePath ?? ""),
    ref,
    path: String(request.path ?? ""),
    maxBytes: typeof request.maxBytes === "number" ? request.maxBytes : undefined,
  };
}

function validateRevertRequest(rawRequest: unknown): WorkspaceRevertFileRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace revert request is invalid.");
  const request = rawRequest as WorkspaceRevertFileRequest;
  if (typeof request.workspacePath !== "string") throw new Error("Workspace path is required.");
  if (typeof request.path !== "string" || !request.path.trim()) throw new Error("File path is required.");
  if (typeof request.expectedDiffHash !== "string" || !request.expectedDiffHash.trim()) {
    throw new Error("Expected diff hash is required.");
  }
  return request;
}

function validateStageRequest(rawRequest: unknown): WorkspaceStageFileRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace stage request is invalid.");
  const request = rawRequest as WorkspaceStageFileRequest;
  if (typeof request.workspacePath !== "string") throw new Error("Workspace path is required.");
  if (typeof request.path !== "string" || !request.path.trim()) throw new Error("File path is required.");
  if (typeof request.expectedDiffHash !== "string" || !request.expectedDiffHash.trim()) {
    throw new Error("Expected diff hash is required.");
  }
  return request;
}

async function prepareHunkAction(rawRequest: unknown): Promise<{
  request: WorkspaceHunkActionRequest;
  safeRelativePath: string;
  workspacePath: string;
}> {
  const request = validateHunkActionRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const target = await resolvePossiblyMissingInsideWorkspace(workspacePath, request.path);
  const safeRelativePath = normalizeRel(relative(workspacePath, target));
  ensurePatchOnlyTargets(request.patch, safeRelativePath);
  const currentDiff = (await runGit(workspacePath, ["diff", "--", safeRelativePath], 8000)) ?? "";
  if (!currentDiff.trim()) throw new Error("No unstaged diff exists for this file.");
  if (hashString(currentDiff) !== request.expectedDiffHash) {
    throw new Error("File diff changed since review; refresh before applying this hunk.");
  }
  return { request, safeRelativePath, workspacePath };
}

function validateHunkActionRequest(rawRequest: unknown): WorkspaceHunkActionRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace hunk request is invalid.");
  const request = rawRequest as WorkspaceHunkActionRequest;
  if (typeof request.workspacePath !== "string") throw new Error("Workspace path is required.");
  if (typeof request.path !== "string" || !request.path.trim()) throw new Error("File path is required.");
  if (typeof request.expectedDiffHash !== "string" || !request.expectedDiffHash.trim()) {
    throw new Error("Expected diff hash is required.");
  }
  if (typeof request.patch !== "string" || !request.patch.includes("@@") || request.patch.length > 120_000) {
    throw new Error("Hunk patch is invalid.");
  }
  return request;
}

function ensurePatchOnlyTargets(patch: string, safeRelativePath: string): void {
  const allowed = new Set([safeRelativePath, `/dev/null`]);
  const pathMatches = [
    ...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm),
    ...patch.matchAll(/^(?:---|\+\+\+) (?:a|b)\/(.+)$/gm),
  ];
  if (pathMatches.length === 0) throw new Error("Hunk patch is missing file headers.");
  for (const match of pathMatches) {
    const paths = match.slice(1).filter(Boolean);
    for (const item of paths) {
      if (!allowed.has(normalizeRel(item))) {
        throw new Error("Hunk patch targets a different file.");
      }
    }
  }
}

async function resolveWorkspaceRoot(rawWorkspacePath: unknown): Promise<string> {
  if (typeof rawWorkspacePath !== "string" || /[\r\n]/.test(rawWorkspacePath)) {
    throw new Error("Workspace path is invalid.");
  }
  const requestedPath = rawWorkspacePath.trim();
  const candidate = requestedPath && requestedPath !== "Local workspace"
    ? resolve(requestedPath)
    : getDefaultWorkspaceRoot();
  const root = await realpath(existsSync(candidate) ? candidate : getDefaultWorkspaceRoot());
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error("Workspace path must be a directory.");
  return root;
}

function getDefaultWorkspaceRoot(): string {
  const candidates = [
    process.env.INIT_CWD,
    process.cwd(),
    __dirname,
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const root = findAncestorWithMarker(resolve(candidate), ".git");
    if (root) return root;
  }
  return process.cwd();
}

function findAncestorWithMarker(startPath: string, marker: string): string | null {
  let current = existsSync(startPath) ? startPath : dirname(startPath);
  while (true) {
    if (existsSync(join(current, marker))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function resolveInsideWorkspace(workspacePath: string, rawPath: string): Promise<string> {
  if (!rawPath || /[\r\n]/.test(rawPath)) throw new Error("Workspace file path is invalid.");
  const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspacePath, rawPath);
  const realTarget = await realpath(target);
  ensureInside(workspacePath, realTarget);
  return realTarget;
}

async function resolvePossiblyMissingInsideWorkspace(workspacePath: string, rawPath: string): Promise<string> {
  if (!rawPath || /[\r\n]/.test(rawPath)) throw new Error("Workspace file path is invalid.");
  const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspacePath, rawPath);
  const resolved = existsSync(target) ? await realpath(target) : target;
  ensureInside(workspacePath, resolved);
  return resolved;
}

function ensureInside(workspacePath: string, target: string): void {
  const rel = relative(workspacePath, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
  throw new Error("Workspace path escapes the active workspace.");
}

function classifyPreviewKind(filePath: string, size: number): WorkspacePreviewKind {
  const extension = extname(filePath).toLowerCase();
  if (extension in IMAGE_MIME) return "image";
  if (extension in MEDIA_MIME) return "media";
  if (extension === ".pdf") return "pdf";
  if (size > 2_000_000) return "large";
  if (OFFICE_EXTENSIONS.has(extension)) return "office";
  if (extension === ".ipynb") return "notebook";
  if (extension === ".md" || extension === ".mdx") return "markdown";
  if (extension === ".html" || extension === ".htm") return "html";
  if (extension === ".json") return "json";
  if (CONFIG_EXTENSIONS.has(extension) || basename(filePath).toLowerCase().startsWith(".env")) return "config";
  if (extension === ".csv" || extension === ".tsv") return "table";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (TEXT_EXTENSIONS.has(extension) || extension === "") return "text";
  return "unknown";
}

function getMime(extension: string, kind: WorkspacePreviewKind): string {
  if (extension in IMAGE_MIME) return IMAGE_MIME[extension];
  if (extension in MEDIA_MIME) return MEDIA_MIME[extension];
  if (kind === "json") return "application/json";
  if (kind === "notebook") return "application/x-ipynb+json";
  if (kind === "markdown") return "text/markdown";
  if (kind === "html") return "text/html";
  if (kind === "pdf") return "application/pdf";
  if (kind === "office") return "application/vnd.openxmlformats-officedocument";
  if (kind === "binary") return "application/octet-stream";
  return "text/plain";
}

function getMetadataOnlyMessage(kind: WorkspacePreviewKind): string {
  if (kind === "pdf") return "PDF preview is metadata-only in this version; add a text summary in V2.";
  if (kind === "office") return "Office preview is metadata-only in this version; extraction arrives in V2.";
  if (kind === "large") return "Large file preview is limited to metadata unless explicitly opened.";
  return "Preview shows metadata only for this file type.";
}

async function readFileSlice(filePath: string, bytes: number): Promise<Buffer> {
  const buffer = await readFile(filePath);
  return buffer.subarray(0, bytes);
}

async function readFileTail(filePath: string, bytes: number): Promise<Buffer> {
  const buffer = await readFile(filePath);
  return buffer.subarray(Math.max(0, buffer.length - bytes));
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
  });
}

function hashString(input: string): string {
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

async function summarizeFileForFolder(
  filePath: string,
  kind: WorkspacePreviewKind,
  size: number,
): Promise<string[] | undefined> {
  if (
    kind === "binary" ||
    kind === "image" ||
    kind === "media" ||
    kind === "large" ||
    kind === "unknown" ||
    size > MAX_FOLDER_SUMMARY_FILE_BYTES
  ) {
    return undefined;
  }
  try {
    const buffer = await readFileSlice(filePath, Math.min(size, MAX_FOLDER_SUMMARY_FILE_BYTES));
    if (looksBinary(buffer)) return undefined;
    const content = buffer.toString("utf8").replace(/\u0000/g, "");
    return createTextOutline(content)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return undefined;
  }
}

function createTextOutline(content: string): string[] {
  const outline = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      /^#{1,6}\s+/.test(line) ||
      /^(export\s+)?(class|function|interface|type|const|let|var)\s+\w+/.test(line) ||
      /^def\s+\w+/.test(line) ||
      /^class\s+\w+/.test(line),
    )
    .slice(0, 120);
  return outline.length > 0 ? outline : content.split(/\r?\n/).slice(0, 40);
}

function createNotebookCellPreview(content: string): string {
  const notebook = parseNotebook(content);
  if (!notebook) return content.slice(0, 20_000);
  const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
  return [
    `Notebook cells: ${cells.length}`,
    ...cells.slice(0, 40).map((cell, index) => {
      const cellRecord = isRecord(cell) ? cell : {};
      const cellType = typeof cellRecord.cell_type === "string" ? cellRecord.cell_type : "unknown";
      const source = normalizeNotebookSource(cellRecord.source);
      const firstLine = source.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
      const outputCount = Array.isArray(cellRecord.outputs) ? cellRecord.outputs.length : 0;
      const outputSuffix = outputCount > 0 ? `, ${outputCount} outputs` : "";
      return `${index + 1}. ${cellType}, ${countLines(source)} lines${outputSuffix}: ${firstLine}`;
    }),
    cells.length > 40 ? "[truncated]" : "",
  ].filter(Boolean).join("\n");
}

function createNotebookOutline(content: string): string[] {
  const notebook = parseNotebook(content);
  if (!notebook) return createTextOutline(content);
  const cells = Array.isArray(notebook.cells) ? notebook.cells : [];
  return cells.slice(0, 80).flatMap((cell, index) => {
    const cellRecord = isRecord(cell) ? cell : {};
    const cellType = typeof cellRecord.cell_type === "string" ? cellRecord.cell_type : "unknown";
    const source = normalizeNotebookSource(cellRecord.source);
    const headings = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^#{1,6}\s+/.test(line) || /^(def|class)\s+\w+/.test(line))
      .slice(0, 4);
    return headings.length > 0 ? headings.map((heading) => `cell ${index + 1}: ${heading}`) : [`cell ${index + 1}: ${cellType}`];
  });
}

function parseNotebook(content: string): { cells?: unknown[] } | null {
  try {
    const parsed = JSON.parse(content);
    return isRecord(parsed) ? parsed as { cells?: unknown[] } : null;
  } catch {
    return null;
  }
}

function normalizeNotebookSource(source: unknown): string {
  if (Array.isArray(source)) return source.map((item) => String(item)).join("");
  if (typeof source === "string") return source;
  return "";
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readImageMetadata(
  buffer: Buffer,
  extension: string,
): Record<string, string | number | boolean | null> {
  const dimensions = readImageDimensions(buffer, extension);
  return {
    format: extension.replace(/^\./, "").toUpperCase(),
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
  };
}

function readImageDimensions(
  buffer: Buffer,
  extension: string,
): { width: number; height: number } | null {
  if (extension === ".png" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (extension === ".gif" && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (extension === ".jpg" || extension === ".jpeg") return readJpegDimensions(buffer);
  if (extension === ".webp") return readWebpDimensions(buffer);
  if (extension === ".svg") return readSvgDimensions(buffer.toString("utf8", 0, Math.min(buffer.length, 4096)));
  return null;
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const size = buffer.readUInt16BE(offset + 2);
    if (size < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + size;
  }
  return null;
}

function readWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  const riff = buffer.subarray(0, 4).toString("ascii");
  const webp = buffer.subarray(8, 12).toString("ascii");
  if (riff !== "RIFF" || webp !== "WEBP") return null;
  const vp8xOffset = buffer.indexOf("VP8X");
  if (vp8xOffset >= 0 && vp8xOffset + 18 < buffer.length) {
    return {
      width: 1 + buffer.readUIntLE(vp8xOffset + 12, 3),
      height: 1 + buffer.readUIntLE(vp8xOffset + 15, 3),
    };
  }
  const vp8Offset = buffer.indexOf("VP8 ");
  if (vp8Offset >= 0 && vp8Offset + 30 < buffer.length) {
    return {
      width: buffer.readUInt16LE(vp8Offset + 14) & 0x3fff,
      height: buffer.readUInt16LE(vp8Offset + 16) & 0x3fff,
    };
  }
  return null;
}

function readSvgDimensions(svg: string): { width: number; height: number } | null {
  const width = Number.parseFloat(svg.match(/\bwidth=["']?([\d.]+)/i)?.[1] ?? "");
  const height = Number.parseFloat(svg.match(/\bheight=["']?([\d.]+)/i)?.[1] ?? "");
  if (Number.isFinite(width) && Number.isFinite(height)) return { width, height };
  const viewBox = svg.match(/\bviewBox=["']?[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)/i);
  if (!viewBox) return null;
  const viewBoxWidth = Number.parseFloat(viewBox[1] ?? "");
  const viewBoxHeight = Number.parseFloat(viewBox[2] ?? "");
  return Number.isFinite(viewBoxWidth) && Number.isFinite(viewBoxHeight)
    ? { width: viewBoxWidth, height: viewBoxHeight }
    : null;
}

async function extractPdfText(filePath: string, bytes: number): Promise<string> {
  const structured = await extractPresentationPdfContext(filePath, Math.max(bytes, 120_000));
  if (structured) return structured;
  const buffer = await readFileSlice(filePath, bytes);
  const raw = buffer.toString("latin1");
  const matches = [...raw.matchAll(/\(([^()]*)\)\s*T[jJ]/g)]
    .map((match) => decodePdfString(match[1] ?? ""))
    .filter(Boolean);
  return matches.join("\n").trim().slice(0, bytes);
}

async function extractOfficeText(
  filePath: string,
  extension: string,
  bytes: number,
): Promise<string> {
  if (![".docx", ".pptx", ".xlsx"].includes(extension)) return "";
  const buffer = await readFileSlice(filePath, Math.min(bytes, 8_000_000));
  const entries = extractZipEntries(buffer);
  const xmlParts = selectOfficeXmlParts(entries, extension);
  const text = xmlParts.map(extractXmlText).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.slice(0, bytes);
}

type ZipEntry = {
  name: string;
  data: Buffer;
};

function extractZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 < buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if ((flags & 0x08) !== 0 || compressedSize === 0 || dataEnd > buffer.length) {
      offset = Math.max(offset + 4, dataStart);
      continue;
    }

    const name = buffer.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const compressedData = buffer.subarray(dataStart, dataEnd);
    const data = inflateZipEntry(compressedData, method);
    if (data) entries.push({ name, data });
    offset = dataEnd;
  }
  return entries;
}

function inflateZipEntry(data: Buffer, method: number): Buffer | null {
  try {
    if (method === 0) return data;
    if (method === 8) return inflateRawSync(data);
  } catch {
    return null;
  }
  return null;
}

function selectOfficeXmlParts(entries: ZipEntry[], extension: string): string[] {
  return entries
    .filter((entry) => {
      if (extension === ".docx") {
        return /^word\/(document|footnotes|endnotes|comments|header\d*|footer\d*)\.xml$/.test(entry.name);
      }
      if (extension === ".pptx") return /^ppt\/slides\/slide\d+\.xml$/.test(entry.name);
      if (extension === ".xlsx") {
        return entry.name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name);
      }
      return false;
    })
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    .map((entry) => entry.data.toString("utf8"));
}

function extractXmlText(xml: string): string {
  const textRuns = [...xml.matchAll(/<(?:w:t|a:t|t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|a:t|t)>/g)]
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter(Boolean);
  if (textRuns.length > 0) return textRuns.join("\n");
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function decodePdfString(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .trim();
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  let suspicious = 0;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length > 0.08;
}

function parseDelimitedRows(content: string, delimiter: string): string[][] {
  return content
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 26)
    .map((line) => line.split(delimiter).slice(0, 20));
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function toSafeNumber(value: number | bigint | undefined): number | undefined {
  if (typeof value === "bigint") {
    return value > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(value);
  }
  return value;
}

function normalizeRel(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}

function runGit(cwd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout.trim() || null);
    });
  });
}

function runGitRaw(cwd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout, windowsHide: true, maxBuffer: 2_000_000 }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(stdout);
    });
  });
}

function runGitWithInput(
  cwd: string,
  args: string[],
  input: string,
  timeout: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = execFile("git", args, { cwd, timeout, windowsHide: true }, (error) => {
      resolve(!error);
    });
    child.stdin?.end(input);
  });
}
