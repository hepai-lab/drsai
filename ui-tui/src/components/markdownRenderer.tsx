/**
 * markdownRenderer.tsx — improved markdown renderer for Phase 4.
 *
 * Supports:
 *   - Code blocks (```lang ... ```) with language label
 *   - Inline code (`code`)
 *   - Lists (- item, 1. item)
 *   - Bold (**text**) and italic (*text*)
 *   - Headers (# H1, ## H2, etc.)
 *   - Blockquotes (> text)
 *
 * Still renders as plain Ink Text (no syntax highlighting yet — that's Phase 4+).
 */

import { Box, Text } from 'ink'
import type { ReactElement } from 'react'

import { theme } from '../theme.js'

interface MarkdownRendererProps {
  text: string
  color?: string
}

const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/g
const PARTIAL_THINK_OPEN_RE = /<think>[\s\S]*$/

export function stripThinkBlocks(text: string): string {
  return text
    .replace(THINK_BLOCK_RE, '')
    .replace(PARTIAL_THINK_OPEN_RE, '')
    .replace(/^\s+|\s+$/g, m => (m.includes('\n') ? '\n' : ''))
}

interface Block {
  type: 'paragraph' | 'code' | 'list' | 'header' | 'blockquote' | 'table'
  content: string
  lang?: string
  level?: number
  rows?: string[][]  // for table
}

function isTableSeparator(line: string): boolean {
  // matches: |---|---| or | :--- | ---: | etc.
  return /^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(line)
}

function splitTableRow(line: string): string[] {
  // Strip leading/trailing pipes then split on |
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(c => c.trim())
}

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
      blocks.push({ type: 'code', content: codeLines.join('\n'), lang: lang || 'text' })
      i++ // skip closing ```
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

    // Table: header row + separator + body rows
    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const rows: string[][] = [splitTableRow(line)]
      i += 2  // skip header + separator
      while (i < lines.length && lines[i].trim().startsWith('|')) {
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
      !lines[i].trim().startsWith('|') &&
      !lines[i].match(/^\s*[-*+]\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/)
    ) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push({ type: 'paragraph', content: paraLines.join('\n') })
  }

  return blocks
}

interface InlineSpan {
  type: 'text' | 'bold' | 'italic' | 'code'
  text: string
}

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
      i++ // skip closing `
      continue
    }

    // Bold
    if (text.slice(i, i + 2) === '**') {
      flush()
      i += 2
      let bold = ''
      while (i < text.length && text.slice(i, i + 2) !== '**') {
        bold += text[i]
        i++
      }
      spans.push({ type: 'bold', text: bold })
      i += 2
      continue
    }

    // Italic
    if (text[i] === '*' && text[i + 1] !== '*') {
      flush()
      i++
      let italic = ''
      while (i < text.length && text[i] !== '*') {
        italic += text[i]
        i++
      }
      spans.push({ type: 'italic', text: italic })
      i++
      continue
    }

    current += text[i]
    i++
  }

  flush()
  return spans
}

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
      default:
        return (
          <Text key={idx} color={defaultColor}>
            {span.text}
          </Text>
        )
    }
  })
}

export function MarkdownRenderer({ text, color }: MarkdownRendererProps) {
  const blocks = parseBlocks(text)
  if (blocks.length === 0) return null

  return (
    <Box flexDirection="column">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'code': {
            // Render with a left "▎" gutter rather than a full border, so the
            // block hugs content width instead of stretching to the terminal.
            // Each content line gets its own row so the gutter aligns visually.
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
            return (
              <Box key={idx} marginBottom={1}>
                <Text bold color={headerColor}>
                  {block.content}
                </Text>
              </Box>
            )
          }
          case 'table': {
            const rows = block.rows || []
            if (rows.length === 0) return null
            // Compute column widths (cap at 30 chars to avoid blowing out terminal)
            const colCount = Math.max(...rows.map(r => r.length))
            const widths: number[] = []
            for (let c = 0; c < colCount; c++) {
              let w = 0
              for (const r of rows) {
                const cell = (r[c] ?? '').length
                if (cell > w) w = cell
              }
              widths.push(Math.min(w, 30))
            }
            const pad = (s: string, w: number) => {
              if (s.length >= w) return s.slice(0, w)
              return s + ' '.repeat(w - s.length)
            }
            const sep = '┼'
            const dash = (w: number) => '─'.repeat(w + 2)
            return (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                {/* header */}
                <Text color={theme.accent} bold>
                  {'│ ' + rows[0].slice(0, colCount).map((c, ci) => pad(c, widths[ci])).join(' │ ') + ' │'}
                </Text>
                {/* divider */}
                <Text color={theme.border}>
                  {'├' + widths.map(w => dash(w)).join(sep) + '┤'}
                </Text>
                {/* body */}
                {rows.slice(1).map((r, ri) => (
                  <Text key={ri} color={color}>
                    {'│ ' + Array.from({ length: colCount }, (_, ci) =>
                      pad(r[ci] ?? '', widths[ci]),
                    ).join(' │ ') + ' │'}
                  </Text>
                ))}
              </Box>
            )
          }
          case 'blockquote':
            return (
              <Box key={idx} marginBottom={1} paddingLeft={2}>
                <Text color={theme.muted} italic>
                  ▎ {block.content}
                </Text>
              </Box>
            )
          case 'list': {
            const items = block.content.split('\n')
            return (
              <Box key={idx} flexDirection="column" marginBottom={1}>
                {items.map((item, i) => {
                  const cleaned = item.replace(/^\s*[-*+]\s+/, '').replace(/^\s*\d+\.\s+/, '')
                  const indent = item.match(/^\s*/)?.[0].length || 0
                  const spans = parseInline(cleaned)
                  return (
                    <Box key={i} paddingLeft={Math.floor(indent / 2)}>
                      <Text color={theme.accent}>• </Text>
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
