/**
 * scrollStore - 管理 transcript 的滚动状态
 *
 * 实现 TUI 内部滚动功能，允许用户使用 PageUp/PageDown 查看历史消息，
 * 而不依赖终端的滚动条。
 *
 * 滚动逻辑：
 * - scrollOffset = 0: 显示最新消息（底部）
 * - scrollOffset > 0: 向上滚动，显示较早的消息
 * - 自动跳到底部：当有新消息到达且用户在底部时
 */

import { atom } from 'nanostores'

import { $transcript } from './turnStore.js'

/**
 * 滚动偏移量
 * 0 = 底部（最新消息）
 * N = 向上滚动 N 个 turn
 */
export const $scrollOffset = atom<number>(0)

/**
 * 是否正在滚动（不在底部）
 */
export const $isScrolling = atom<boolean>(false)

/**
 * 滚动到底部
 */
export function scrollToBottom(): void {
  $scrollOffset.set(0)
  $isScrolling.set(false)
}

/**
 * 向上滚动，自动限制最大偏移量防止窗口为空
 */
export function scrollUp(amount: number): void {
  const current = $scrollOffset.get()
  const total = $transcript.get().length
  // At least 1 turn must remain visible
  const maxOffset = Math.max(0, total - 1)
  const newOffset = Math.min(current + amount, maxOffset)
  if (newOffset === current) return // Already at limit
  $scrollOffset.set(newOffset)
  $isScrolling.set(newOffset > 0)
}

/**
 * 向下滚动
 */
export function scrollDown(amount: number): void {
  const current = $scrollOffset.get()
  const newOffset = Math.max(0, current - amount)
  $scrollOffset.set(newOffset)
  $isScrolling.set(newOffset > 0)
}

/**
 * 滚动到顶部
 */
export function scrollToTop(maxOffset: number): void {
  $scrollOffset.set(maxOffset)
  $isScrolling.set(maxOffset > 0)
}
