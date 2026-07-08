import type { BrowserActionName, BrowserActionRequest, BrowserActionResult } from "./types";
import {
  createExecutionPolicy,
  evaluateExecutionPermission,
  type ExecutionActionKind,
} from "../executionPolicy";

const READ_ONLY_ACTIONS = new Set<BrowserActionName>([
  "open",
  "snapshot",
  "screenshot",
  "read_text",
  "eval_readonly",
  "wait_for",
  "assert_text",
]);

const SIDE_EFFECT_ACTIONS = new Set<BrowserActionName>([
  "click",
  "type",
  "select",
  "key_press",
]);

const BROWSER_EXECUTION_ACTIONS: Record<BrowserActionName, ExecutionActionKind> = {
  open: "browser.read",
  snapshot: "browser.read",
  screenshot: "browser.read",
  read_text: "browser.read",
  eval_readonly: "browser.read",
  click: "browser.interact",
  type: "browser.interact",
  select: "browser.interact",
  key_press: "browser.interact",
  wait_for: "browser.read",
  assert_text: "browser.read",
};

const SENSITIVE_TARGET_PATTERNS = [
  /submit/i,
  /checkout/i,
  /payment/i,
  /pay\b/i,
  /login/i,
  /sign[\s_-]?in/i,
  /send/i,
  /email/i,
  /upload/i,
  /download/i,
  /account/i,
  /settings/i,
  /cross[\s_-]?origin/i,
];

export const BROWSER_ACTIONS: BrowserActionName[] = [
  "open",
  "snapshot",
  "screenshot",
  "read_text",
  "eval_readonly",
  "click",
  "type",
  "select",
  "key_press",
  "wait_for",
  "assert_text",
];

export function isBrowserActionName(value: unknown): value is BrowserActionName {
  return typeof value === "string" && BROWSER_ACTIONS.includes(value as BrowserActionName);
}

export function isReadOnlyBrowserAction(action: BrowserActionName): boolean {
  return READ_ONLY_ACTIONS.has(action);
}

export function browserActionRequiresApproval(action: BrowserActionName): boolean {
  const decision = evaluateExecutionPermission(
    BROWSER_EXECUTION_ACTIONS[action],
    createExecutionPolicy(),
  );
  return decision.requiresApproval || SIDE_EFFECT_ACTIONS.has(action);
}

export function browserActionRequiresSensitiveApproval(
  request: BrowserActionRequest,
): boolean {
  const target = [
    request.selector,
    request.text,
    request.value,
    request.url,
  ].filter(Boolean).join(" ");
  return SENSITIVE_TARGET_PATTERNS.some((pattern) => pattern.test(target));
}

export function validateBrowserActionRequest(request: unknown): BrowserActionResult {
  if (!request || typeof request !== "object") {
    return {
      ok: false,
      action: "snapshot",
      message: "Invalid browser action request.",
    };
  }
  const typed = request as BrowserActionRequest;
  const action = typed.action;
  if (!isBrowserActionName(action)) {
    return { ok: false, action: "snapshot", message: "Unsupported browser action." };
  }
  const actionKind = browserActionRequiresSensitiveApproval(typed)
    ? "browser.sensitive_interact"
    : BROWSER_EXECUTION_ACTIONS[action];
  const policyDecision = evaluateExecutionPermission(
    actionKind,
    createExecutionPolicy(),
  );
  if (!policyDecision.allowed) {
    return {
      ok: false,
      action,
      message: policyDecision.reason,
    };
  }
  if (browserActionRequiresApproval(action) && typed.approved !== true) {
    return {
      ok: false,
      action,
      message: "Interactive browser actions require explicit approval.",
    };
  }
  if (browserActionRequiresSensitiveApproval(typed) && typed.approved !== true) {
    return {
      ok: false,
      action,
      message: "Sensitive browser actions require explicit approval.",
    };
  }
  if (
    action !== "key_press" &&
    (action === "click" || action === "type" || action === "select" || action === "wait_for") &&
    !isValidSelector(typed.selector)
  ) {
    return {
      ok: false,
      action,
      message: "Interactive browser action selector is invalid.",
    };
  }
  if (
    (action === "type" || action === "select" || action === "assert_text") &&
    (typeof typed.text !== "string" || typed.text.length > 4000)
  ) {
    return {
      ok: false,
      action,
      message: "Interactive browser action text is invalid.",
    };
  }
  if (
    action === "key_press" &&
    (typeof typed.key !== "string" || !typed.key.trim() || typed.key.length > 80)
  ) {
    return {
      ok: false,
      action,
      message: "Interactive browser action key is invalid.",
    };
  }
  if (
    typeof typed.timeoutMs === "number" &&
    (!Number.isFinite(typed.timeoutMs) || typed.timeoutMs < 0 || typed.timeoutMs > 120_000)
  ) {
    return {
      ok: false,
      action,
      message: "Browser action timeout is invalid.",
    };
  }
  return {
    ok: true,
    action,
    message: browserActionRequiresApproval(action)
      ? `Approved browser ${action} action accepted by the desktop bridge.`
      : "Browser action accepted by the desktop bridge.",
    actionId: typed.actionId,
  };
}

function isValidSelector(selector: unknown): selector is string {
  return (
    typeof selector === "string" &&
    Boolean(selector.trim()) &&
    selector.length <= 500 &&
    !/[\r\n]/.test(selector)
  );
}
