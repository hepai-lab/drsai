import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function isAllowedDevelopmentRendererUrl(url: string, configured: string | undefined): boolean {
  if (!configured) return false;
  try {
    const target = new URL(url);
    const expected = new URL(configured);
    if (!isHttp(expected) || !isLoopback(expected.hostname)) return false;
    return target.origin === expected.origin;
  } catch {
    return false;
  }
}

export function isAllowedRendererNavigation(url: string, rendererHtmlPath: string, rendererUrl?: string): boolean {
  if (rendererUrl && isAllowedDevelopmentRendererUrl(url, rendererUrl)) return true;
  try {
    const target = new URL(url);
    const expected = new URL(pathToFileURL(resolve(rendererHtmlPath)).href);
    return target.protocol === "file:" && target.pathname === expected.pathname && !target.username && !target.password;
  } catch {
    return false;
  }
}

function isHttp(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}
