/**
 * useVirtualHistory — limits the number of transcript turns rendered at once.
 *
 * Ink re-renders the whole virtual DOM on each store update. With 1000+ turns,
 * each render is O(N) which jank's the streaming experience. Instead, render
 * only the last `windowSize` turns (default 50); older turns remain in the
 * terminal's scrollback buffer since Ink is "append-only" (it doesn't repaint
 * lines that scrolled off).
 *
 * Tradeoff: if you scroll back in the terminal, you see plain text snapshots
 * not interactive components. That's fine — past turns are immutable anyway.
 */

import { useStore } from '@nanostores/react'

import { $transcript } from '../app/turnStore.js'
import type { Turn } from '../app/types.js'

export interface VirtualHistory {
  visible: Turn[]
  hidden: number
  total: number
}

export function useVirtualHistory(windowSize = 50): VirtualHistory {
  const all = useStore($transcript)
  if (all.length <= windowSize) {
    return { visible: all, hidden: 0, total: all.length }
  }
  return {
    visible: all.slice(-windowSize),
    hidden: all.length - windowSize,
    total: all.length,
  }
}
