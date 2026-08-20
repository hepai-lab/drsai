/**
 * inkInstanceRef — holds a reference to the Ink render instance so that
 * non-React code (e.g. TurnController.finalize()) can access it.
 *
 * ── Why we need this ──────────────────────────────────────────────
 *
 * Ink internally uses two independent throttle instances:
 *   - ``throttledOnRender``  — throttles the ``onRender`` callback
 *   - ``throttledLog``       — throttles stdout writes via log-update
 *
 * Both use ``{ leading: true, trailing: true }`` with a ``setTimeout``
 * fallback for the trailing edge.
 *
 * During streaming, the last ``onRender`` call may leave a **pending
 * trailing call** that captures the OLD streaming frame output (e.g.
 * 20 rows).  When ``finalize()`` triggers ``onImmediateRender`` (the
 * non-throttled path, used when ``<Static>`` has new items), the new
 * 5-row frame is written correctly — but the stale trailing call then
 * fires on the next macrotask, overwriting the new frame with the old
 * 20-row output.  This causes:
 *   1. Text overlap / misalignment (old content covering StatusBar)
 *   2. Bottom blank space (subsequent ``eraseLines(21)`` → write 6)
 *
 * Fix: call ``cancelPendingInkThrottles()`` at the start of
 * ``finalize()``, before any store updates.  This cancels the pending
 * trailing calls so they never fire after ``onImmediateRender``.
 */

// Ink's Instance type is not easily importable without pulling in the
// full package; we use a structural type with just the fields we need.
interface InkInstanceLike {
  /** Throttled stdout writer (may have .cancel()). */
  throttledLog?: { cancel?: () => void }
  /** Throttled onRender (may have .cancel()). */
  throttledOnRender?: { cancel?: () => void }
  /** Ink's internal lastOutputHeight. When >= stdout.rows, Ink's
   *  fullscreen branch fires, calling log.sync() which corrupts
   *  previousLineCount. Resetting to 0 at finalize prevents this. */
  lastOutputHeight?: number
}

let _instance: InkInstanceLike | null = null

/** Called from entry.tsx after ``render()`` returns the Ink instance. */
export function setInkInstance(instance: unknown | null): void {
  _instance = (instance as InkInstanceLike) ?? null
}

/**
 * Cancel any pending ``throttledLog`` and ``throttledOnRender`` trailing
 * calls.  Safe to call when no Ink instance is registered or when no
 * pending calls exist (``.cancel()`` is a no-op in those cases).
 */
export function cancelPendingInkThrottles(): void {
  const inst = _instance
  if (!inst) return
  try {
    inst.throttledLog?.cancel?.()
  } catch {
    // best-effort
  }
  try {
    inst.throttledOnRender?.cancel?.()
  } catch {
    // best-effort
  }
}

/**
 * Reset Ink's internal ``lastOutputHeight`` to 0.  This prevents the
 * fullscreen branch (``lastOutputHeight >= stdout.rows``) from firing
 * on the finalize render.  The fullscreen branch corrupts
 * ``previousLineCount`` via ``log.sync()``, which causes
 * ``eraseLines()`` to erase the wrong number of lines on the next
 * render — leaving 1 blank line per turn (the "growing bottom blank
 * space" bug).
 *
 * Safe to call when no Ink instance is registered.
 */
export function resetInkLastOutputHeight(): void {
  const inst = _instance
  if (!inst) return
  try {
    inst.lastOutputHeight = 0
  } catch {
    // best-effort
  }
}
