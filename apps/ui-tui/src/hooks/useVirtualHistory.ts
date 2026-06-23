/**
 * useVirtualHistory — limits the number of transcript turns rendered at once.
 *
 * Ink re-renders the whole virtual DOM on each store update. With 1000+ turns,
 * each render is O(N) which jank's the streaming experience. Instead, render
 * only a window of turns based on scroll position.
 *
 * Supports internal scrolling (PageUp/PageDown) to view history without
 * relying on terminal scrollback buffer.
 */

import { useStore } from '@nanostores/react'

import { $scrollOffset } from '../app/scrollStore.js'
import { $transcript } from '../app/turnStore.js'
import type { Turn } from '../app/types.js'

export interface VirtualHistory {
  visible: Turn[]
  hidden: number
  total: number
  canScrollUp: boolean
  canScrollDown: boolean
}

export function useVirtualHistory(windowSize = 30): VirtualHistory {
  const all = useStore($transcript)
  const scrollOffset = useStore($scrollOffset)
  
  const total = all.length
  
  // 防御性 clamp：防止 scrollOffset 越界导致 visible 为空
  // scrollOffset 最大为 total - 1（至少保留一个 turn 可见）
  const maxOffset = Math.max(0, total - 1)
  const clampedOffset = Math.min(scrollOffset, maxOffset)
  
  // 计算可见窗口
  // scrollOffset = 0: 显示最后 windowSize 个
  // scrollOffset > 0: 向上滚动
  const endIndex = total - clampedOffset  // >= 1 when total > 0
  const startIndex = Math.max(0, endIndex - windowSize)
  
  const visible = all.slice(startIndex, endIndex)
  const hidden = startIndex
  
  const canScrollUp = startIndex > 0
  const canScrollDown = clampedOffset > 0
  
  return {
    visible,
    hidden,
    total,
    canScrollUp,
    canScrollDown,
  }
}
