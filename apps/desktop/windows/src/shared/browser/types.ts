export type BrowserUrlScope = "local" | "workspace-file" | "public" | "blocked";

export interface BrowserUrlCheck {
  allowed: boolean;
  reason: string;
  normalizedUrl?: string;
  scope: BrowserUrlScope;
}

export type BrowserActionName =
  | "open"
  | "snapshot"
  | "screenshot"
  | "read_text"
  | "eval_readonly"
  | "click"
  | "type"
  | "select"
  | "key_press"
  | "wait_for"
  | "assert_text";

export interface BrowserActionRequest {
  action: BrowserActionName;
  url?: string;
  selector?: string;
  text?: string;
  value?: string;
  key?: string;
  script?: string;
  timeoutMs?: number;
  approved?: boolean;
  taskId?: string;
  actionId?: string;
}

export interface BrowserActionResult {
  ok: boolean;
  action: BrowserActionName;
  message: string;
  url?: string;
  actionId?: string;
  error?: string;
}

export interface BrowserPageState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  engine: "electron-webview" | "browser-use";
}

export interface BrowserSnapshotElement {
  selector: string;
  tag: string;
  role: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface BrowserSnapshot {
  title: string;
  url: string;
  viewport: { width: number; height: number; scrollX: number; scrollY: number };
  visibleText: string;
  structure: {
    headings: string[];
    buttons: string[];
    links: string[];
    inputs: string[];
    elements: BrowserSnapshotElement[];
  };
}

export interface BrowserScreenshot {
  url: string;
  title?: string;
  dataUrl: string;
  capturedAt: string;
}

export interface BrowserActionOptions {
  approved?: boolean;
  timeoutMs?: number;
  actionId?: string;
}

export type BrowserWaitTarget =
  | { kind: "selector"; selector: string; timeoutMs?: number }
  | { kind: "text"; text: string; timeoutMs?: number };

export interface BrowserActionLogEntry {
  id: string;
  timestamp: string;
  url?: string;
  action: BrowserActionName;
  target?: string;
  approved: boolean;
  ok: boolean;
  message: string;
  error?: string;
}

export interface BrowserTaskStartRequest {
  taskId?: string;
  instruction: string;
  url?: string;
  engine?: "electron-webview" | "browser-use";
  workspacePath?: string;
}

export interface BrowserTaskStopRequest {
  taskId: string;
}

export interface BrowserTaskApprovalRequest {
  taskId: string;
  actionId: string;
  approved: boolean;
}

export type BrowserTaskEvent =
  | { type: "task.started"; taskId: string; engine: "browser-use"; timestamp: string }
  | { type: "page.observed"; taskId: string; url: string; title?: string; timestamp: string }
  | {
      type: "action.proposed";
      taskId: string;
      actionId: string;
      action: BrowserActionName;
      target?: string;
      requiresApproval: boolean;
      timestamp: string;
    }
  | { type: "action.completed"; taskId: string; actionId: string; ok: boolean; message: string; timestamp: string }
  | { type: "screenshot"; taskId: string; dataUrl: string; timestamp: string }
  | { type: "task.completed"; taskId: string; result: string; timestamp: string }
  | { type: "task.failed"; taskId: string; error: string; timestamp: string }
  | { type: "task.cancelled"; taskId: string; timestamp: string };
