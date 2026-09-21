import { isAbsolute, normalize } from "node:path";
import type { DesktopOpenRequest } from "../../../shared/api/desktopApi";

const PROTOCOL = "opendrsai:";
const THREAD_ID = /^[A-Za-z0-9._:-]{1,160}$/;

export function parseMacosOpenUrl(
  rawUrl: unknown,
  source: "protocol" | "second-instance" = "protocol",
): DesktopOpenRequest | null {
  if (typeof rawUrl !== "string" || rawUrl.length > 4_096) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== PROTOCOL || url.username || url.password) return null;
    const safeUrl = `${PROTOCOL}//${url.hostname}${url.pathname}`;
    if (url.hostname === "auth-complete" && (url.pathname === "" || url.pathname === "/")) {
      return { kind: "auth-complete", source, url: safeUrl };
    }
    if (url.hostname === "thread") {
      const rawThreadPath = rawUrl.match(/^opendrsai:\/\/thread\/([^?#]*)/i)?.[1];
      if (!rawThreadPath) return null;
      const threadId = decodeURIComponent(rawThreadPath);
      if (!THREAD_ID.test(threadId)) return null;
      return { kind: "thread", source, url: safeUrl, threadId };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseMacosOpenFile(
  rawPath: unknown,
  source: "finder" | "second-instance" = "finder",
): DesktopOpenRequest | null {
  if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.length > 32_768 || !isAbsolute(rawPath)) return null;
  return { kind: "file", source, path: normalize(rawPath) };
}

export function parseMacosSecondInstanceArgv(
  argv: readonly string[],
  ignoredPaths: readonly string[] = [],
): DesktopOpenRequest[] {
  const requests: DesktopOpenRequest[] = [];
  const ignored = new Set(ignoredPaths.filter((path) => isAbsolute(path)).map((path) => normalize(path)));
  for (const argument of argv) {
    if (isAbsolute(argument) && ignored.has(normalize(argument))) continue;
    const request = argument.startsWith(`${PROTOCOL}//`)
      ? parseMacosOpenUrl(argument, "second-instance")
      : parseMacosOpenFile(argument, "second-instance");
    if (request) requests.push(request);
  }
  return requests;
}

export class DesktopOpenRequestQueue {
  readonly #pending: DesktopOpenRequest[] = [];
  readonly #keys = new Set<string>();
  #sink: ((request: DesktopOpenRequest) => void) | null = null;

  enqueue(request: DesktopOpenRequest): void {
    if (this.#sink) {
      this.#sink(request);
      return;
    }
    const key = JSON.stringify(request);
    if (this.#keys.has(key)) return;
    this.#pending.push(request);
    this.#keys.add(key);
    while (this.#pending.length > 32) {
      const removed = this.#pending.shift();
      if (removed) this.#keys.delete(JSON.stringify(removed));
    }
  }

  attach(sink: (request: DesktopOpenRequest) => void): void {
    this.#sink = sink;
    for (const request of this.#pending.splice(0)) sink(request);
    this.#keys.clear();
  }

  detach(): void {
    this.#sink = null;
  }

  get pendingCount(): number {
    return this.#pending.length;
  }
}
