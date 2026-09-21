import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type {
  DesktopMcpContextItem,
  DesktopMcpContextRequest,
  DesktopMcpContextResult,
} from "../api/desktopApi";

const DEFAULT_MCP_CONTEXT_RELATIVE_PATH = join(".drsai", "mcp-context.json");
const MAX_MCP_CONTEXT_BYTES = 96 * 1024;
const MAX_MCP_CONTEXT_ITEMS = 12;
const MAX_MCP_CONTENT_CHARS = 12000;
const MAX_SELECTOR_CHARS = 180;

interface RawMcpContextFile {
  resources?: unknown;
  tools?: unknown;
  servers?: unknown;
}

interface NormalizedMcpRecord {
  server: string;
  name: string;
  title?: string;
  uri?: string;
  description?: string;
  content?: string;
  inputSchema?: unknown;
}

export function importMcpContext(
  request: DesktopMcpContextRequest,
): DesktopMcpContextResult {
  const workspacePath = resolveWorkspacePath(request.workspacePath);
  const kind = request.kind === "tool" ? "tool" : "resource";
  const limit = clampLimit(request.limit);
  const selector = normalizeSelector(request.selector);
  const sourcePath = resolveMcpContextPath(workspacePath);
  const parsed = readMcpContextFile(sourcePath);
  const records = normalizeMcpRecords(parsed, kind);
  const filtered = selector
    ? records.filter((record) => matchesSelector(record, selector))
    : records;
  const items = filtered.slice(0, limit).map((record) =>
    createMcpContextItem(kind, record),
  );
  return {
    workspacePath,
    importedAt: new Date().toISOString(),
    sourcePath,
    kind,
    items,
    truncated: filtered.length > items.length,
    message:
      items.length > 0
        ? `Prepared ${items.length} reviewed MCP ${kind} context item(s) from the workspace handoff.`
        : `No reviewed MCP ${kind} context matched the workspace handoff.`,
    verification:
      "MCP context import reads only a bounded workspace-local handoff file and does not connect to, enumerate, or execute an MCP server.",
  };
}

function resolveWorkspacePath(workspacePath: string): string {
  const resolved = resolve(sanitizeWorkspacePath(workspacePath));
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error("MCP context workspace path does not exist or is not a directory.");
  }
  return resolved;
}

function resolveMcpContextPath(workspacePath: string): string {
  const candidatePath = resolve(workspacePath, DEFAULT_MCP_CONTEXT_RELATIVE_PATH);
  if (!isInsideWorkspace(workspacePath, candidatePath)) {
    throw new Error("MCP context handoff must stay inside the workspace.");
  }
  if (!existsSync(candidatePath)) {
    throw new Error("MCP context handoff was not found at .drsai/mcp-context.json.");
  }
  const linkStats = lstatSync(candidatePath);
  if (linkStats.isSymbolicLink()) {
    throw new Error("MCP context handoff cannot be a symbolic link.");
  }
  const stats = statSync(candidatePath);
  if (!stats.isFile()) {
    throw new Error("MCP context handoff must be a file.");
  }
  if (stats.size > MAX_MCP_CONTEXT_BYTES) {
    throw new Error("MCP context handoff is too large to import.");
  }
  return candidatePath;
}

function readMcpContextFile(sourcePath: string): RawMcpContextFile {
  try {
    const parsed = JSON.parse(readFileSync(sourcePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      throw new Error("MCP context handoff must contain a JSON object.");
    }
    return parsed as RawMcpContextFile;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("MCP context handoff is not valid JSON.");
    }
    throw error;
  }
}

function normalizeMcpRecords(
  parsed: RawMcpContextFile,
  kind: DesktopMcpContextItem["kind"],
): NormalizedMcpRecord[] {
  const direct = kind === "resource" ? parsed.resources : parsed.tools;
  const records: NormalizedMcpRecord[] = [];
  records.push(...normalizeRecordArray(direct, "workspace"));
  if (parsed.servers && typeof parsed.servers === "object") {
    for (const [serverName, serverValue] of Object.entries(parsed.servers)) {
      if (!serverValue || typeof serverValue !== "object") continue;
      const serverObject = serverValue as RawMcpContextFile;
      const serverRecords = kind === "resource"
        ? serverObject.resources
        : serverObject.tools;
      records.push(...normalizeRecordArray(serverRecords, serverName));
    }
  }
  return records.slice(0, MAX_MCP_CONTEXT_ITEMS * 4);
}

function normalizeRecordArray(value: unknown, fallbackServer: string): NormalizedMcpRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeRecord(item, fallbackServer))
    .filter((item): item is NormalizedMcpRecord => Boolean(item));
}

function normalizeRecord(value: unknown, fallbackServer: string): NormalizedMcpRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const name = singleLine(record.name ?? record.id ?? record.uri, 160);
  if (!name) return null;
  return {
    server: singleLine(record.server, 120) || fallbackServer,
    name,
    title: singleLine(record.title ?? record.name, 180) || name,
    uri: singleLine(record.uri, 240) || undefined,
    description: singleLine(record.description, 1200) || undefined,
    content: multiline(record.content ?? record.text ?? record.summary, MAX_MCP_CONTENT_CHARS),
    inputSchema: record.inputSchema ?? record.input_schema ?? record.schema,
  };
}

function createMcpContextItem(
  kind: DesktopMcpContextItem["kind"],
  record: NormalizedMcpRecord,
): DesktopMcpContextItem {
  const schemaText = record.inputSchema
    ? clamp(JSON.stringify(record.inputSchema, null, 2), 4000)
    : "";
  const contentLines = [
    `MCP ${kind}: ${record.title ?? record.name}`,
    `Server: ${record.server}`,
    record.uri ? `URI: ${record.uri}` : null,
    record.description ? `Description: ${record.description}` : null,
    record.content ? ["", record.content].join("\n") : null,
    schemaText ? ["", "Input schema:", schemaText].join("\n") : null,
  ].filter((line): line is string => Boolean(line));
  const content = clamp(contentLines.join("\n"), MAX_MCP_CONTENT_CHARS);
  const identifier = [record.server, record.name].join(":");
  return {
    id: `mcp-${kind}:${hashPart(identifier)}`,
    kind,
    server: record.server,
    name: record.name,
    title: record.title ?? record.name,
    uri: record.uri,
    description: record.description,
    inputSchema: schemaText || undefined,
    content,
    truncated:
      content.length >= MAX_MCP_CONTENT_CHARS ||
      Boolean(record.content && record.content.length > MAX_MCP_CONTENT_CHARS),
  };
}

function matchesSelector(record: NormalizedMcpRecord, selector: string): boolean {
  const haystack = [
    record.server,
    record.name,
    record.title,
    record.uri,
    record.description,
  ]
    .filter((item): item is string => Boolean(item))
    .join("\n")
    .toLowerCase();
  return haystack.includes(selector.toLowerCase());
}

function sanitizeWorkspacePath(workspacePath: string): string {
  if (
    typeof workspacePath !== "string" ||
    !workspacePath.trim() ||
    workspacePath.length > 2048 ||
    /[\r\n]/.test(workspacePath)
  ) {
    throw new Error("MCP context workspace path is invalid.");
  }
  return workspacePath.trim();
}

function isInsideWorkspace(workspacePath: string, candidatePath: string): boolean {
  const relativePath = relative(workspacePath, candidatePath);
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !resolve(candidatePath).startsWith(`${resolve(workspacePath)}${sep}..`)
  );
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) return MAX_MCP_CONTEXT_ITEMS;
  return Math.max(1, Math.min(MAX_MCP_CONTEXT_ITEMS, Math.floor(Number(limit))));
}

function normalizeSelector(selector?: string): string {
  return singleLine(selector, MAX_SELECTOR_CHARS);
}

function singleLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function multiline(value: unknown, maxLength: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\r\n/g, "\n").trim().slice(0, maxLength);
}

function clamp(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

function hashPart(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
