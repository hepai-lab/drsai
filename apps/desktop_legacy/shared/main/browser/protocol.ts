import { randomUUID } from "node:crypto";
import type { BrowserActionName, BrowserTaskEvent, BrowserTaskStartRequest } from "../../api/browser/types";

export type BrowserUseWorkerCommand =
  | {
      type: "task.start";
      taskId: string;
      instruction: string;
      url?: string;
      workspacePath?: string;
      policy: Record<string, unknown>;
    }
  | { type: "action.approve"; taskId: string; actionId: string; approved: boolean }
  | { type: "task.stop"; taskId: string };

export function createBrowserUseTaskCommand(
  request: BrowserTaskStartRequest,
  taskId = request.taskId || randomUUID(),
): BrowserUseWorkerCommand {
  return {
    type: "task.start",
    taskId,
    instruction: request.instruction,
    url: request.url,
    workspacePath: request.workspacePath,
    policy: {
      requireApprovalForSideEffects: true,
      requireApprovalForSensitiveOperations: true,
      sensitiveOperations: [
        "form submission",
        "checkout/payment",
        "login/auth",
        "send message/email",
        "file upload/download",
        "account/settings change",
        "cross-origin data transfer",
      ],
      isolateProfile: true,
    },
  };
}

export function parseBrowserUseWorkerEvent(line: string): BrowserTaskEvent {
  const parsed = JSON.parse(line) as Partial<BrowserTaskEvent> & {
    type?: string;
    taskId?: string;
    action?: BrowserActionName;
  };
  if (!parsed.type || !parsed.taskId) {
    throw new Error("Invalid browser-use worker event.");
  }
  if (
    parsed.type !== "task.started" &&
    parsed.type !== "page.observed" &&
    parsed.type !== "action.proposed" &&
    parsed.type !== "action.completed" &&
    parsed.type !== "screenshot" &&
    parsed.type !== "task.completed" &&
    parsed.type !== "task.failed" &&
    parsed.type !== "task.cancelled"
  ) {
    throw new Error(`Unsupported browser-use worker event: ${parsed.type}`);
  }
  return {
    ...parsed,
    timestamp: parsed.timestamp || new Date().toISOString(),
  } as BrowserTaskEvent;
}

export function serializeBrowserUseWorkerCommand(command: BrowserUseWorkerCommand): string {
  return `${JSON.stringify(command)}\n`;
}
