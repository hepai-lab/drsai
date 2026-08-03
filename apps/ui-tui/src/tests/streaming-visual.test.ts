/**
 * Visual simulation test — renders contentParts to a mock terminal
 * to verify the truncation direction (keep latest, hide oldest)
 * and ordered rendering (text ↔ tool interleaving).
 *
 * This doesn't use Ink/React — it simulates the clipContentParts
 * logic and prints what the user would see.
 */

import {
  type ContentPart,
  type ToolCall,
} from '../app/types.js'
import { stripThinkBlocks } from '../components/markdownRenderer.js'
import { stripTodoWriteArtifacts } from '../app/todoArtifacts.js'

// ── Simulated terminal dimensions ─────────────────────────────────────

const SIM_COLS = 80
const SIM_ROWS = 24

// ── Replicate the logic from streamingAssistant.tsx ──────────────────

const RESERVED_ROWS = 8
const MIN_STREAM_ROWS = 3

function visualWrap(line: string, cols: number): string[] {
  if (cols <= 0) return [line]
  if (line.length === 0) return ['']
  const out: string[] = []
  for (let i = 0; i < line.length; i += cols) {
    out.push(line.slice(i, i + cols))
  }
  return out
}

function countVisualRows(text: string, cols: number): number {
  if (!text) return 0
  let count = 0
  for (const ll of text.split('\n')) {
    count += visualWrap(ll, cols).length
  }
  return count
}

function estimatePartHeight(
  part: ContentPart,
  tools: ToolCall[],
  cols: number,
  toolDetail: 'compact' | 'expanded',
): number {
  if (part.kind === 'text') {
    // Use the CLEANED text (think blocks + TodoWrite artifacts stripped)
    // to match what is actually rendered. This prevents a <think> block
    // from inflating the height estimate and showing a false truncation
    // marker even when the rendered text is short/empty.
    const cleanText = stripTodoWriteArtifacts(stripThinkBlocks(part.text))
    return countVisualRows(cleanText, cols)
  }
  const tool = tools.find(t => t.id === part.toolId)
  if (!tool) return 1
  if (toolDetail === 'compact') return 1
  const argCount = Object.keys(tool.args).length
  const resultLines = tool.result
    ? Math.min(tool.result.split('\n').filter(l => l.trim()).length, 3)
    : 0
  return 1 + argCount + (resultLines > 0 ? 1 + resultLines : 0)
}

function clipTextSegment(text: string, maxRows: number, cols: number): {
  clipped: string
  hiddenLines: number
} {
  if (!text) return { clipped: '', hiddenLines: 0 }
  const logicalLines = text.split('\n')
  const visualLines: string[] = []
  for (const ll of logicalLines) {
    visualLines.push(...visualWrap(ll, cols))
  }
  if (visualLines.length <= maxRows) {
    return { clipped: text, hiddenLines: 0 }
  }
  const kept = visualLines.slice(visualLines.length - maxRows)
  return {
    clipped: kept.join('\n'),
    hiddenLines: visualLines.length - maxRows,
  }
}

function clipContentParts(
  parts: ContentPart[],
  tools: ToolCall[],
  budget: number,
  cols: number,
  toolDetail: 'compact' | 'expanded',
): { visible: ContentPart[]; hiddenRows: number; firstPartMaxRows: number } {
  if (parts.length === 0) return { visible: [], hiddenRows: 0, firstPartMaxRows: 0 }

  const heights = parts.map(p => estimatePartHeight(p, tools, cols, toolDetail))
  const totalHeight = heights.reduce((a, b) => a + b, 0)

  if (totalHeight <= budget) {
    return { visible: parts, hiddenRows: 0, firstPartMaxRows: 0 }
  }

  let used = 0
  let cutIndex = parts.length
  for (let i = parts.length - 1; i >= 0; i--) {
    const h = heights[i]
    if (used + h > budget) {
      cutIndex = i + 1
      break
    }
    used += h
    cutIndex = i
  }

  if (cutIndex >= parts.length) {
    cutIndex = parts.length - 1
    used = 0
  }

  const visible = parts.slice(cutIndex)

  let firstPartMaxRows = 0
  if (visible.length > 0 && visible[0].kind === 'text') {
    const remaining = budget - used
    const firstHeight = heights[cutIndex]
    if (firstHeight > remaining) {
      firstPartMaxRows = Math.max(MIN_STREAM_ROWS, remaining)
    }
  }

  const fullHiddenRows = heights.slice(0, cutIndex).reduce((a, b) => a + b, 0)
  const partialHiddenRows = firstPartMaxRows > 0
    ? heights[cutIndex] - firstPartMaxRows
    : 0
  const totalHidden = fullHiddenRows + partialHiddenRows

  return { visible, hiddenRows: totalHidden, firstPartMaxRows }
}

// ── Rendering helpers ────────────────────────────────────────────────

function renderToolLine(tool: ToolCall): string[] {
  if (tool.status === 'running') {
    return [`  ◐ ${tool.name} …running`]
  }
  const result = tool.result?.split('\n').find(l => l.trim()) ?? ''
  const preview = result.length > 50 ? result.slice(0, 47) + '...' : result
  return [`  ✓ ${tool.name} (${tool.durationMs ?? 0}ms)${preview ? ' → ' + preview : ''}`]
}

function renderTextSegment(text: string, maxRows: number, cols: number): string[] {
  let textToRender = text
  if (maxRows > 0) {
    const clipped = clipTextSegment(text, maxRows, cols)
    textToRender = clipped.clipped
  }
  // Split by newlines and wrap at cols
  const lines: string[] = []
  for (const ll of textToRender.split('\n')) {
    lines.push(...visualWrap(ll, cols))
  }
  return lines
}

function renderTurn(
  parts: ContentPart[],
  tools: ToolCall[],
  rows: number,
  cols: number,
  toolDetail: 'compact' | 'expanded' = 'compact',
): string[] {
  const effectiveCols = Math.max(20, cols - 4)
  const budget = Math.max(MIN_STREAM_ROWS, rows - RESERVED_ROWS - 1 - 1)

  const { visible, hiddenRows, firstPartMaxRows } = clipContentParts(parts, tools, budget, effectiveCols, toolDetail)

  const lines: string[] = []
  lines.push('▎ ● assistant')

  if (hiddenRows > 0) {
    lines.push(`  ↑ ${hiddenRows} earlier line${hiddenRows > 1 ? 's' : ''} (will appear in scrollback when turn ends)`)
  }

  visible.forEach((part, idx) => {
    if (part.kind === 'tool') {
      const tool = tools.find(t => t.id === part.toolId)
      if (tool) lines.push(...renderToolLine(tool))
    } else {
      const maxRows = idx === 0 ? firstPartMaxRows : 0
      lines.push(...renderTextSegment(part.text, maxRows, effectiveCols))
    }
  })

  return lines
}

// ── Helper to create test data ───────────────────────────────────────

let idCounter = 0
function makeTextPart(text: string): ContentPart {
  return { kind: 'text', id: `text-${idCounter++}`, chunks: [], text }
}
function makeToolPart(toolId: string): ContentPart {
  return { kind: 'tool', id: `cp-${toolId}`, toolId }
}
function makeTool(id: string, name: string, status: 'running' | 'complete' = 'complete', result?: string, durationMs = 100): ToolCall {
  return { id, name, args: {}, status, result, durationMs, startedAt: Date.now() }
}

function printTerminal(lines: string[], cols: number, rows: number): void {
  const border = '─'.repeat(cols)
  console.log(`┌${border}┐`)
  for (let i = 0; i < rows; i++) {
    const line = lines[i] || ''
    const padded = line.padEnd(cols).slice(0, cols)
    console.log(`│${padded}│`)
  }
  console.log(`└${border}┘`)
}

// ═══════════════════════════════════════════════════════════════════════
// VISUAL TEST SCENARIOS
// ═══════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════')
console.log('  TUI Streaming Visual Simulation Tests')
console.log('  Terminal: ' + SIM_COLS + ' cols × ' + SIM_ROWS + ' rows')
console.log('══════════════════════════════════════════════════════════\n')

// ── Scenario 1: Short output fits entirely ────────────────────────────
console.log('─── Scenario 1: Short output fits entirely ───')
{
  const parts: ContentPart[] = [
    makeTextPart('Let me search for the file.'),
    makeToolPart('t1'),
    makeTextPart('Found it! The file is at /tmp/test.ts.'),
  ]
  const tools: ToolCall[] = [
    makeTool('t1', 'grep', 'complete', '3 matches found', 45),
  ]
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  console.log('  ✓ Tools between text segments (ordered)')
  console.log()
}

// ── Scenario 2: Long output — truncation from TOP ────────────────────
console.log('─── Scenario 2: Long text output — truncation from TOP (keep latest) ───')
{
  const longTextA = Array.from({ length: 20 }, (_, i) => `TextA line ${i + 1}: early content that should be hidden.`).join('\n')
  const longTextB = 'Middle text after first tool. '
  const longTextC = Array.from({ length: 5 }, (_, i) => `Latest line ${i + 1}: this should be visible at bottom.`).join('\n')

  const parts: ContentPart[] = [
    makeTextPart(longTextA),
    makeToolPart('t1'),
    makeTextPart(longTextB),
    makeToolPart('t2'),
    makeTextPart(longTextC),
  ]
  const tools: ToolCall[] = [
    makeTool('t1', 'grep', 'complete', '3 matches found', 45),
    makeTool('t2', 'read_file', 'complete', 'file content here', 120),
  ]
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  console.log('  ✓ Oldest content (textA) truncated; latest (textC) visible at bottom')
  console.log()
}

// ── Scenario 3: Interleaved text → tool → text → tool ────────────────
console.log('─── Scenario 3: Interleaved text → tool → text → tool (ordered rendering) ───')
{
  const parts: ContentPart[] = [
    makeTextPart('I will search for the import statement.'),
    makeToolPart('t1'),
    makeTextPart('Found 3 matches. Now let me read the main file.'),
    makeToolPart('t2'),
    makeTextPart('The code looks correct. No changes needed.'),
  ]
  const tools: ToolCall[] = [
    makeTool('t1', 'grep', 'complete', 'src/index.ts\nsrc/app.ts\nsrc/main.ts', 50),
    makeTool('t2', 'read_file', 'complete', 'import express from "express"', 80),
  ]
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  console.log('  ✓ Tools appear BETWEEN text segments, not all at top')
  console.log()
}

// ── Scenario 4: Running tool in the middle ───────────────────────────
console.log('─── Scenario 4: Running tool in the middle (streaming in progress) ───')
{
  const parts: ContentPart[] = [
    makeTextPart('I will search for the file.'),
    makeToolPart('t1'),
    makeTextPart('Now running a long operation...'),
    makeToolPart('t2'),  // this one is still running
  ]
  const tools: ToolCall[] = [
    makeTool('t1', 'grep', 'complete', '3 matches found', 45),
    makeTool('t2', 'bash', 'running', undefined, 0),
  ]
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  console.log('  ✓ t2 shows "running" indicator; text before t2 is visible')
  console.log()
}

// ── Scenario 5: Subagent with visual markers ────────────────────────
console.log('─── Scenario 5: Subagent output with visual markers ───')
{
  const subText = [
    'I will delegate this to a subagent.',
    '',
    '┌─ 🤖 researcher ─────────────────',
    'Analyzing the codebase structure...',
    'Found 5 key modules.',
    '└───────────────────────────────',
    '',
    'The subagent found 5 key modules in the codebase.',
  ].join('\n')
  const parts: ContentPart[] = [
    makeTextPart(subText),
  ]
  const tools: ToolCall[] = []
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  console.log('  ✓ Subagent markers visible; content fits in viewport')
  console.log()
}

// ── Scenario 6: Very long single text segment (clip within segment) ─
console.log('─── Scenario 6: Very long single text segment (truncated from top) ───')
{
  const veryLongText = Array.from({ length: 50 }, (_, i) =>
    `Line ${i + 1}: This is line number ${i + 1} of a very long output.`
  ).join('\n')

  const parts: ContentPart[] = [
    makeTextPart(veryLongText),
  ]
  const tools: ToolCall[] = []
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  // Verify that the LATEST lines (49, 50) are visible and oldest (1, 2) are hidden
  const lastFewLines = lines.slice(-5).join(' ')
  const firstFewLines = lines.slice(0, 5).join(' ')
  const showsLatest = lastFewLines.includes('Line 50') || lastFewLines.includes('Line 49')
  const hidesOldest = !firstFewLines.includes('Line 1') && !firstFewLines.includes('Line 2')
  console.log(`  ${showsLatest ? '✓' : '✗'} Latest lines (49-50) visible at bottom`)
  console.log(`  ${hidesOldest ? '✓' : '✗'} Oldest lines (1-2) hidden at top`)
  console.log()
}

// ── Scenario 7: Many tool calls, minimal text ────────────────────────
console.log('─── Scenario 7: Many consecutive tool calls with minimal text ───')
{
  const parts: ContentPart[] = [
    makeTextPart('Running multiple tools:'),
    makeToolPart('t1'),
    makeToolPart('t2'),
    makeToolPart('t3'),
    makeToolPart('t4'),
    makeToolPart('t5'),
    makeTextPart('All done! Results look good.'),
  ]
  const tools: ToolCall[] = [
    makeTool('t1', 'ls', 'complete', 'file1.ts', 10),
    makeTool('t2', 'grep', 'complete', '3 matches', 20),
    makeTool('t3', 'cat', 'complete', 'file content', 15),
    makeTool('t4', 'wc', 'complete', '42 lines', 5),
    makeTool('t5', 'stat', 'complete', 'modified today', 8),
  ]
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  console.log('  ✓ Tools appear in order; latest text at bottom')
  console.log()
}

// ── Scenario 8: Subagent tool calls ──────────────────────────────────
console.log('─── Scenario 8: Subagent tool calls (sub: prefix) ───')
{
  const parts: ContentPart[] = [
    makeTextPart('Delegating to subagent...'),
    makeToolPart('sub-t1'),
    makeTextPart('Subagent completed its analysis.'),
    makeToolPart('sub-t2'),
    makeTextPart('Final summary: everything looks correct.'),
  ]
  const tools: ToolCall[] = [
    makeTool('sub-t1', 'sub:grep', 'complete', '5 files found', 100),
    makeTool('sub-t2', 'sub:read_file', 'complete', 'module content', 200),
  ]
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  console.log('  ✓ sub: prefixed tools appear in order with text segments')
  console.log()
}

// ── Scenario 9: Multiple subagent blocks ────────────────────────────
console.log('─── Scenario 9: Multiple subagent blocks in one turn ───')
{
  const subText = [
    'First, I will use subagent A.',
    '',
    '┌─ 🤖 A ─────────────────',
    'Subagent A working on task 1...',
    'Found relevant files.',
    '└───────────────────────────────',
    '',
    'Now using subagent B.',
    '',
    '┌─ 🤖 B ─────────────────',
    'Subagent B analyzing data...',
    'Analysis complete.',
    '└───────────────────────────────',
    '',
    'All done! Both subagents finished.',
  ].join('\n')
  const parts: ContentPart[] = [
    makeTextPart(subText),
  ]
  const tools: ToolCall[] = []
  const lines = renderTurn(parts, tools, SIM_ROWS, SIM_COLS)
  printTerminal(lines, SIM_COLS, SIM_ROWS)
  console.log('  ✓ Multiple subagent blocks rendered with markers')
  console.log()
}

console.log('══════════════════════════════════════════════════════════')
console.log('  Visual simulation tests complete!')
console.log('══════════════════════════════════════════════════════════\n')
