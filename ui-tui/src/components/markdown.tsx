/**
 * markdown.tsx — minimal text renderer for Phase 2.
 *
 * Strips `<think>...</think>` blocks (those go through reasoning.delta as
 * separate events; if a model embeds them in visible content too, suppress).
 * Otherwise renders raw text — Phase 4 will swap in a streaming markdown
 * parser with code blocks, lists, tables, inline styling, etc.
 */

import { Text } from 'ink'

interface MarkdownProps {
  text: string
  color?: string
}

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/g
const PARTIAL_THINK_OPEN_RE = /<think>[\s\S]*$/

export function stripThinkBlocks(text: string): string {
  return text
    .replace(THINK_BLOCK_RE, '')
    .replace(PARTIAL_THINK_OPEN_RE, '')  // suppress unterminated <think> tail
    .replace(/^\s+|\s+$/g, m => m.includes('\n') ? '\n' : '')
}

export function Markdown({ text, color }: MarkdownProps) {
  const cleaned = stripThinkBlocks(text)
  if (!cleaned) return null
  return <Text color={color}>{cleaned}</Text>
}
