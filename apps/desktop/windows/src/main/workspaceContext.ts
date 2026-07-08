import { execFile } from "child_process";
import { createReadStream, existsSync } from "fs";
import { readdir, readFile, realpath, stat } from "fs/promises";
import { createHash } from "crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { inflateRawSync } from "zlib";
import type {
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
      if (entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") && entry.name !== ".claude" && entry.name !== ".env.example") {
        if (entry.name !== ".env" && entry.name !== ".github") continue;
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
      const size = toSafeNumber(fileStat?.size) ?? 0;
      const extension = extname(entry.name).toLowerCase() || "(none)";
      extensionCounts.set(extension, (extensionCounts.get(extension) ?? 0) + 1);
      if (sampledFiles.length >= maxSampleFiles) continue;
      const kind = classifyPreviewKind(absolutePath, size);
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
    `Folders: ${directoryCount}`,
    skippedDirectoryCount ? `Skipped noisy folders: ${skippedDirectoryCount}` : "",
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
    truncated: truncated || rawSummary.length > maxChars,
    estimatedTokens: Math.ceil(summary.length / 4),
    sampledFiles,
    summary,
  };
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
    const pdfText = await extractPdfText(target, Math.min(fileStat.size, maxBytes));
    return {
      ...base,
      content: pdfText || undefined,
      message: pdfText
        ? "Extracted a basic text preview from the PDF."
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
  if (size > 2_000_000) return "large";
  const extension = extname(filePath).toLowerCase();
  if (extension in IMAGE_MIME) return "image";
  if (extension in MEDIA_MIME) return "media";
  if (extension === ".pdf") return "pdf";
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
