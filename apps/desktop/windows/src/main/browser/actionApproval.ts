import type { BrowserActionRequest, BrowserActionResult } from "../../shared/browser/types";
import { validateBrowserActionRequest } from "../../shared/browser/actionPolicy";
import { checkBrowserUrlSync } from "./urlPolicy";

export function approveBrowserActionRequest(request: unknown): BrowserActionResult {
  const validation = validateBrowserActionRequest(request);
  if (!validation.ok) return validation;
  const typed = request as BrowserActionRequest;
  if (typed.action === "open") {
    const check = checkBrowserUrlSync(typed.url);
    return {
      ok: check.allowed,
      action: typed.action,
      message: check.reason,
      url: check.normalizedUrl,
      actionId: typed.actionId,
    };
  }
  return validation;
}
