/**
 * useTerminalWidth — reactive subscription to the terminal column count.
 *
 * Why we need this:
 *   ``process.stdout.columns`` is a snapshot taken at *call time*. React
 *   does not re-render when the terminal is resized, so any component that
 *   captured the value via ``process.stdout.columns`` keeps using the
 *   stale width forever. The visible symptoms are:
 *     - Markdown tables render off-screen after the user widens the window
 *     - Long horizontal rules stay short (or wrap) after a resize
 *     - Plain-text wrapping looks wrong because the renderer assumed the
 *       startup width
 *
 * What this hook does:
 *   Subscribes to ``stdout.on('resize')`` via Ink's ``useStdout`` so a
 *   resize bumps a state value, which triggers re-render in any component
 *   reading the hook.
 *
 *   We throttle the updates to ~100 ms because dragging a window edge in
 *   most terminal emulators emits a continuous flood of resize events,
 *   and re-rendering the entire dynamic frame at 60 FPS during the drag
 *   adds visible jitter (and competes with streaming repaints — see the
 *   "scroll anchor reset" issue in P1-01).
 */

import { useStdout } from 'ink'
import { useEffect, useRef, useState } from 'react'

const RESIZE_THROTTLE_MS = 100

export function useTerminalWidth(fallback = 80): number {
  const { stdout } = useStdout()
  const [width, setWidth] = useState<number>(stdout?.columns || fallback)
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!stdout) return

    function commit() {
      pendingTimerRef.current = null
      const next = stdout.columns || fallback
      // setState is reference-equal-aware for primitives: no re-render
      // unless the value actually changed.
      setWidth(next)
    }

    function onResize() {
      // Throttle: collapse every burst into one update on the trailing edge.
      if (pendingTimerRef.current) return
      pendingTimerRef.current = setTimeout(commit, RESIZE_THROTTLE_MS)
    }

    // Sync once on mount — stdout.columns may have been 0/undefined at
    // useState init time and corrected by the time the effect runs.
    commit()

    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = null
      }
    }
  }, [stdout, fallback])

  return width
}
