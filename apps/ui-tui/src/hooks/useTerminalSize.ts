/**
 * useTerminalSize — reactive subscription to terminal columns AND rows.
 *
 * Same pattern as useTerminalWidth, but also tracks ``stdout.rows`` so
 * components that need to clip their height (e.g. the streaming
 * assistant pane that must never exceed the terminal viewport) can
 * react to resizes.
 *
 * Why we need a height-aware hook:
 *   Ink's render loop has a "fullscreen" branch (ink.js):
 *
 *     if (lastOutputHeight >= stdout.rows) {
 *       stdout.write(clearTerminal + fullStaticOutput + output)
 *     }
 *
 *   When the dynamic frame ever grows ≥ terminal rows, every subsequent
 *   render CLEARS the entire terminal and re-emits all of <Static>.
 *   The terminal's scrollback gets stuffed with duplicates of every
 *   completed turn, the user's manual scroll position is destroyed,
 *   and live streaming feels like a freight train. Components that
 *   produce open-ended content (like a long streaming answer) have
 *   to clip their output to stay strictly below this threshold.
 *
 * Throttled the same way as the width hook to dampen drag-resize
 * bursts.
 */

import { useStdout } from 'ink'
import { useEffect, useRef, useState } from 'react'

const RESIZE_THROTTLE_MS = 100

export interface TerminalSize {
  cols: number
  rows: number
}

export function useTerminalSize(fallback: TerminalSize = { cols: 80, rows: 24 }): TerminalSize {
  const { stdout } = useStdout()
  const [size, setSize] = useState<TerminalSize>(() => ({
    // Use || instead of ?? so that a reported 0 (some terminal drivers
    // report 0 before the real size arrives) falls back to the default.
    cols: stdout?.columns || fallback.cols,
    rows: stdout?.rows || fallback.rows,
  }))
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!stdout) return

    function commit() {
      pendingTimerRef.current = null
      setSize(prev => {
        const cols = stdout.columns || fallback.cols
        const rows = stdout.rows || fallback.rows
        if (prev.cols === cols && prev.rows === rows) return prev
        return { cols, rows }
      })
    }

    function onResize() {
      if (pendingTimerRef.current) return
      pendingTimerRef.current = setTimeout(commit, RESIZE_THROTTLE_MS)
    }

    // Sync once on mount — stdout.rows may have been 0/undefined at
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
  }, [stdout, fallback.cols, fallback.rows])

  return size
}
