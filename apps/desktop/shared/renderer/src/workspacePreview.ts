import type { WorkspaceFilePreview, WorkspaceFilePreviewRequest } from "@shared/desktopApi";
import { desktopApi } from "./desktopApi";

/**
 * Renderer-side wrapper around `desktopApi.previewWorkspaceFile`.
 *
 * Why it exists:
 * - Artifact bubbles are keyed by path and re-render often (React.StrictMode
 *   double-mounts every effect in development), so the same preview used to be
 *   requested several times in a row. An in-flight map collapses those into one
 *   IPC round trip.
 * - A preview can legitimately come back as `missing: true` (the file was
 *   deleted, moved or renamed after the agent wrote the message). That state is
 *   cached for a short TTL as well, so a conversation full of stale bubbles does
 *   not keep re-asking for files that are already known to be gone.
 *
 * The TTL is short on purpose: the local workspace has no fs watcher, so there
 * is nothing to invalidate the cache when a file comes back. Callers that know
 * better (a save, an explicit refresh) can drop the entry with
 * {@link forgetWorkspacePreview}, and previews a user explicitly asked for can
 * opt out of `missing` caching entirely via
 * {@link WorkspacePreviewLoadOptions.cacheMissing}.
 */

/** How long a `missing` result is remembered before we probe the file again. */
const MISSING_PREVIEW_TTL_MS = 30_000;

const inFlight = new Map<string, Promise<WorkspaceFilePreview>>();
const missingPreviews = new Map<string, { preview: WorkspaceFilePreview; expiresAt: number }>();

function requestKey(request: WorkspaceFilePreviewRequest): string {
  return [
    request.workspaceId ?? "",
    request.workspacePath ?? "",
    request.path ?? "",
    request.mode ?? "auto",
    request.maxBytes ?? "",
  ].join("\u0000");
}

/** True when the main process answered with the "file is gone" placeholder. */
export function isMissingWorkspacePreview(preview: WorkspaceFilePreview | null | undefined): boolean {
  return preview?.missing === true;
}

/** Shared wording for a deleted/moved artifact, so every panel agrees. */
export function describeMissingWorkspacePreview(language: "en" | "zh" = "en"): string {
  return language === "zh"
    ? "该文件已被删除、移动或重命名，当前版本无法打开。"
    : "This file was deleted, moved or renamed, so its current version cannot be opened.";
}

export interface WorkspacePreviewLoadOptions {
  /**
   * Remember a `missing` answer for {@link MISSING_PREVIEW_TTL_MS} (default).
   *
   * Worth it for previews that render on their own — one per artifact bubble in
   * a long conversation, re-mounted by React.StrictMode. Not worth it for a
   * preview the user clicked: the local workspace has no fs watcher, so a file
   * that has been restored since would keep reading as deleted for the rest of
   * the TTL. In-flight de-duplication applies either way.
   */
  cacheMissing?: boolean;
}

export function loadWorkspacePreview(
  request: WorkspaceFilePreviewRequest,
  options: WorkspacePreviewLoadOptions = {},
): Promise<WorkspaceFilePreview> {
  const key = requestKey(request);
  const cacheMissing = options.cacheMissing !== false;

  if (cacheMissing) {
    const cached = missingPreviews.get(key);
    if (cached) {
      if (cached.expiresAt > Date.now()) return Promise.resolve(cached.preview);
      missingPreviews.delete(key);
    }
  }

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = desktopApi.previewWorkspaceFile(request).then((preview) => {
    if (!cacheMissing) return preview;
    if (isMissingWorkspacePreview(preview)) {
      missingPreviews.set(key, { preview, expiresAt: Date.now() + MISSING_PREVIEW_TTL_MS });
    } else {
      missingPreviews.delete(key);
    }
    return preview;
  });
  inFlight.set(key, promise);
  void promise.catch(() => undefined).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  return promise;
}

/**
 * Drops the remembered `missing` state for one request, e.g. after writing the
 * file back. Safe to call for requests that were never cached.
 */
export function forgetWorkspacePreview(request: WorkspaceFilePreviewRequest): void {
  missingPreviews.delete(requestKey(request));
}

/** Test/debug helper: forgets every remembered `missing` result. */
export function clearMissingWorkspacePreviews(): void {
  missingPreviews.clear();
  inFlight.clear();
}
