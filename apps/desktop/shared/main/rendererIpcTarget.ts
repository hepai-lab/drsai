/**
 * Helpers for IPC delivery to Electron renderer targets.
 *
 * WebContents can stay alive while its current render frame is disposed
 * (reload / HMR / crash recovery). In that window `isDestroyed()` is false,
 * but `webContents.send()` logs Electron's
 * "Error sending from webFrameMain: Render frame was disposed..." and
 * often swallows the exception — so a BoundedEventDispatcher that keeps
 * flushing will spam the console forever unless we refuse to call send().
 */

export interface RendererIpcTarget {
  isDestroyed?(): boolean;
  isLoadingMainFrame?(): boolean;
  /** Present on Electron WebContents; absent on headless/test stubs. */
  mainFrame?: { isDestroyed(): boolean };
  send(channel: string, ...args: unknown[]): void;
}

/** Targets whose renderer IPC is suspended (reload quarantine, etc.). */
const suspendedTargets = new WeakSet<object>();

/** Stop IPC to this target until resumeRendererIpc() — used during reload. */
export function suspendRendererIpc(target: object): void {
  suspendedTargets.add(target);
}

/** Allow IPC again after the new render frame is ready. */
export function resumeRendererIpc(target: object): void {
  suspendedTargets.delete(target);
}

export function isRendererIpcSuspended(target: object): boolean {
  return suspendedTargets.has(target);
}

/** True when the target must not receive IPC (destroyed, loading, or suspended). */
export function isRendererIpcTargetGone(target: RendererIpcTarget): boolean {
  if (suspendedTargets.has(target)) return true;
  try {
    if (target.isDestroyed?.()) return true;
  } catch {
    return true;
  }
  // Main-frame load/reload: the current frame is being replaced.
  try {
    if (target.isLoadingMainFrame?.()) return true;
  } catch {
    return true;
  }
  try {
    const frame = target.mainFrame;
    if (frame && typeof frame.isDestroyed === "function" && frame.isDestroyed()) {
      return true;
    }
  } catch {
    // Accessing a disposed WebFrameMain can throw.
    return true;
  }
  return false;
}

/**
 * Send IPC only when the render frame is alive. Returns false when dropped.
 * Never calls send() on a disposed/suspended frame (avoids Electron's log spam).
 */
export function trySendToRenderer(
  target: RendererIpcTarget,
  channel: string,
  ...args: unknown[]
): boolean {
  if (isRendererIpcTargetGone(target)) return false;
  try {
    target.send(channel, ...args);
    return true;
  } catch (error) {
    if (/destroy|disposed/i.test(String(error))) return false;
    throw error;
  }
}
