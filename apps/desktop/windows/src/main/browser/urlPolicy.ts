import type { BrowserUrlCheck } from "../../../../shared/api/browser/types";

const TRUSTED_BROWSER_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function checkBrowserUrlSync(rawUrl: unknown): BrowserUrlCheck {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      allowed: false,
      reason: "Enter a URL to preview.",
      scope: "blocked",
    };
  }

  try {
    const url = new URL(rawUrl.trim());
    if (url.username || url.password) {
      return {
        allowed: false,
        reason: "Browser preview does not allow credentials in URLs.",
        scope: "blocked",
      };
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      if (TRUSTED_BROWSER_HOSTS.has(url.hostname)) {
        return {
          allowed: true,
          reason: "Local development URL allowed.",
          normalizedUrl: url.toString(),
          scope: "local",
        };
      }
      if (url.protocol === "https:") {
        return {
          allowed: true,
          reason: "Public HTTPS URL allowed.",
          normalizedUrl: url.toString(),
          scope: "public",
        };
      }
      return {
        allowed: false,
        reason: "Public browser preview requires HTTPS.",
        normalizedUrl: url.toString(),
        scope: "public",
      };
    }
    if (url.protocol === "file:") {
      return {
        allowed: false,
        reason:
          "Use workspace file previews through the OpenDrSai file preview flow.",
        normalizedUrl: url.toString(),
        scope: "workspace-file",
      };
    }
    return {
      allowed: false,
      reason: "Only http, https, and workspace file previews are supported.",
      scope: "blocked",
    };
  } catch {
    return {
      allowed: false,
      reason: "The browser URL is not valid.",
      scope: "blocked",
    };
  }
}
