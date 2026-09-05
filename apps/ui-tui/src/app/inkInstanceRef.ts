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
  /** Ink's accumulated static output string. Grows unboundedly as
   *  turns are committed to <Static>. Only used by the fullscreen
   *  branch (clearTerminal + fullStaticOutput + output) to repaint
   *  the entire screen. Completed turns are already in terminal
   *  scrollback, so this is a redundant in-memory copy that can
   *  cause heap exhaustion and TUI crashes on long sessions. */
  fullStaticOutput?: string
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

/**
 * Clear Ink's internal ``fullStaticOutput`` string. This string
 * accumulates ALL rendered static (completed turn) output and is
 * only used by Ink's fullscreen branch to repaint the entire screen
 * via ``clearTerminal + fullStaticOutput + output``.
 *
 * Completed turns are already written to the terminal scrollback by
 * ``<Static>`` — the in-memory ``fullStaticOutput`` copy is purely
 * redundant. On long sessions (dozens of turns with large tool
 * outputs), this string can grow to tens of MB, causing:
 *   1. Heap exhaustion / OOM crashes
 *   2. Multi-second synchronous ``stdout.write()`` freezes when the
 *      fullscreen branch fires
 *
 * Clearing it after each finalize means: even if the fullscreen
 * branch fires during the next turn's streaming, it only re-emits
 * the LATEST committed turn, not the entire session history.
 *
 * Safe to call when no Ink instance is registered.
 */
export function clearInkFullStaticOutput(): void {
  const inst = _instance
  if (!inst) return
  try {
    inst.fullStaticOutput = ''
  } catch {
    // best-effort
  }
}

/**
 * Proactively prevent Ink's fullscreen branch from firing during
 * streaming.
 *
 * ``resetInkLastOutputHeight()`` sets ``lastOutputHeight = 0`` which
 * guarantees ``lastOutputHeight < stdout.rows`` on the next ``onRender``
 * call, preventing the fullscreen branch entirely.
 *
 * This should be called BEFORE every streaming flush (before
 * ``updateCurrent()`` triggers a React re-render → Ink ``onRender``).
 * Without it, if the previous streaming frame was tall (close to
 * ``stdout.rows``), the next ``onRender`` sees the OLD tall
 * ``lastOutputHeight`` and triggers:
 *
 *   1. ``clearTerminal`` — wipes the visible screen
 *   2. ``fullStaticOutput + output`` — re-emits ALL committed turns +
 *      current frame, pushing existing terminal content UP and creating
 *      large blank gaps
 *   3. ``log.sync()`` — sets ``previousLineCount`` WITHOUT writing to
 *      terminal, corrupting log-update's line tracker. Subsequent
 *      ``eraseLines(previousLineCount)`` erases the wrong number of
 *      rows, leaving cumulative blank rows that grow on every flush.
 *
 * The StreamingAssistant height-clipping tries to keep the frame below
 * ``stdout.rows``, but the budget estimation can be off by 1-3 rows
 * (StatusBar height varies between 2-6 rows depending on layout width
 * and statusLine visibility; composerInputHeight has a race condition
 * with TextInput's async ``useEffect``). This proactive reset is the
 * safety net that catches those estimation errors.
 */
export function guardStreamingFrame(): void {
  const inst = _instance
  if (!inst) return
  try {
    // Reset lastOutputHeight to 0 so Ink's fullscreen branch condition
    // (lastOutputHeight >= stdout.rows) never evaluates to true.
    inst.lastOutputHeight = 0
  } catch {
    // best-effort
  }
}
