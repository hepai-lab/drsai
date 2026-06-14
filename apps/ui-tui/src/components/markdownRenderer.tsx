/**
 * markdownRenderer.tsx — improved markdown renderer for Phase 4+.
 *
 * Supports:
 *   - Code blocks (```lang ... ```) with language label
 *   - Inline code (`code`)
 *   - Lists (- item, 1. item)
 *   - Bold (**text**), italic (*text*), strikethrough (~~text~~)
 *   - Links [text](url) and images ![alt](url)
 *   - Headers (# H1, ## H2, etc.)
 *   - Blockquotes (> text)
 *   - Horizontal rules (--- / *** / ___)
 *   - Tables (GFM, with/without leading pipes, adaptive width)
 *
 * Tables adapt to terminal width; when too wide they render as a
 * vertical key-value list instead of breaking the layout.
 */

import { Box, Text } from 'ink'
import type { ReactElement } from 'react'

import { useTerminalWidth } from '../hooks/useTerminalWidth.js'
import { theme } from '../theme.js'

// ─── Props ────────────────────────────────────────────────────────

interface MarkdownRendererProps {
  text: string
  color?: string
}

// ─── Think-block stripping ────────────────────────────────────────

const THINK_BLOCK_RE = /<think[\s\S]*?<\/think>/g
const PARTIAL_THINK_OPEN_RE = /<think[\s\S]*$/

export function stripThinkBlocks(text: string): string {
  return text
    .replace(THINK_BLOCK_RE, '')
    .replace(PARTIAL_THINK_OPEN_RE, '')
    .replace(/^\s+|\s+$/g, m => (m.includes('\n') ? '\n' : ''))
}

// ─── Terminal width ───────────────────────────────────────────────
//
// The terminal column count is reactive — components must read it via
// ``useTerminalWidth()`` so a window resize triggers a re-render. We
// deliberately do NOT export a non-reactive ``process.stdout.columns``
// helper here, because past experience shows callers will quietly grab
// the snapshot value and ship a regression.

// ─── Block types ──────────────────────────────────────────────────

interface Block {
  type: 'paragraph' | 'code' | 'list' | 'header' | 'blockquote' | 'table' | 'hr'
  content: string
  lang?: string
  level?: number
  rows?: string[][]  // for table
}

// ─── Table helpers ────────────────────────────────────────────────

function isTableSeparator(line: string): boolean {
  // matches: |---|---| or | :--- | ---: | etc.
  // Also matches without leading pipe: ---|--- or :---:|---
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line)
}

/**
 * Detect a GFM table row: line contains at least one `|` that is
 * not at the very end (which would be ambiguous with normal text).
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed === '') return false
  // Must contain at least one |
  if (!trimmed.includes('|')) return false
  // Must not be a separator line
  if (isTableSeparator(trimmed)) return false
  // Must have at least 2 columns when split (i.e. at least one internal |)
  const cells = splitTableRow(trimmed)
  return cells.length >= 2
}

function splitTableRow(line: string): string[] {
  // Strip leading/trailing pipes then split on |
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim())
}

// ─── Block parser ─────────────────────────────────────────────────

function parseBlocks(text: string): Block[] {
  const cleaned = stripThinkBlocks(text)
  const lines = cleaned.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      // If closing ``` found, skip it; otherwise treat as open code block
      if (i < lines.length) i++ // skip closing ```
      blocks.push({ type: 'code', content: codeLines.join('\n'), lang: lang || 'text' })
      continue
    }

    // Header
    const headerMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch) {
      blocks.push({
        type: 'header',
        content: headerMatch[2],
        level: headerMatch[1].length,
      })
      i++
      continue
    }

    // Horizontal rule (--- / *** / ___, at least 3 chars, nothing else on line)
    if (/^\s*(?:---+|===+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ type: 'hr', content: '' })
      i++
      continue
    }

    // Table: header row + separator + body rows
    // Supports both | Header | Value | and Header | Value formats
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows: string[][] = [splitTableRow(line)]
      i += 2  // skip header + separator
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', content: '', rows })
      continue
    }

    // Blockquote
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [line.slice(2)]
      i++
      while (i < lines.length && lines[i].startsWith('> ')) {
        quoteLines.push(lines[i].slice(2))
        i++
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') })
      continue
    }

    // List (unordered or ordered)
    if (line.match(/^\s*[-*+]\s+/) || line.match(/^\s*\d+\.\s+/)) {
      const listLines: string[] = [line]
      i++
      while (i < lines.length && (lines[i].match(/^\s*[-*+]\s+/) || lines[i].match(/^\s*\d+\.\s+/) || lines[i].startsWith('  '))) {
        listLines.push(lines[i])
        i++
      }
      blocks.push({ type: 'list', content: listLines.join('\n') })
      continue
    }

    // Empty line — skip
    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph (collect consecutive non-special lines)
    const paraLines: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('> ') &&
      !lines[i].match(/^\s*[-*+]\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/) &&
      // Stop if we hit a table-like line followed by a separator
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) &&
      // Stop for horizontal rules
      !/^\s*(?:---+|===+|\*\*\*+|___+)\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', content: paraLines.join('\n') })
  }

  return blocks
}

// ─── Inline span types ────────────────────────────────────────────

interface InlineSpan {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link' | 'image' | 'strikethrough'
  text: string
  href?: string  // for link/image
}

// ─── Inline parser ────────────────────────────────────────────────

function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = []
  let i = 0
  let current = ''

  const flush = (type: InlineSpan['type'] = 'text') => {
    if (current) {
      spans.push({ type, text: current })
      current = ''
    }
  }

  while (i < text.length) {
    // Inline code
    if (text[i] === '`') {
      flush()
      i++
      let code = ''
      while (i < text.length && text[i] !== '`') {
        code += text[i]
        i++
      }
      spans.push({ type: 'code', text: code })
      if (i < text.length) i++ // skip closing `
      continue
    }

    // Strikethrough ~~text~~
    if (text.slice(i, i + 2) === '~~') {
      flush()
      i += 2
      let strike = ''
      while (i < text.length && text.slice(i, i + 2) !== '~~') {
        strike += text[i]
        i++
      }
      if (i >= text.length) {
        // Unclosed ~~ during streaming — render as plain text
        spans.push({ type: 'text', text: '~~' + strike })
      } else {
        spans.push({ type: 'strikethrough', text: strike })
        i += 2 // skip closing ~~
      }
      continue
    }

    // Bold **text**
    if (text.slice(i, i + 2) === '**') {
      flush()
      i += 2
      let bold = ''
      while (i < text.length && text.slice(i, i + 2) !== '**') {
        bold += text[i]
        i++
      }
      if (i >= text.length) {
        // Unclosed ** during streaming — render as plain text
        spans.push({ type: 'text', text: '**' + bold })
      } else {
        spans.push({ type: 'bold', text: bold })
        i += 2 // skip closing **
      }
      continue
    }

    // Italic *text*
    if (text[i] === '*' && text[i + 1] !== '*') {
      flush()
      i++
      let italic = ''
      while (i < text.length && text[i] !== '*') {
        italic += text[i]
        i++
      }
      if (i >= text.length) {
        // Unclosed * during streaming — render as plain text
        spans.push({ type: 'text', text: '*' + italic })
      } else {
        spans.push({ type: 'italic', text: italic })
        i++ // skip closing *
      }
      continue
    }

    // Image ![alt](url)
    if (text[i] === '!' && text[i + 1] === '[') {
      flush()
      i += 2 // skip ![
      let alt = ''
      while (i < text.length && text[i] !== ']') {
        alt += text[i]
        i++
      }
      i++ // skip ]
      if (text[i] === '(') {
        i++ // skip (
        let url = ''
        while (i < text.length && text[i] !== ')') {
          url += text[i]
          i++
        }
        i++ // skip )
        spans.push({ type: 'image', text: alt, href: url })
      } else {
        spans.push({ type: 'text', text: '![' + alt + ']' })
      }
      continue
    }

    // Link [text](url)
    if (text[i] === '[') {
      // Lookahead: is this really a link? Need ]( after the text
      const afterOpen = text.indexOf('](', i + 1)
      if (afterOpen !== -1) {
        flush()
        i++ // skip [
        let linkText = ''
        while (i < text.length && text[i] !== ']') {
          linkText += text[i]
          i++
        }
        i += 2 // skip ](
        let url = ''
        while (i < text.length && text[i] !== ')') {
          url += text[i]
          i++
        }
        i++ // skip )
        spans.push({ type: 'link', text: linkText, href: url })
        continue
      }
    }

    current += text[i]
    i++
  }

  flush()
  return spans
}

// ─── Inline renderer ──────────────────────────────────────────────

function renderInline(spans: InlineSpan[], defaultColor?: string): ReactElement[] {
  return spans.map((span, idx) => {
    switch (span.type) {
      case 'bold':
        return (
          <Text key={idx} bold color={defaultColor}>
            {span.text}
          </Text>
        )
      case 'italic':
        return (
          <Text key={idx} italic color={defaultColor}>
            {span.text}
          </Text>
        )
      case 'code':
        return (
          <Text key={idx} backgroundColor={theme.codeBg} color={theme.code}>
            {span.text}
          </Text>
        )
      case 'link':
        return (
          <Text key={idx} color={theme.primary} underline>
            {span.text}
            {span.href ? <Text color={theme.muted} dimColor>{' (' + span.href + ')'}</Text> : null}
          </Text>
        )
      case 'image':
        return (
          <Text key={idx} color={theme.accent}>
            {'[🖼 '}
            {span.text}
            {span.href ? <Text color={theme.muted} dimColor>{' ' + span.href}</Text> : null}
            {']'}
          </Text>
        )
      case 'strikethrough':
        // Terminal doesn't natively support strikethrough; use dim + line-through emulation
        // with Unicode combining character U+0336 (combining long stroke overlay)
        return (
          <Text key={idx} color={defaultColor} dimColor>
            {span.text.split('').join('\u0336') + '\u0336'}
          </Text>
        )
      default:
        return (
          <Text key={idx} color={defaultColor}>
            {span.text}
          </Text>
        )
    }
  })
}

/**
 * Render inline spans as a plain string (for table cells where we
 * cannot nest <Text> inside a single <Text> without losing formatting).
 * This is a simpler version that returns an array of ReactElements
 * compatible with being children of a <Text>.
 */
function renderInlineFlat(spans: InlineSpan[], defaultColor?: string): ReactElement[] {
  return renderInline(spans, defaultColor)
}

// ─── Table rendering helpers ──────────────────────────────────────

/**
 * Calculate the total width a table row would occupy with the given column widths.
 * Includes: leading "│ " + " │ " between cols + trailing " │" + content.
 */
function calcTableRowWidth(widths: number[]): number {
  // │ cell1 │ cell2 │ cell3 │
  // 2 + w1 + 3 + w2 + 3 + w3 + 2 = w1+w2+w3 + 5 + (n-1)*3
  const contentWidth = widths.reduce((s, w) => s + w, 0)
  const borders = 2 + 2 + widths.length * 3 - 1 // │_ + _│ + (n-1)×_│_
  return contentWidth + borders
}

/**
 * Reduce column widths so the total table fits within `maxWidth`.
 * Strategy: proportionally shrink all columns, then hard-truncate.
 */
function fitWidths(widths: number[], maxWidth: number): number[] {
  const minCol = 4 // minimum visible column width
  const n = widths.length

  // Already fits?
  if (calcTableRowWidth(widths) <= maxWidth) return widths

  // Iteratively shrink the widest column until it fits
  let result = [...widths]
  for (let iter = 0; iter < 100; iter++) {
    if (calcTableRowWidth(result) <= maxWidth) break
    // Find the widest column
    let maxIdx = 0
    for (let c = 1; c < n; c++) {
      if (result[c] > result[maxIdx]) maxIdx = c
    }
    if (result[maxIdx] <= minCol) break
    result[maxIdx] = Math.max(minCol, result[maxIdx] - 2)
  }
  return result
}

/**
 * Render a 2-column table as a vertical key-value list.
 * This avoids the width blowout problem entirely for the most common case.
 */
function renderTableAsKeyValue(rows: string[][], color?: string): ReactElement {
  const header = rows[0]
  const keyLabel = header[0] || 'Key'
  const valLabel = header[1] || 'Value'
  const body = rows.slice(1)

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Header line */}
      <Text bold color={theme.accent}>
        {keyLabel}
      </Text>
      <Text color={theme.border}>
        {'─'.repeat(Math.max(keyLabel.length, valLabel.length, 20))}
      </Text>
      {body.map((row, ri) => {
        const key = (row[0] ?? '').trim()
        const val = (row[1] ?? '').trim()
        const keySpans = parseInline(key)
        const valSpans = parseInline(val)
        return (
          <Box key={ri} flexDirection="column">
            <Box>
              <Text color={theme.accent} bold>{key + ': '}</Text>
              {renderInlineFlat(valSpans, color)}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * Render a table with Unicode box-drawing, adapted to terminal width.
 * For 2-column tables that would be too wide, falls back to vertical key-value.
 *
 * ``termWidth`` must be supplied by the caller (read via ``useTerminalWidth``)
 * so this remains a pure function — re-rendering on resize is the React tree's
 * responsibility.
 */
function renderTable(rows: string[][], color: string | undefined, termWidth: number): ReactElement {
  if (rows.length === 0) return <></>

  // Leave some margin for prompt chars and padding
  const maxWidth = Math.max(termWidth - 6, 40)
  const colCount = Math.max(...rows.map(r => r.length))

  // Compute natural column widths
  const widths: number[] = []
  for (let c = 0; c < colCount; c++) {
    let w = 0
    for (const r of rows) {
      const cell = (r[c] ?? '').length
      if (cell > w) w = cell
    }
    widths.push(Math.min(w, 30))
  }

  const naturalWidth = calcTableRowWidth(widths)

  // For 2-column tables that are too wide, use vertical key-value layout
  if (colCount === 2 && naturalWidth > maxWidth) {
    return renderTableAsKeyValue(rows, color)
  }

  // Fit widths to terminal
  const fitted = fitWidths(widths, maxWidth)

  const pad = (s: string, w: number) => {
    if (s.length >= w) return s.slice(0, w)
    return s + ' '.repeat(w - s.length)
  }

  const sep = '┼'
  const dash = (w: number) => '─'.repeat(w + 2)

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* header */}
      <Text color={theme.accent} bold>
        {'│ ' + rows[0].slice(0, colCount).map((c, ci) => pad(c, fitted[ci])).join(' │ ') + ' │'}
      </Text>
      {/* divider */}
      <Text color={theme.border}>
        {'├' + fitted.map(w => dash(w)).join(sep) + '┤'}
      </Text>
      {/* body rows */}
      {rows.slice(1).map((r, ri) => {
        const cells: ReactElement[] = []
        for (let ci = 0; ci < colCount; ci++) {
          const raw = r[ci] ?? ''
          const spans = parseInline(raw)
          // We need to pad inline-rendered cells; since renderInline produces
          // multiple <Text> elements, we wrap each cell in a padded container.
          // Unfortunately Ink doesn't support fixed-width <Text> natively,
          // so for table alignment we still use the raw padded string approach,
          // but we also attempt inline rendering when cell is simple (single span).
          if (spans.length === 1 && spans[0].type === 'text') {
            // Simple text — use padded string for alignment
            cells.push(
              <Text key={ci} color={color}>
                {pad(raw, fitted[ci])}
              </Text>
            )
          } else {
            // Has inline formatting — render spans, pad with approximation
            const renderedSpans = renderInlineFlat(spans, color)
            // Calculate how much padding we need
            const visibleLen = spans.reduce((s, sp) => s + sp.text.length, 0)
            const padLen = Math.max(0, fitted[ci] - visibleLen)
            cells.push(
              <Text key={ci} color={color}>
                {renderedSpans}
                {' '.repeat(padLen)}
              </Text>
            )
          }
        }
        // Join cells with │ separator
        const parts: ReactElement[] = []
        for (let ci = 0; ci < cells.length; ci++) {
          parts.push(cells[ci])
          if (ci < cells.length - 1) {
            parts.push(<Text key={`s${ci}`} color={theme.border}>{' │ '}</Text>)
          }
        }
        return (
          <Box key={ri}>
            <Text color={theme.border}>{'│ '}</Text>
            {parts}
            <Text color={theme.border}>{' │'}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────

export function MarkdownRenderer({ text, color }: MarkdownRendererProps) {
  const blocks = parseBlocks(text)
  const termWidth = useTerminalWidth()
  if (blocks.length === 0) return null

  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'code': {
            const lines = block.content.split('\n')
            return (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                {block.lang && block.lang !== 'text' && (
                  <Text color={theme.muted} dimColor>
                    {block.lang}
                  </Text>
                )}
                {lines.map((line, li) => (
                  <Box key={li}>
                    <Text color={theme.border}>▎ </Text>
                    <Text color={theme.code}>{line || ' '}</Text>
                  </Box>
                ))}
              </Box>
            )
          }
          case 'header': {
            const headerColor = block.level === 1 ? theme.primary : theme.accent
            const spans = parseInline(block.content)
            return (
              <Box key={idx} marginBottom={1}>
                <Text bold color={headerColor}>
                  {'#'.repeat(block.level || 1) + ' '}
                </Text>
                {renderInline(spans, headerColor)}
              </Box>
            )
          }
          case 'hr': {
            return (
              <Box key={idx} marginBottom={1}>
                <Text color={theme.border}>
                  {'─'.repeat(Math.min(termWidth - 4, 60))}
                </Text>
              </Box>
            )
          }
          case 'table': {
            const rows = block.rows || []
            return <Box key={idx}>{renderTable(rows, color, termWidth)}</Box>
          }
          case 'blockquote': {
            // Apply inline parsing to blockquote content
            const lines = block.content.split('\n')
            return (
              <Box key={idx} flexDirection="column" marginBottom={1} paddingLeft={2}>
                {lines.map((line, li) => {
                  const spans = parseInline(line)
                  return (
                    <Box key={li}>
                      <Text color={theme.border}>▎ </Text>
                      {renderInline(spans, theme.muted)}
                    </Box>
                  )
                })}
              </Box>
            )
          }
          case 'list': {
            const items = block.content.split('\n')
            return (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                {items.map((item, i) => {
                  const isOrdered = /^\s*\d+\.\s+/.test(item)
                  const cleaned = item.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, '')
                  const indent = item.match(/^\s*/)?.[0].length || 0
                  const spans = parseInline(cleaned)
                  return (
                    <Box key={i} paddingLeft={Math.floor(indent / 2)}>
                      <Text color={theme.accent}>
                        {isOrdered ? `${i + 1}. ` : '• '}
                      </Text>
                      {renderInline(spans, color)}
                    </Box>
                  )
                })}
              </Box>
            )
          }
          case 'paragraph':
          default: {
            const spans = parseInline(block.content)
            return (
              <Box key={idx} marginBottom={1}>
                {renderInline(spans, color)}
              </Box>
            )
          }
        }
      })}
    </Box>
  )
}
