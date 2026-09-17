import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrowserActionResult, BrowserTaskApprovalRequest, BrowserTaskEvent, BrowserTaskStartRequest, BrowserTaskStopRequest } from "../../api/browser/types";
import { replaceFileSafely } from "../atomicFileReplace";
import { approveBrowserActionRequest } from "./actionApproval";
import { createBrowserUseTaskCommand } from "./protocol";
import { checkBrowserUrlSync } from "./urlPolicy";
import { BrowserUseWorkerClient, type BrowserWorkerStartOptions } from "./workerClient";

type Proposed = Extract<BrowserTaskEvent, { type: "action.proposed" }>;
interface Trace { taskId: string; instruction: string; url?: string; workspacePath?: string; startedAt: string; updatedAt: string; events: BrowserTaskEvent[]; result?: string; failureReason?: string; }
export interface BrowserTaskServiceOptions {
  worker: BrowserUseWorkerClient;
  workerOptions: () => Promise<BrowserWorkerStartOptions> | BrowserWorkerStartOptions;
  traceRoot: string;
  publish: (event: BrowserTaskEvent) => void;
  recordError?: (message: string) => void;
}

export class BrowserTaskService {
  readonly #pending = new Map<string, Proposed>();
  readonly #active = new Set<string>();
  readonly #options: BrowserTaskServiceOptions;
  #traceQueue = Promise.resolve();
  constructor(options: BrowserTaskServiceOptions) {
    this.#options = options;
    options.worker.on("event", (event: BrowserTaskEvent) => this.#onEvent(event));
    options.worker.on("error-line", (line: string) => options.recordError?.(line));
    options.worker.on("exit", () => this.#cancelAllAfterWorkerExit());
  }
  checkUrl(raw: unknown) { return checkBrowserUrlSync(raw); }
  requestAction(raw: unknown): BrowserActionResult { return approveBrowserActionRequest(raw); }
  async start(raw: unknown): Promise<{ taskId: string }> {
    const request = validateStart(raw);
    if (request.url) {
      const check = checkBrowserUrlSync(request.url);
      if (!check.allowed || !check.normalizedUrl) throw new Error(check.reason);
      request.url = check.normalizedUrl;
    }
    this.#options.worker.start(await this.#options.workerOptions());
    const command = createBrowserUseTaskCommand(request);
    if (this.#active.has(command.taskId)) throw new Error("Browser task id is already active.");
    this.#active.add(command.taskId);
    await this.#writeTrace({ taskId: command.taskId, instruction: request.instruction, ...(request.url ? { url: request.url } : {}), ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}), startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [] });
    try { this.#options.worker.send(command); } catch (error) { this.#active.delete(command.taskId); throw error; }
    return { taskId: command.taskId };
  }
  stop(raw: unknown): boolean {
    const request = validateStop(raw);
    if (!this.#active.has(request.taskId)) return false;
    this.#options.worker.send({ type: "task.stop", taskId: request.taskId });
    return true;
  }
  pendingApprovals(): Proposed[] { return [...this.#pending.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).map((item) => ({ ...item })); }
  approve(raw: unknown): boolean {
    const request = validateApproval(raw);
    const proposal = this.#pending.get(request.actionId);
    if (!proposal || proposal.taskId !== request.taskId || !this.#active.has(request.taskId)) return false;
    this.#pending.delete(request.actionId);
    this.#options.worker.send({ type: "action.approve", ...request });
    return true;
  }
  shutdown(): void { this.#options.worker.stop(); this.#active.clear(); this.#pending.clear(); }
  #onEvent(event: BrowserTaskEvent): void {
    if (event.type === "action.proposed" && event.requiresApproval) this.#pending.set(event.actionId, event);
    if (event.type === "action.completed") this.#pending.delete(event.actionId);
    if (["task.completed", "task.failed", "task.cancelled"].includes(event.type)) {
      this.#active.delete(event.taskId);
      for (const [id, proposal] of this.#pending) if (proposal.taskId === event.taskId) this.#pending.delete(id);
    }
    this.#traceQueue = this.#traceQueue.catch(() => undefined).then(() => this.#appendTrace(event));
    this.#options.publish(event);
  }
  #cancelAllAfterWorkerExit(): void {
    const timestamp = new Date().toISOString();
    for (const taskId of [...this.#active]) this.#onEvent({ type: "task.failed", taskId, error: "browser-use worker exited before the task completed.", timestamp });
  }
  async #appendTrace(event: BrowserTaskEvent): Promise<void> {
    const path = this.#tracePath(event.taskId);
    let trace: Trace;
    try { trace = JSON.parse(await readFile(path, "utf8")); } catch { return; }
    const next: Trace = { ...trace, updatedAt: event.timestamp, events: [...trace.events, event].slice(-1000), ...(event.type === "task.completed" ? { result: event.result } : {}), ...(event.type === "task.failed" ? { failureReason: event.error } : {}) };
    await this.#writeTrace(next);
  }
  async #writeTrace(trace: Trace): Promise<void> {
    const path = this.#tracePath(trace.taskId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.tmp`;
    try { await writeFile(temporary, `${JSON.stringify(trace, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await replaceFileSafely(temporary, path); await chmod(path, 0o600).catch(() => undefined); }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }
  #tracePath(taskId: string): string { return join(this.#options.traceRoot, `${taskId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120)}.json`); }
}

function validateStart(raw: unknown): BrowserTaskStartRequest {
  if (!raw || typeof raw !== "object") throw new Error("Invalid browser task start request.");
  const row = raw as Partial<BrowserTaskStartRequest>;
  if (typeof row.instruction !== "string" || !row.instruction.trim() || row.instruction.length > 8000) throw new Error("Invalid browser task instruction.");
  const text = (value: unknown, label: string, max: number): string | undefined => value === undefined ? undefined : typeof value === "string" && value.trim() && value.length <= max && !/[\0\r\n]/.test(value) ? value.trim() : (() => { throw new Error(`Invalid browser task ${label}.`); })();
  const taskId = row.taskId === undefined ? undefined : id(row.taskId, "task");
  const url = text(row.url, "URL", 4096);
  const workspacePath = text(row.workspacePath, "Workspace path", 4096);
  return { instruction: row.instruction.trim(), ...(taskId ? { taskId } : {}), ...(url ? { url } : {}), ...(workspacePath ? { workspacePath } : {}), engine: "browser-use" };
}
function validateStop(raw: unknown): BrowserTaskStopRequest { const taskId = id((raw as { taskId?: unknown })?.taskId, "task"); return { taskId }; }
function validateApproval(raw: unknown): BrowserTaskApprovalRequest { const row = raw as Partial<BrowserTaskApprovalRequest>; if (typeof row?.approved !== "boolean") throw new Error("Invalid browser task approval decision."); return { taskId: id(row.taskId, "task"), actionId: id(row.actionId, "action"), approved: row.approved }; }
function id(value: unknown, label: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_:-]{0,159}$/.test(value)) throw new Error(`Invalid browser ${label} id.`); return value; }
