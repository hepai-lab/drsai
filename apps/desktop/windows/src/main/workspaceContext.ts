import { execFile } from "child_process";
import { existsSync } from "fs";
import { readdir, readFile, realpath, stat } from "fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";
import type {
  WorkspaceContextOverview,
  WorkspaceFileGitStatus,
  WorkspaceFileNode,
  WorkspaceFilePreview,
  WorkspaceFilePreviewRequest,
  WorkspaceFileTreeRequest,
  WorkspaceFileTreeResult,
  WorkspaceGitDiffRequest,
  WorkspaceGitDiffResult,
  WorkspaceGitStatus,
  WorkspaceInstructionSummary,
  WorkspacePreviewKind,
} from "../shared/desktopApi";

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_PREVIEW_BYTES = 120_000;
const DEFAULT_DIFF_CHARS = 80_000;
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

export async function previewWorkspaceFile(
  rawRequest: unknown,
): Promise<WorkspaceFilePreview> {
  const request = validatePreviewRequest(rawRequest);
  const workspacePath = await resolveWorkspaceRoot(request.workspacePath);
  const target = await resolveInsideWorkspace(workspacePath, request.path);
  const fileStat = await stat(target);
  if (!fileStat.isFile()) throw new Error("Workspace preview target must be a file.");

  const maxBytes = clampInt(request.maxBytes, 8_000, 500_000, DEFAULT_PREVIEW_BYTES);
  const extension = extname(target).toLowerCase();
  const relativePath = normalizeRel(relative(workspacePath, target));
  const name = basename(target);
  const kind = classifyPreviewKind(target, fileStat.size);
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
  };

  if (kind === "image") {
    if (fileStat.size <= MAX_IMAGE_DATA_URL_BYTES) {
      const buffer = await readFile(target);
      return {
        ...base,
        dataUrl: `data:${base.mime};base64,${buffer.toString("base64")}`,
      };
    }
    return {
      ...base,
      message: "Image is large; preview shows metadata only.",
    };
  }

  if (
    kind === "pdf" ||
    kind === "office" ||
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
  const args = ["diff", "--"];
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
    truncated: diff.length > maxChars,
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

function validatePreviewRequest(rawRequest: unknown): WorkspaceFilePreviewRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace file preview request is invalid.");
  const request = rawRequest as Partial<WorkspaceFilePreviewRequest>;
  return {
    workspacePath: String(request.workspacePath ?? ""),
    path: String(request.path ?? ""),
    maxBytes: typeof request.maxBytes === "number" ? request.maxBytes : undefined,
  };
}

function validateDiffRequest(rawRequest: unknown): WorkspaceGitDiffRequest {
  if (!rawRequest || typeof rawRequest !== "object") throw new Error("Workspace git diff request is invalid.");
  const request = rawRequest as Partial<WorkspaceGitDiffRequest>;
  return {
    workspacePath: String(request.workspacePath ?? ""),
    path: typeof request.path === "string" ? request.path : undefined,
    maxChars: typeof request.maxChars === "number" ? request.maxChars : undefined,
  };
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
  if (extension === ".pdf") return "pdf";
  if (OFFICE_EXTENSIONS.has(extension)) return "office";
  if (extension === ".md" || extension === ".mdx") return "markdown";
  if (extension === ".json") return "json";
  if (extension === ".yaml" || extension === ".yml" || extension === ".toml") return "structured";
  if (extension === ".csv" || extension === ".tsv") return "table";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (TEXT_EXTENSIONS.has(extension) || extension === "") return "text";
  return "unknown";
}

function getMime(extension: string, kind: WorkspacePreviewKind): string {
  if (extension in IMAGE_MIME) return IMAGE_MIME[extension];
  if (kind === "json") return "application/json";
  if (kind === "markdown") return "text/markdown";
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
