import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { DesktopMcpToolExecutionApprovalRequest, DesktopMcpToolExecutionApprovalResult } from "../api/desktopApi";
import { replaceFileSafely } from "./atomicFileReplace";

const CONFIG = join(".drsai", "mcp-servers.json");
const CONTEXT = join(".drsai", "mcp-context.json");
const AUDIT = join(".drsai", "mcp-execution-audit.json");
const MAX_CONFIG = 48 * 1024;
const MAX_OUTPUT = 256 * 1024;
const TIMEOUT = 15_000;

interface Server { name: string; command: string; args: string[]; cwd: string; env: Record<string, string> }

export function normalizeMcpToolExecutionRequest(raw: unknown): DesktopMcpToolExecutionApprovalRequest {
  if (!raw || typeof raw !== "object") throw new Error("MCP tool execution request must be an object.");
  const value = raw as Partial<DesktopMcpToolExecutionApprovalRequest>;
  const valid = (input: unknown, max: number) => typeof input === "string" && Boolean(input.trim()) && input.length <= max && !/[\r\n]/.test(input);
  if (!valid(value.workspacePath, 2_048) || !valid(value.server, 120) || !valid(value.tool, 160) || (value.input !== undefined && (typeof value.input !== "string" || value.input.length > 12_000))) throw new Error("MCP tool execution request is incomplete.");
  if (value.input) { const parsed = JSON.parse(value.input); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("MCP tool input must be a JSON object."); }
  return { workspacePath: value.workspacePath!.trim(), server: value.server!.trim(), tool: value.tool!.trim(), ...(value.input ? { input: value.input } : {}), ...(value.reuseSession ? { reuseSession: true } : {}) };
}

export async function executeApprovedMcpTool(request: DesktopMcpToolExecutionApprovalRequest, approvalId?: string): Promise<DesktopMcpToolExecutionApprovalResult> {
  const workspace = resolve(request.workspacePath);
  const server = await loadServer(workspace, request.server);
  const input = request.input ? JSON.parse(request.input) as Record<string, unknown> : {};
  const result = await call(server, request.tool, input);
  const executedAt = new Date().toISOString();
  const outputPreview = JSON.stringify(result, null, 2).slice(0, 12_000);
  const resultContextName = `${request.tool} result ${executedAt}`;
  const sourcePath = await writeContext(workspace, server.name, request.tool, input, outputPreview, resultContextName, executedAt);
  await appendAudit(workspace, { id: `mcp-audit:${randomUUID()}`, approvalId, server: server.name, tool: request.tool, status: "completed", sourcePath, resultContextName, executedAt, outputPreview });
  return { workspacePath: workspace, server: server.name, tool: request.tool, status: "completed", queued: false, blocked: false, allowed: true, sourcePath, resultContextName, outputPreview, reusedSession: false, executedAt, message: `Executed MCP tool ${server.name}/${request.tool}.`, verification: "The bounded stdio tools/call ran only through its explicit approval executor and wrote reviewed context plus audit evidence." };
}

async function loadServer(workspace: string, selector: string): Promise<Server> {
  const path = inside(workspace, resolve(workspace, CONFIG));
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG) throw new Error("MCP server config is unsafe or exceeds its limit.");
  const parsed = JSON.parse(await readFile(path, "utf8")) as { servers?: unknown };
  const entries = Array.isArray(parsed.servers) ? parsed.servers.map((value, index) => [String(index + 1), value] as const) : parsed.servers && typeof parsed.servers === "object" ? Object.entries(parsed.servers) : [];
  for (const [fallback, raw] of entries.slice(0, 8)) {
    if (!raw || typeof raw !== "object") continue;
    const value = raw as Record<string, unknown>;
    const name = typeof value.name === "string" ? value.name.trim().slice(0, 120) : fallback;
    if (!name.toLowerCase().includes(selector.toLowerCase())) continue;
    if (typeof value.command !== "string" || !value.command.trim() || /[\r\n]/.test(value.command) || value.command.length > 1_024) throw new Error("MCP server command is invalid.");
    const args = Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === "string" && arg.length <= 2_048 && !/[\r\n]/.test(arg)).slice(0, 24) : [];
    const cwd = typeof value.cwd === "string" && value.cwd.trim() ? inside(workspace, resolve(workspace, value.cwd)) : workspace;
    const env = value.env && typeof value.env === "object" && !Array.isArray(value.env) ? Object.fromEntries(Object.entries(value.env).filter(([key, val]) => /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) && typeof val === "string" && val.length <= 4_096)) as Record<string, string> : {};
    return { name, command: value.command.trim(), args, cwd, env };
  }
  throw new Error("No configured MCP server matched the tool execution request.");
}

function call(server: Server, tool: string, input: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(server.command, server.args, { cwd: server.cwd, env: { ...process.env, ...server.env }, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (callback: () => void) => { if (settled) return; settled = true; clearTimeout(timer); callback(); };
    const timer = setTimeout(() => { child.kill(); finish(() => rejectPromise(new Error("MCP tool execution timed out."))); }, TIMEOUT);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); if (stdout.length > MAX_OUTPUT) { child.kill(); finish(() => rejectPromise(new Error("MCP tool execution output exceeded the safety limit."))); } });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000); });
    child.on("error", (error) => finish(() => rejectPromise(error)));
    child.on("exit", () => finish(() => {
      const messages = stdout.split(/\r?\n/).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean) as Array<{ id?: unknown; result?: unknown; error?: unknown }>;
      const response = messages.find((item) => item.id === 4);
      if (response?.error) rejectPromise(new Error(`MCP tool execution failed: ${JSON.stringify(response.error).slice(0, 1_000)}`));
      else if (response && "result" in response) resolvePromise(response.result);
      else rejectPromise(new Error(stderr.trim() ? `MCP tool execution produced no result: ${stderr.trim()}` : "MCP tool execution produced no result."));
    }));
    child.stdin.end([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "opendrsai-desktop", version: "1.5.2" } } },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: tool, arguments: input } },
    ].map((value) => JSON.stringify(value)).join("\n") + "\n");
  });
}

async function writeContext(workspace: string, server: string, tool: string, input: Record<string, unknown>, output: string, name: string, at: string): Promise<string> {
  const path = inside(workspace, resolve(workspace, CONTEXT)); await ensureSafeTarget(path); await mkdir(dirname(path), { recursive: true });
  let existing: Record<string, unknown> = {}; try { const info = await stat(path); if (info.size <= MAX_CONFIG) existing = JSON.parse(await readFile(path, "utf8")); } catch { /* new context */ }
  const servers = existing.servers && typeof existing.servers === "object" && !Array.isArray(existing.servers) ? { ...existing.servers as Record<string, unknown> } : {};
  const record = servers[server] && typeof servers[server] === "object" && !Array.isArray(servers[server]) ? { ...servers[server] as Record<string, unknown> } : {};
  const prior = Array.isArray(record.tools) ? record.tools : [];
  record.tools = [{ server, name, title: name, description: `Reviewed result from approved MCP tools/call ${server}/${tool}.`, content: `MCP tool result: ${tool}\nExecuted at: ${at}\n\nInput:\n${JSON.stringify(input, null, 2)}\n\nOutput:\n${output}`, generatedBy: "desktop-approved-mcp-tool-execution" }, ...prior].slice(0, 24);
  servers[server] = record; await atomicJson(path, { ...existing, version: 1, generatedBy: "desktop-mcp-reviewed-handoff", servers }); return path;
}
async function appendAudit(workspace: string, entry: Record<string, unknown>): Promise<void> { const path = inside(workspace, resolve(workspace, AUDIT)); await ensureSafeTarget(path); let entries: unknown[] = []; try { const parsed = JSON.parse(await readFile(path, "utf8")); entries = Array.isArray(parsed) ? parsed : []; } catch { /* new audit */ } await atomicJson(path, [entry, ...entries].slice(0, 60)); }
async function ensureSafeTarget(path: string): Promise<void> { try { if ((await lstat(path)).isSymbolicLink()) throw new Error("MCP output target cannot be a symbolic link."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
async function atomicJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await replaceFileSafely(temp, path); } finally { await rm(temp, { force: true }); } }
function inside(root: string, target: string): string { const rel = relative(root, target); if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("MCP path must stay inside the workspace."); return target; }
