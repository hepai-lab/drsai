/**
 * terminalSizeStore — global single-listener terminal size subscription.
 *
 * ── Problem ──────────────────────────────────────────────────────────
 *
 * Before this module, every component that needed the terminal column
 * count or row count called ``useTerminalWidth()`` or ``useTerminalSize()``,
 * each of which ran ``stdout.on('resize', …)`` in a ``useEffect``.
 * With Node.js's default ``maxListeners = 10``, having more than ~10
 * mounted components (e.g. one MarkdownRenderer per text part in a
 * long transcript + StatusBar + StreamingAssistant) triggered:
 *
 *   MaxListenersExceededWarning: 11 resize listeners added to
 *   [WriteStream]. MaxListeners is 10.
 *
 * ── Solution ─────────────────────────────────────────────────────────
 *
 * This module registers a SINGLE ``resize`` listener on ``process.stdout``
 * (via Ink's ``useStdout`` at startup) and stores the size in a nanostore
 * atom. Components subscribe via ``useStore($terminalSize)`` — no matter
 * how many components subscribe, there is always exactly ONE EventEmitter
 * listener.
 *
 * Usage:
 *   import { useTerminalSize, useTerminalWidth, initTerminalSize }
 *   initTerminalSize()  // call once at app startup (entry.tsx)
 *   const { cols, rows } = useTerminalSize()
 *   const cols = useTerminalWidth()
 */

import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useStdout } from 'ink'

export interface TerminalSize {
  cols: number
  rows: number
}

// ── Global atom ──────────────────────────────────────────────────────

/** The single source of truth for terminal dimensions. Updated by the
 *  one and only resize listener (installed by ``initTerminalSize``). */
export const $terminalSize = atom<TerminalSize>({
  cols: process.stdout?.columns || 80,
  rows: process.stdout?.rows || 24,
})

// ── Throttle ─────────────────────────────────────────────────────────

const RESIZE_THROTTLE_MS = 100
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let initialized = false

/** Install the single resize listener. Call once at app startup. */
export function initTerminalSize(stdout?: NodeJS.WriteStream): void {
  if (initialized) return
  initialized = true

  const stream = stdout ?? process.stdout
  if (!stream) return

  function commit(): void {
    pendingTimer = null
    const cols = stream.columns || 80
    const rows = stream.rows || 24
    const prev = $terminalSize.get()
    if (prev.cols === cols && prev.rows === rows) return
    $terminalSize.set({ cols, rows })
  }

  function onResize(): void {
    if (pendingTimer) return
    pendingTimer = setTimeout(commit, RESIZE_THROTTLE_MS)
  }

  // Sync once on init — stdout may not have had the real size at
  // module-load time.
  commit()
  stream.on('resize', onResize)
}

// ── Hooks (drop-in replacements for useTerminalWidth/useTerminalSize) ──

/** Reactive terminal width (columns). Subscribes to the global store. */
export function useTerminalWidth(fallback = 80): number {
  const { cols } = useStore($terminalSize)
  return cols || fallback
}

/** Reactive terminal size { cols, rows }. Subscribes to the global store. */
export function useTerminalSize(
  fallback: TerminalSize = { cols: 80, rows: 24 },
): TerminalSize {
  const size = useStore($terminalSize)
  // If stdout hasn't reported yet (both 0), use fallback
  if (size.cols === 0 || size.rows === 0) return fallback
  return size
}
