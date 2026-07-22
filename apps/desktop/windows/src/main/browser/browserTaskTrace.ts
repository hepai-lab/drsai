import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type {
  BrowserTaskEvent,
  BrowserTaskStartRequest,
} from "../../../../shared/api/browser/types";

interface BrowserTaskTrace {
  taskId: string;
  instruction: string;
  url?: string;
  workspacePath?: string;
  engine: "browser-use";
  startedAt: string;
  updatedAt: string;
  events: BrowserTaskEvent[];
  screenshots: Array<{ dataUrl: string; timestamp: string }>;
  result?: string;
  failureReason?: string;
}

export function initializeBrowserTaskTrace(
  taskId: string,
  request: BrowserTaskStartRequest,
): void {
  const now = new Date().toISOString();
  writeTrace({
    taskId,
    instruction: request.instruction,
    url: request.url,
    workspacePath: request.workspacePath,
    engine: "browser-use",
    startedAt: now,
    updatedAt: now,
    events: [],
    screenshots: [],
  });
}

export function appendBrowserTaskTraceEvent(event: BrowserTaskEvent): void {
  const trace = readTrace(event.taskId);
  if (!trace) return;
  const updated: BrowserTaskTrace = {
    ...trace,
    updatedAt: event.timestamp,
    events: [...trace.events, event],
    screenshots:
      event.type === "screenshot"
        ? [...trace.screenshots, { dataUrl: event.dataUrl, timestamp: event.timestamp }]
        : trace.screenshots,
    result: event.type === "task.completed" ? event.result : trace.result,
    failureReason: event.type === "task.failed" ? event.error : trace.failureReason,
  };
  writeTrace(updated);
}

export function getBrowserTaskTraceDir(): string {
  return join(app.getPath("userData"), "browser-use", "traces");
}

function getTracePath(taskId: string): string {
  return join(getBrowserTaskTraceDir(), `${sanitizeTaskId(taskId)}.json`);
}

function readTrace(taskId: string): BrowserTaskTrace | null {
  const path = getTracePath(taskId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BrowserTaskTrace;
  } catch {
    return null;
  }
}

function writeTrace(trace: BrowserTaskTrace): void {
  const dir = getBrowserTaskTraceDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getTracePath(trace.taskId), JSON.stringify(trace, null, 2));
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "task";
}
