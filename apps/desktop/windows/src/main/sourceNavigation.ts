import { readFile, realpath, stat } from "fs/promises";
import { createHash } from "crypto";
import { SourceMap, type SourceMapPayload } from "module";
import { dirname, extname, isAbsolute, relative, resolve } from "path";
import { pathToFileURL } from "url";
import type { WorkspaceFilePreview, WorkspaceProject } from "../shared/desktopApi";
import type {
  DiagnosticSourceAddress,
  DiagnosticSourceContext,
  DiagnosticSourceContextRequest,
  DiagnosticSourceLocation,
  DiagnosticSourceMapping,
} from "../shared/diagnostics";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const DEFAULT_CONTEXT_LINES = 8;
const MAX_CONTEXT_LINES = 30;
const MAX_RENDERED_LINE_CHARS = 4_000;

interface SourceNavigatorOptions {
  appRoot: string;
  listWorkspaces: () => Promise<WorkspaceProject[]>;
  previewLocal: (request: { workspacePath: string; workspaceId?: string; path: string; maxBytes: number }) => Promise<WorkspaceFilePreview>;
  previewRemote: (request: { workspacePath: string; workspaceId?: string; path: string; maxBytes: number }) => Promise<WorkspaceFilePreview>;
}

interface ResolvedSource {
  address: DiagnosticSourceAddress;
  workspace?: WorkspaceProject;
  localPath?: string;
}

interface CachedMap {
  key: string;
  payload: SourceMapPayload;
  map: SourceMap;
}

export class DiagnosticSourceNavigator {
  private readonly mapCache = new Map<string, CachedMap>();

  constructor(private readonly options: SourceNavigatorOptions) {}

  async context(request: DiagnosticSourceContextRequest): Promise<DiagnosticSourceContext> {
    const generated = normalizeLocation(request?.source);
    const generatedResolved = await this.resolveAddress(generated, request?.workspaceId);
    const mapping = request?.preferOriginal === false
      ? noMapping(generated)
      : await this.mapLocation(generatedResolved, generated);
    const location = mapping.original ?? generated;
    const resolved = mapping.original
      ? await this.resolveAddress(location, request?.workspaceId)
      : generatedResolved;
    const embedded = mapping.original ? await this.embeddedSource(generatedResolved, mapping.original) : undefined;
    const contextLines = clamp(request?.contextLines, 0, MAX_CONTEXT_LINES, DEFAULT_CONTEXT_LINES);

    try {
      const sourceText = embedded ?? await this.readResolved(resolved);
      if (sourceText === undefined) {
        return unavailable(resolved.address, mapping, location, "Source is unavailable or outside registered application and workspace roots.");
      }
      if (sourceText.includes("\u0000")) {
        return unavailable(resolved.address, mapping, location, "Binary source files cannot be displayed.");
      }
      const lines = sourceText.replace(/\r\n/g, "\n").split("\n");
      const requestedLine = clamp(location.line, 1, Math.max(1, lines.length), 1);
      const startLine = Math.max(1, requestedLine - contextLines);
      const endLine = Math.min(lines.length, requestedLine + contextLines);
      const raw = lines.slice(startLine - 1, endLine).map((line) => line.slice(0, MAX_RENDERED_LINE_CHARS)).join("\n");
      const sanitized = redactSource(raw);
      const version = createHash("sha256").update(sourceText).digest("hex");
      return {
        available: true,
        address: { ...resolved.address, available: true, version },
        mapping,
        location,
        content: sanitized.text,
        startLine,
        endLine,
        highlightLine: requestedLine,
        language: location.language ?? languageForFile(location.file),
        truncated: sourceText.length >= MAX_SOURCE_BYTES || lines.some((line) => line.length > MAX_RENDERED_LINE_CHARS),
        redacted: sanitized.redacted,
        canOpen: Boolean(resolved.localPath),
      };
    } catch (error) {
      return unavailable(resolved.address, mapping, location, safeError(error));
    }
  }

  async resolveOpenPath(request: DiagnosticSourceContextRequest): Promise<{ path?: string; line?: number; column?: number; message: string }> {
    const context = await this.context(request);
    if (!context.available) return { message: context.reason ?? "Source is unavailable." };
    const resolved = await this.resolveAddress(context.location, request.workspaceId);
    if (!resolved.localPath) {
      return { line: context.location.line, column: context.location.column, message: "Remote source is available in the built-in viewer but cannot be opened by a local system editor." };
    }
    return {
      path: resolved.localPath,
      line: context.location.line,
      column: context.location.column,
      message: "Source path resolved.",
    };
  }

  private async resolveAddress(location: DiagnosticSourceLocation, workspaceId?: string): Promise<ResolvedSource> {
    const rawFile = normalizeFile(location.file);
    const workspaces = await this.options.listWorkspaces();
    const requestedWorkspace = workspaceId ? workspaces.find((item) => item.id === workspaceId) : undefined;
    const workspace = requestedWorkspace ?? workspaces.find((item) => pathBelongsTo(rawFile, item.path));

    if (workspace?.location === "remote") {
      const relativePath = makeRelativeRemote(workspace.path, rawFile);
      return {
        workspace,
        address: {
          ...location,
          file: rawFile,
          kind: "remote",
          uri: `opendrsai-remote://${encodeURIComponent(workspace.id)}/${relativePath.replace(/\\/g, "/")}`,
          workspaceId: workspace.id,
          relativePath,
          available: true,
          trusted: workspace.trusted,
          remote: true,
        },
      };
    }

    const candidate = await resolveLocalCandidate(rawFile, requestedWorkspace?.path, this.options.appRoot);
    const allowedWorkspace = workspaces.find((item) => item.location === "local" && containsPath(item.path, candidate));
    const withinApp = containsPath(this.options.appRoot, candidate);
    const allowed = withinApp || Boolean(allowedWorkspace);
    const kind = allowedWorkspace ? "workspace"
      : withinApp ? (isGeneratedFile(candidate) ? "generated" : "package")
      : location.language === "python" ? "python"
      : "unknown";
    return {
      workspace: allowedWorkspace,
      localPath: allowed ? candidate : undefined,
      address: {
        ...location,
        file: rawFile || candidate,
        kind,
        uri: allowed ? pathToFileURL(candidate).href : `opendrsai-source:${encodeURIComponent(rawFile)}`,
        ...(allowedWorkspace ? { workspaceId: allowedWorkspace.id, relativePath: relative(allowedWorkspace.path, candidate).replace(/\\/g, "/") } : {}),
        available: allowed,
        trusted: withinApp || Boolean(allowedWorkspace?.trusted),
        remote: false,
      },
    };
  }

  private async readResolved(resolved: ResolvedSource): Promise<string | undefined> {
    if (resolved.workspace?.location === "remote") {
      const preview = await this.options.previewRemote({
        workspacePath: resolved.workspace.path,
        workspaceId: resolved.workspace.id,
        path: resolved.address.file ?? resolved.address.relativePath ?? "",
        maxBytes: MAX_SOURCE_BYTES,
      });
      return preview.content;
    }
    if (resolved.workspace && resolved.localPath) {
      const preview = await this.options.previewLocal({
        workspacePath: resolved.workspace.path,
        workspaceId: resolved.workspace.id,
        path: resolved.localPath,
        maxBytes: MAX_SOURCE_BYTES,
      });
      return preview.content;
    }
    if (!resolved.localPath) return undefined;
    const info = await stat(resolved.localPath);
    if (!info.isFile()) return undefined;
    if (info.size > MAX_SOURCE_BYTES) throw new Error("Source file exceeds the 2 MB diagnostic preview limit.");
    return readFile(resolved.localPath, "utf8");
  }

  private async mapLocation(resolved: ResolvedSource, generated: DiagnosticSourceLocation): Promise<DiagnosticSourceMapping> {
    if (!resolved.localPath || !generated.file || !isGeneratedFile(generated.file)) return noMapping(generated);
    try {
      const cached = await this.loadMap(resolved.localPath);
      if (!cached) return { status: "missing", generated, message: "No Source Map was found for the generated file." };
      const origin = cached.map.findOrigin(generated.line ?? 1, generated.column ?? 1);
      if (!("fileName" in origin)) {
        return { status: "invalid", generated, mapFile: cached.key, message: "The Source Map does not contain this generated position." };
      }
      const originalFile = resolveMappedFile(cached.key, cached.payload.sourceRoot, origin.fileName);
      return {
        status: "mapped",
        generated,
        original: {
          file: originalFile,
          function: generated.function,
          line: origin.lineNumber,
          column: origin.columnNumber,
          language: languageForFile(originalFile),
        },
        mapFile: cached.key,
        message: "Generated position mapped to original source.",
      };
    } catch (error) {
      return { status: "invalid", generated, message: `Source Map could not be read: ${safeError(error)}` };
    }
  }

  private async loadMap(generatedPath: string): Promise<CachedMap | undefined> {
    const mapFile = `${generatedPath}.map`;
    let mapText: string;
    try {
      const info = await stat(mapFile);
      const key = `${mapFile}:${info.size}:${info.mtimeMs}`;
      const existing = this.mapCache.get(generatedPath);
      if (existing?.key === key) return existing;
      if (info.size > MAX_SOURCE_BYTES * 4) throw new Error("Source Map exceeds the 8 MB limit.");
      mapText = await readFile(mapFile, "utf8");
      const payload = validateSourceMap(JSON.parse(mapText));
      const cached = { key: mapFile, payload, map: new SourceMap(payload) };
      this.mapCache.set(generatedPath, cached);
      return cached;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const generatedText = await readFile(generatedPath, "utf8");
    const inline = /sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)/.exec(generatedText.slice(-64 * 1024));
    if (!inline) return undefined;
    mapText = Buffer.from(inline[1], "base64").toString("utf8");
    const payload = validateSourceMap(JSON.parse(mapText));
    const key = `${generatedPath}#inline`;
    const cached = { key, payload, map: new SourceMap(payload) };
    this.mapCache.set(generatedPath, cached);
    return cached;
  }

  private async embeddedSource(generated: ResolvedSource, original: DiagnosticSourceLocation): Promise<string | undefined> {
    if (!generated.localPath) return undefined;
    try {
      const cached = await this.loadMap(generated.localPath);
      if (!cached) return undefined;
      const normalizedOriginal = normalizeFile(original.file);
      const index = cached.payload.sources.findIndex((source) => {
        const mapped = resolveMappedFile(cached.key, cached.payload.sourceRoot, source);
        return normalizeFile(mapped).toLowerCase() === normalizedOriginal.toLowerCase();
      });
      return index >= 0 ? cached.payload.sourcesContent?.[index] : undefined;
    } catch {
      return undefined;
    }
  }
}

function unavailable(address: DiagnosticSourceAddress, mapping: DiagnosticSourceMapping, location: DiagnosticSourceLocation, reason: string): DiagnosticSourceContext {
  return {
    available: false,
    reason,
    address: { ...address, available: false },
    mapping,
    location,
    language: location.language ?? languageForFile(location.file),
    truncated: false,
    redacted: false,
    canOpen: false,
  };
}

function noMapping(generated: DiagnosticSourceLocation): DiagnosticSourceMapping {
  return { status: "not-required", generated, message: "The reported location already refers to source code." };
}

function normalizeLocation(input: DiagnosticSourceLocation | undefined): DiagnosticSourceLocation {
  return {
    file: normalizeFile(input?.file),
    function: input?.function?.slice(0, 500),
    line: clamp(input?.line, 1, 10_000_000, 1),
    column: clamp(input?.column, 1, 1_000_000, 1),
    language: input?.language ?? languageForFile(input?.file),
  };
}

function normalizeFile(file: string | undefined): string {
  return String(file ?? "").trim().replace(/^file:\/\//i, "").replace(/^webpack:\/\/\/?/i, "");
}

async function resolveLocalCandidate(file: string, workspacePath: string | undefined, appRoot: string): Promise<string> {
  const candidate = isAbsolute(file) ? resolve(file) : resolve(workspacePath ?? appRoot, file);
  try { return await realpath(candidate); } catch { return candidate; }
}

function containsPath(root: string, candidate: string): boolean {
  if (!root || !candidate) return false;
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function pathBelongsTo(file: string, root: string): boolean {
  if (!file || !root) return false;
  const normalizedFile = file.replace(/\\/g, "/").toLowerCase();
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(`${normalizedRoot}/`);
}

function makeRelativeRemote(root: string, file: string): string {
  if (!file) return "";
  return pathBelongsTo(file, root) ? file.slice(root.length).replace(/^[/\\]+/, "") : file.replace(/^[/\\]+/, "");
}

function isGeneratedFile(file: string): boolean {
  return /\.(?:m?js|cjs)$/i.test(file) || /[/\\]out[/\\]|[/\\]dist[/\\]|[/\\]build[/\\]/i.test(file);
}

function resolveMappedFile(mapKey: string, sourceRoot: string | undefined, source: string): string {
  const cleaned = decodeURIComponent(source)
    .replace(/^webpack:\/\/\/?/i, "")
    .replace(/^vite:\/\/\/?/i, "")
    .replace(/^file:\/\/\/?/i, "");
  if (isAbsolute(cleaned)) return resolve(cleaned);
  const base = mapKey.endsWith("#inline") ? dirname(mapKey.slice(0, -7)) : dirname(mapKey);
  return resolve(base, sourceRoot ?? "", cleaned);
}

function validateSourceMap(value: unknown): SourceMapPayload {
  if (!value || typeof value !== "object") throw new Error("Source Map payload must be an object.");
  const map = value as Partial<SourceMapPayload>;
  if (map.version !== 3 || !Array.isArray(map.sources) || typeof map.mappings !== "string") {
    throw new Error("Unsupported Source Map schema.");
  }
  return {
    version: 3,
    file: typeof map.file === "string" ? map.file : "",
    sources: map.sources.map(String),
    sourcesContent: Array.isArray(map.sourcesContent) ? map.sourcesContent.map((item) => String(item ?? "")) : [],
    names: Array.isArray(map.names) ? map.names.map(String) : [],
    mappings: map.mappings,
    sourceRoot: typeof map.sourceRoot === "string" ? map.sourceRoot : "",
  };
}

function languageForFile(file: string | undefined): DiagnosticSourceLocation["language"] {
  const extension = extname(file ?? "").toLowerCase();
  if ([".ts", ".tsx", ".mts", ".cts"].includes(extension)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) return "javascript";
  if (extension === ".py") return "python";
  return "unknown";
}

function redactSource(value: string): { text: string; redacted: boolean } {
  let text = value;
  const patterns: RegExp[] = [
    /\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
    /\b(api[_-]?key|token|password|secret|cookie)(\s*[:=]\s*)["']?[^\s,"';]+/gi,
  ];
  for (const pattern of patterns) text = text.replace(pattern, (_match, prefix: string, separator?: string) => `${prefix}${separator ?? ""}[REDACTED]`);
  return { text, redacted: text !== value };
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value as number))) : fallback;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:[A-Za-z]:)?[\\/](?:Users|home)[\\/][^\\/\s]+/gi, "$HOME").slice(0, 1_000);
}
