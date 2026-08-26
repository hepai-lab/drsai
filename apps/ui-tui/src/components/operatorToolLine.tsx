/**
 * OperatorToolLine — rich, tool-specific renderer for the operator
 * functions returned by ``get_operator_funcs()`` in ``operater_funs.py``.
 *
 * Each operator tool gets a custom icon, human-readable label, and
 * tool-specific argument/result formatting instead of the generic
 * "name + first arg + first result line" of ToolCallLine.
 *
 * Special rendering:
 *   - run_edit: shows a unified diff (− old / + new) in expanded mode
 *   - run_read: shows line count from result
 *   - run_write: shows byte count from result
 *   - run_bash: shows exit code / error detection
 *   - run_grep: shows match/file count
 *   - run_glob: shows file count
 *   - background task tools: show task id / status
 *
 * Compact mode (default): single line with icon + label + key arg + result.
 * Expanded mode (Ctrl+T): multi-line with full args + diff/preview.
 */

import { Box, Text } from 'ink'

import type { ToolCall } from '../app/types.js'
import { theme } from '../theme.js'

// ── Helpers ────────────────────────────────────────────────────────

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}

/** Extract the "path" arg from various possible key names. */
function pathArg(args: Record<string, unknown>): string {
  return isString(args.path) ? args.path
    : isString(args.file) ? args.file
    : isString(args.filepath) ? args.filepath
    : '?'
}

/** Format bytes into human-readable string. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(2)}MB`
}

/** Count non-empty lines in a string. */
function countLines(text: string): number {
  return text.split('\n').filter(l => l.trim()).length
}

// ── Tool metadata ──────────────────────────────────────────────────

interface ToolMeta {
  icon: string
  label: string
}

const TOOL_META: Record<string, ToolMeta> = {
  run_read:             { icon: '📖', label: 'read' },
  run_write:            { icon: '✎',  label: 'write' },
  run_edit:             { icon: '✎',  label: 'edit' },
  run_grep:             { icon: '🔍', label: 'grep' },
  run_glob:             { icon: '📂', label: 'glob' },
  run_bash:             { icon: '$',  label: 'bash' },
  run_bash_background:  { icon: '⚡', label: 'bg'   },
  run_powershell:       { icon: '$',  label: 'ps'   },
  run_powershell_background: { icon: '⚡', label: 'ps-bg' },
  get_bash_task:        { icon: '⏱',  label: 'task' },
  get_powershell_task:  { icon: '⏱',  label: 'task' },
  list_bash_tasks:      { icon: '☰',  label: 'tasks' },
  list_powershell_tasks:{ icon: '☰',  label: 'tasks' },
  kill_bash_task:       { icon: '☠',  label: 'kill' },
  kill_powershell_task: { icon: '☠',  label: 'kill' },
}

export function isOperatorTool(tool: ToolCall): boolean {
  return tool.name in TOOL_META
}

function metaFor(name: string): ToolMeta {
  return TOOL_META[name] ?? { icon: '●', label: name }
}

// ── Per-tool compact argument formatting ────────────────────────────

function compactArg(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'run_read':
    case 'run_write':
    case 'run_edit':
      return pathArg(args)

    case 'run_grep': {
      const pattern = isString(args.pattern) ? args.pattern : '?'
      const p = isString(args.path) ? ` @ ${args.path}` : ''
      return `"${truncate(pattern, 40)}"${p}`
    }

    case 'run_glob': {
      const pattern = isString(args.pattern) ? args.pattern : '?'
      return truncate(pattern, 50)
    }

    case 'run_bash':
    case 'run_bash_background':
    case 'run_powershell':
    case 'run_powershell_background': {
      const cmd = isString(args.cmd) ? args.cmd
        : isString(args.command) ? args.command : '?'
      return truncate(cmd, 70)
    }

    case 'get_bash_task':
    case 'get_powershell_task': {
      const id = isString(args.task_id) ? args.task_id : '?'
      return truncate(id, 30)
    }

    case 'kill_bash_task':
    case 'kill_powershell_task': {
      const id = isString(args.task_id) ? args.task_id : '?'
      const force = args.force ? ' --force' : ''
      return `${truncate(id, 30)}${force}`
    }

    default:
      return ''
  }
}

// ── Per-tool compact result formatting ──────────────────────────────

function compactResult(name: string, result: string | undefined, args: Record<string, unknown>): string {
  if (!result) return ''

  switch (name) {
    case 'run_read': {
      const lines = countLines(result)
      return `${lines} lines`
    }

    case 'run_write': {
      // Result format: "Wrote N bytes (X MB) to path"
      const m = result.match(/Wrote (\d+) bytes/)
      if (m) return formatBytes(parseInt(m[1]))
      return truncate(result, 60)
    }

    case 'run_edit': {
      if (result.startsWith('Error:')) return '✗ not found'
      return 'edited'
    }

    case 'run_grep': {
      if (result.startsWith('Error:')) return truncate(result, 50)
      // Count lines that look like file paths or match lines
      const lines = result.split('\n').filter(l => l.trim())
      const mode = isString(args.output_mode) ? args.output_mode : 'content'
      if (mode === 'files_with_matches' || mode === 'files-with-matches') {
        return `${lines.length} files`
      }
      if (mode === 'count') {
        return truncate(result.split('\n')[0], 50)
      }
      return `${lines.length} matches`
    }

    case 'run_glob': {
      if (result.startsWith('Error:')) return truncate(result, 50)
      const lines = result.split('\n').filter(l => l.trim())
      return `${lines.length} files`
    }

    case 'run_bash':
    case 'run_powershell': {
      if (result.startsWith('Error:')) {
        // Extract key error info
        if (result.includes('timed out')) return 'timeout'
        return truncate(result.replace(/^Error:\s*/, ''), 50)
      }
      // Check for exit code in output
      const exitMatch = result.match(/exit code[:\s]*(\d+)/i)
      if (exitMatch) return `exit ${exitMatch[1]}`
      return truncate(result.split('\n').find(l => l.trim()) ?? '', 50)
    }

    case 'run_bash_background':
    case 'run_powershell_background': {
      // Result contains task ID
      const taskMatch = result.match(/task[_-]?id[:\s]*([a-f0-9-]+)/i)
      if (taskMatch) return `task ${truncate(taskMatch[1], 20)}`
      return truncate(result, 50)
    }

    case 'get_bash_task':
    case 'get_powershell_task': {
      // Extract status from result
      const statusMatch = result.match(/status[:\s]*(\w+)/i)
      if (statusMatch) return statusMatch[1].toLowerCase()
      return truncate(result, 50)
    }

    case 'list_bash_tasks':
    case 'list_powershell_tasks': {
      if (result.includes('No ') || result.includes('no ')) return '0 tasks'
      const lines = result.split('\n').filter(l => l.trim())
      return `${lines.length} tasks`
    }

    case 'kill_bash_task':
    case 'kill_powershell_task': {
      if (result.includes('terminated') || result.includes('killed')) return 'killed'
      if (result.startsWith('Error:')) return 'failed'
      return truncate(result, 40)
    }

    default:
      return truncate(result, 60)
  }
}

// ── Per-tool expanded arg lines ────────────────────────────────────

function expandedArgLines(name: string, args: Record<string, unknown>): string[] {
  const lines: string[] = []

  switch (name) {
    case 'run_read':
    case 'run_write':
    case 'run_edit': {
      lines.push(`  path: ${pathArg(args)}`)
      if (num(args.minilimit) !== undefined || num(args.maxlimit) !== undefined) {
        const min = num(args.minilimit) ?? 0
        const max = num(args.maxlimit) ?? -1
        lines.push(`  range: ${min}${max >= 0 ? `-${max}` : '+'}`)
      }
      if (num(args.timeout) !== undefined) {
        lines.push(`  timeout: ${args.timeout}s`)
      }
      break
    }

    case 'run_grep': {
      if (isString(args.pattern)) lines.push(`  pattern: ${args.pattern}`)
      if (isString(args.path)) lines.push(`  path: ${args.path}`)
      if (isString(args.output_mode) && args.output_mode !== 'files_with_matches')
        lines.push(`  mode: ${args.output_mode}`)
      if (isString(args.glob)) lines.push(`  glob: ${args.glob}`)
      if (num(args.context_before) || num(args.context_after))
        lines.push(`  context: -${args.context_before ?? 0}/+${args.context_after ?? 0}`)
      break
    }

    case 'run_glob': {
      if (isString(args.pattern)) lines.push(`  pattern: ${args.pattern}`)
      if (isString(args.search_path)) lines.push(`  search_path: ${args.search_path}`)
      break
    }

    case 'run_bash':
    case 'run_bash_background':
    case 'run_powershell':
    case 'run_powershell_background': {
      const cmd = isString(args.cmd) ? args.cmd : isString(args.command) ? args.command : ''
      // Show full command, wrapped to terminal width
      lines.push(`  cmd: ${cmd}`)
      if (num(args.timeout) !== undefined) {
        lines.push(`  timeout: ${args.timeout}s`)
      }
      break
    }

    case 'get_bash_task':
    case 'get_powershell_task': {
      if (isString(args.task_id)) lines.push(`  task_id: ${args.task_id}`)
      break
    }

    case 'kill_bash_task':
    case 'kill_powershell_task': {
      if (isString(args.task_id)) lines.push(`  task_id: ${args.task_id}`)
      if (args.force !== undefined) lines.push(`  force: ${args.force}`)
      break
    }

    default:
      // Fallback: show all args
      for (const [k, v] of Object.entries(args)) {
        const vs = typeof v === 'string' ? v : JSON.stringify(v)
        lines.push(`  ${k}: ${truncate(vs, 100)}`)
      }
  }

  return lines
}

// ── Per-tool expanded result lines ──────────────────────────────────

interface ExpandedResult {
  lines: { text: string; color?: string }[]
  truncated: number
}

const MAX_RESULT_LINES = 5
const MAX_RESULT_LINE_LEN = 120

function expandedResult(
  name: string,
  result: string | undefined,
  args: Record<string, unknown>,
): ExpandedResult {
  if (!result) return { lines: [], truncated: 0 }

  switch (name) {
    // ── run_edit: show diff ──────────────────────────────────────
    case 'run_edit': {
      if (result.startsWith('Error:')) {
        return {
          lines: [{ text: result, color: theme.error }],
          truncated: 0,
        }
      }
      return editDiff(args)
    }

    // ── run_read: show line count + preview ─────────────────────
    case 'run_read': {
      const total = countLines(result)
      const all = result.split('\n')
      const nonEmpty = all.filter(l => l.trim())
      const show = nonEmpty.slice(0, MAX_RESULT_LINES)
      const truncated = Math.max(0, nonEmpty.length - show.length)
      return {
        lines: [
          { text: `${total} lines`, color: theme.good },
          ...show.map(l => ({ text: `  ${truncate(l, MAX_RESULT_LINE_LEN)}`, color: theme.muted })),
        ],
        truncated,
      }
    }

    // ── run_write: show bytes written ────────────────────────────
    case 'run_write': {
      const m = result.match(/Wrote (\d+) bytes/)
      const bytes = m ? parseInt(m[1]) : result.length
      return {
        lines: [{ text: `wrote ${formatBytes(bytes)}`, color: theme.good }],
        truncated: 0,
      }
    }

    // ── run_grep: show match count + preview ────────────────────
    case 'run_grep': {
      if (result.startsWith('Error:')) {
        return { lines: [{ text: result, color: theme.error }], truncated: 0 }
      }
      const mode = isString(args.output_mode) ? args.output_mode : 'content'
      const all = result.split('\n').filter(l => l.trim())
      const show = all.slice(0, MAX_RESULT_LINES)
      const truncated = Math.max(0, all.length - show.length)
      const summary = mode === 'files_with_matches'
        ? `${all.length} files matched`
        : mode === 'count'
          ? all[0] ?? ''
          : `${all.length} matches`
      return {
        lines: [
          { text: summary, color: theme.good },
          ...show.map(l => ({ text: `  ${truncate(l, MAX_RESULT_LINE_LEN)}`, color: theme.muted })),
        ],
        truncated,
      }
    }

    // ── run_glob: show file count + list ─────────────────────────
    case 'run_glob': {
      if (result.startsWith('Error:')) {
        return { lines: [{ text: result, color: theme.error }], truncated: 0 }
      }
      const all = result.split('\n').filter(l => l.trim())
      const show = all.slice(0, MAX_RESULT_LINES)
      const truncated = Math.max(0, all.length - show.length)
      return {
        lines: [
          { text: `${all.length} files`, color: theme.good },
          ...show.map(l => ({ text: `  ${truncate(l, MAX_RESULT_LINE_LEN)}`, color: theme.muted })),
        ],
        truncated,
      }
    }

    // ── run_bash: show output preview ───────────────────────────
    case 'run_bash':
    case 'run_powershell': {
      if (result.startsWith('Error:')) {
        return { lines: [{ text: result, color: theme.error }], truncated: 0 }
      }
      const all = result.split('\n').filter(l => l.trim())
      const show = all.slice(0, MAX_RESULT_LINES)
      const truncated = Math.max(0, all.length - show.length)
      return {
        lines: show.map(l => ({ text: `  ${truncate(l, MAX_RESULT_LINE_LEN)}`, color: theme.muted })),
        truncated,
      }
    }

    // ── background task tools ────────────────────────────────────
    case 'run_bash_background':
    case 'run_powershell_background': {
      return { lines: [{ text: result, color: theme.good }], truncated: 0 }
    }

    case 'get_bash_task':
    case 'get_powershell_task': {
      const all = result.split('\n').filter(l => l.trim())
      const show = all.slice(0, MAX_RESULT_LINES)
      const truncated = Math.max(0, all.length - show.length)
      return {
        lines: show.map(l => ({ text: `  ${truncate(l, MAX_RESULT_LINE_LEN)}`, color: theme.muted })),
        truncated,
      }
    }

    case 'list_bash_tasks':
    case 'list_powershell_tasks': {
      const all = result.split('\n').filter(l => l.trim())
      const show = all.slice(0, MAX_RESULT_LINES)
      const truncated = Math.max(0, all.length - show.length)
      return {
        lines: show.map(l => ({ text: `  ${truncate(l, MAX_RESULT_LINE_LEN)}`, color: theme.muted })),
        truncated,
      }
    }

    case 'kill_bash_task':
    case 'kill_powershell_task': {
      const color = result.includes('terminated') || result.includes('killed')
        ? theme.good : theme.error
      return { lines: [{ text: result, color }], truncated: 0 }
    }

    default:
      return { lines: [{ text: truncate(result, 200), color: theme.muted }], truncated: 0 }
  }
}

// ── Edit diff renderer ──────────────────────────────────────────────
//
// Shows a line-level diff between old_text and new_text from run_edit.
// Uses a simple LCS-based algorithm to find the minimal edit script:
//   − removed lines (red)
//   + added lines (green)
//   context lines (muted, unchanged)

const MAX_DIFF_LINES = 8  // max lines to show in the diff

interface DiffLine {
  text: string
  type: 'added' | 'removed' | 'context'
}

/** Compute a simple line-level diff using LCS. */
function lineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  // LCS table
  const n = oldLines.length
  const m = newLines.length
  // Optimise: if either is 0, all adds or all removes
  if (n === 0) return newLines.map(t => ({ text: t, type: 'added' as const }))
  if (m === 0) return oldLines.map(t => ({ text: t, type: 'removed' as const }))

  // Build LCS DP table (compact: 2 rows at a time would be complex
  // for backtracking, so use full table — fine for typical edit sizes)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to produce diff
  const result: DiffLine[] = []
  let i = n, j = m
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) {
      result.push({ text: oldLines[i - 1], type: 'context' })
      i--; j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      result.push({ text: oldLines[i - 1], type: 'removed' })
      i--
    } else {
      result.push({ text: newLines[j - 1], type: 'added' })
      j--
    }
  }
  while (i > 0) {
    result.push({ text: oldLines[i - 1], type: 'removed' })
    i--
  }
  while (j > 0) {
    result.push({ text: newLines[j - 1], type: 'added' })
    j--
  }
  result.reverse()
  return result
}

/** Produce expanded result lines for run_edit. */
function editDiff(args: Record<string, unknown>): ExpandedResult {
  const oldText = isString(args.old_text) ? args.old_text : ''
  const newText = isString(args.new_text) ? args.new_text : ''

  // If old and new are identical, nothing changed (shouldn't happen)
  if (oldText === newText) {
    return { lines: [{ text: 'no change', color: theme.muted }], truncated: 0 }
  }

  // If old_text is empty, it's a pure addition
  if (!oldText) {
    const lines = newText.split('\n').slice(0, MAX_DIFF_LINES)
    const truncated = Math.max(0, newText.split('\n').length - lines.length)
    return {
      lines: lines.map(l => ({ text: `+ ${truncate(l, MAX_RESULT_LINE_LEN)}`, color: theme.good })),
      truncated,
    }
  }

  // If new_text is empty, it's a pure deletion
  if (!newText) {
    const lines = oldText.split('\n').slice(0, MAX_DIFF_LINES)
    const truncated = Math.max(0, oldText.split('\n').length - lines.length)
    return {
      lines: lines.map(l => ({ text: `− ${truncate(l, MAX_RESULT_LINE_LEN)}`, color: theme.error })),
      truncated,
    }
  }

  const diff = lineDiff(oldText, newText)

  // Trim context lines: keep only 1 line of context around changes
  // to reduce noise when the edit is small within a large block.
  // But if the total diff is short enough, show everything.
  let trimmed = diff
  if (diff.length > MAX_DIFF_LINES) {
    // Find the first and last changed lines
    let firstChange = -1, lastChange = -1
    for (let k = 0; k < diff.length; k++) {
      if (diff[k].type !== 'context') {
        if (firstChange === -1) firstChange = k
        lastChange = k
      }
    }
    if (firstChange !== -1) {
      const start = Math.max(0, firstChange - 1)
      const end = Math.min(diff.length, lastChange + 2)
      trimmed = diff.slice(start, end)
    }
  }

  const show = trimmed.slice(0, MAX_DIFF_LINES)
  const truncated = Math.max(0, trimmed.length - show.length)

  return {
    lines: show.map(d => ({
      text: `${d.type === 'added' ? '+' : d.type === 'removed' ? '−' : ' '} ${truncate(d.text, MAX_RESULT_LINE_LEN)}`,
      color: d.type === 'added' ? theme.good : d.type === 'removed' ? theme.error : theme.muted,
    })),
    truncated,
  }
}

// ── Component ───────────────────────────────────────────────────────

interface Props {
  tool: ToolCall
  detail: 'compact' | 'expanded'
}

export function OperatorToolLine({ tool, detail }: Props) {
  const m = metaFor(tool.name)
  const running = tool.status === 'running'
  const errored = tool.status === 'error'
  const iconColor = running ? theme.warn : errored ? theme.error : theme.good
  const argStr = compactArg(tool.name, tool.args)

  // ── Compact mode ────────────────────────────────────────────────
  if (detail === 'compact') {
    const resultStr = tool.result ? compactResult(tool.name, tool.result, tool.args) : ''

    if (running) {
      return (
        <Box paddingLeft={2}>
          <Text color={iconColor}>{m.icon} </Text>
          <Text color={theme.tool}>{m.label}</Text>
          {argStr && <Text color={theme.muted}> {argStr}</Text>}
          <Text color={theme.muted} dimColor> …running</Text>
        </Box>
      )
    }

    if (errored) {
      return (
        <Box paddingLeft={2}>
          <Text color={theme.error}>{m.icon} </Text>
          <Text color={theme.tool}>{m.label}</Text>
          {argStr && <Text color={theme.muted}> {argStr}</Text>}
          <Text color={theme.error}> failed</Text>
        </Box>
      )
    }

    return (
      <Box paddingLeft={2}>
        <Text color={iconColor}>{m.icon} </Text>
        <Text color={theme.tool}>{m.label}</Text>
        {argStr && <Text color={theme.muted}> {argStr}</Text>}
        <Text color={theme.muted} dimColor> ({tool.durationMs ?? 0}ms)</Text>
        {resultStr && (
          <>
            <Text color={theme.muted}> → </Text>
            <Text color={theme.good}>{resultStr}</Text>
          </>
        )}
      </Box>
    )
  }

  // ── Expanded mode ───────────────────────────────────────────────
  const argLines = expandedArgLines(tool.name, tool.args)
  const { lines: resLines, truncated } = expandedResult(tool.name, tool.result, tool.args)

  if (running) {
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Box>
          <Text color={iconColor}>{m.icon} </Text>
          <Text color={theme.tool}>{m.label}</Text>
          {argStr && <Text color={theme.muted}> {argStr}</Text>}
          <Text color={theme.muted} dimColor> …running</Text>
        </Box>
        {argLines.map((line, i) => (
          <Text key={`a${i}`} color={theme.muted}>{line}</Text>
        ))}
      </Box>
    )
  }

  if (errored) {
    return (
      <Box paddingLeft={2} flexDirection="column">
        <Box>
          <Text color={theme.error}>{m.icon} </Text>
          <Text color={theme.tool}>{m.label}</Text>
          {argStr && <Text color={theme.muted}> {argStr}</Text>}
          <Text color={theme.error}> failed</Text>
        </Box>
        {argLines.map((line, i) => (
          <Text key={`a${i}`} color={theme.muted}>{line}</Text>
        ))}
      </Box>
    )
  }

  return (
    <Box paddingLeft={2} flexDirection="column">
      <Box>
        <Text color={iconColor}>{m.icon} </Text>
        <Text color={theme.tool}>{m.label}</Text>
        {argStr && <Text color={theme.muted}> {argStr}</Text>}
        <Text color={theme.muted} dimColor> ({tool.durationMs ?? 0}ms)</Text>
      </Box>
      {argLines.map((line, i) => (
        <Text key={`a${i}`} color={theme.muted}>{line}</Text>
      ))}
      {resLines.length > 0 && (
        <>
          {tool.name === 'run_edit' ? null : <Text color={theme.muted}>  →</Text>}
          {resLines.map((line, i) => (
            <Text key={`r${i}`} color={line.color ?? theme.muted}>{line.text}</Text>
          ))}
          {truncated > 0 && (
            <Text color={theme.muted} dimColor>{`  …+${truncated} more line${truncated > 1 ? 's' : ''}`}</Text>
          )}
        </>
      )}
    </Box>
  )
}
