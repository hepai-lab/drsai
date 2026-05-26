/**
 * TextInput — multiline text input for Ink with command history + Tab completion.
 *
 * Features:
 *   - Enter              submit (single-line) / see paste note below
 *   - Alt+Enter / Shift+Enter / Esc then Enter / Ctrl+O  insert newline
 *   - Backspace          delete one char
 *   - Left/Right         move cursor
 *   - Up/Down            move between lines in multiline input;
 *                        at boundary (first/last line) walk command history
 *   - Tab                cycle through slash-command completions
 *   - Ctrl+A / Ctrl+E    start / end of current line
 *   - Ctrl+U             clear current line
 *   - Ctrl+Home          start of entire text (if terminal sends it)
 *   - Ctrl+End           end of entire text (if terminal sends it)
 *
 * Paste handling:
 *   Modern terminals with bracketed-paste send the entire pasted text as a
 *   single `input` string including `\n` — no special handling needed.
 *   For terminals without bracketed-paste, we detect rapid Return keypresses
 *   (< 80 ms after previous input) as part of a paste and insert a newline
 *   instead of submitting.
 *
 * Command history persists in-memory for the session; the parent supplies
 * `completions` (a flat list of `/command` strings) to drive Tab.
 */

import { Box, Text, useInput } from 'ink'
import { useRef, useState } from 'react'

import { theme } from '../theme.js'

const BRACKET_PASTE_RE = /\x1b?\[20[01]~/g
const BRACKET_PASTE_DETECT_RE = /\x1b?\[20[01]~/

function normalisePastedText(text: string): string {
  return text.replace(BRACKET_PASTE_RE, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function looksLikePastedText(input: string): boolean {
  // Bracketed paste markers are unambiguous — always a paste.
  if (BRACKET_PASTE_DETECT_RE.test(input)) return true
  // Otherwise it's only a paste if it contains a newline AND has more than
  // just the newline itself — a single \n is just the Enter key, which ink
  // sometimes delivers alongside key.return. Treating that as a paste
  // would flip the Enter→submit semantics into Enter→newline.
  if (input.length <= 1) return false
  return input.includes('\n') || input.includes('\r')
}

// ── Helpers: cursor ↔ (line, col) conversion ──────────────────────────

/** Given `value` and a character-offset `cursor`, return [lineIndex, col]. */
function getLineAndCol(value: string, cursor: number): [number, number] {
  const lines = value.slice(0, cursor).split('\n')
  return [lines.length - 1, lines[lines.length - 1].length]
}

/** Given the pre-split `lines` array and a target [line, col], return the
 *  character offset.  Col is clamped to the line's length. */
function cursorFromLineCol(lines: string[], line: number, col: number): number {
  let pos = 0
  for (let i = 0; i < line && i < lines.length; i++) {
    pos += lines[i].length + 1 // +1 for the \n
  }
  if (line < lines.length) {
    pos += Math.min(col, lines[line].length)
  }
  return pos
}

// ── Component ─────────────────────────────────────────────────────────

export interface TextInputProps {
  prompt: string
  placeholder?: string
  disabled?: boolean
  onSubmit: (text: string) => void
  /** When true, Enter on an empty input still fires onSubmit(""). Useful for "press Enter to skip" prompts. */
  allowEmpty?: boolean
  /** Pool of completion candidates (e.g. ["/help", "/model", ...]). Optional. */
  completions?: string[]
  /** Persistent history shared across renders. Caller can supply a ref. */
  history?: string[]
  /** Called whenever this component appends a new history entry. */
  onHistoryChange?: (history: string[]) => void
  /**
   * Called when a multi-character paste payload is detected. The return
   * value controls what ends up in the input value:
   *
   *   - ``string`` → insert that string at the cursor instead of the raw
   *     pasted text. Use this to collapse a long paste into a token like
   *     ``[[ Pasted #1: 1.2k lines ]]`` while the parent stashes the
   *     original text in a side table.
   *   - ``null`` → parent fully handled it; do not modify the input.
   *   - ``undefined`` (or no callback) → fall back to literal insertion.
   */
  onPaste?: (text: string) => string | null | undefined
}

export function TextInput({
  prompt,
  placeholder,
  disabled,
  onSubmit,
  allowEmpty = false,
  completions = [],
  history: externalHistory,
  onHistoryChange,
  onPaste,
}: TextInputProps) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const pendingEscapeRef = useRef(false)

  // Internal history if caller didn't pass one. Stored in a ref so it survives
  // re-renders without triggering them.
  const internalHistoryRef = useRef<string[]>([])
  const history = externalHistory ?? internalHistoryRef.current
  // historyIdx: -1 = composing new entry; 0..len-1 = browsing past
  const [historyIdx, setHistoryIdx] = useState(-1)
  // Snapshot of in-progress text when user starts browsing history, so we can restore
  const draftRef = useRef('')

  // Tab completion state
  const [tabCandidates, setTabCandidates] = useState<string[]>([])
  const [tabIdx, setTabIdx] = useState(0)

  // Paste-burst detection: when a multi-char paste payload is seen, we set
  // `pasteBurstUntilRef` to a short deadline. Any Return key arriving before
  // that deadline is treated as part of the paste (i.e. inserted as \n
  // instead of submitting). This is intentionally a TIGHT window (~60ms);
  // we do not measure time-since-last-typed-key because fast typists hit
  // Return < 80ms after a normal character all the time, and we don't want
  // their Enter to be silently turned into a newline.
  const pasteBurstUntilRef = useRef(0)

  function resetCompletion() {
    if (tabCandidates.length > 0) {
      setTabCandidates([])
      setTabIdx(0)
    }
  }

  function setText(next: string, nextCursor?: number) {
    setValue(next)
    setCursor(nextCursor ?? next.length)
    resetCompletion()
  }

  function insertText(text: string) {
    if (!text) return
    const next = value.slice(0, cursor) + text + value.slice(cursor)
    setValue(next)
    setCursor(cursor + text.length)
    pendingEscapeRef.current = false
    resetCompletion()
    if (historyIdx !== -1) {
      // User edited while browsing history → exit browse mode.
      setHistoryIdx(-1)
      draftRef.current = next
    }
  }

  function insertNewline() {
    insertText('\n')
  }

  useInput((input, key) => {
    if (disabled) return

    // Bracketed-paste and many terminals deliver a paste as one multi-character
    // input payload. Treat it as literal text insertion before key.return can
    // accidentally submit the first line. Also mark a short paste-burst
    // window so any Return key arriving inside it counts as a pasted newline.
    if (input && looksLikePastedText(input)) {
      const pastedText = normalisePastedText(input)
      const replacement = onPaste?.(pastedText)
      if (replacement === undefined) {
        // No callback or it returned undefined → insert raw text.
        insertText(pastedText)
      } else if (replacement === null) {
        // Parent fully handled it (e.g. stored to clipboard buffer).
      } else {
        // Parent returned a substitute string (collapsed token).
        insertText(replacement)
      }
      pasteBurstUntilRef.current = Date.now() + 60
      return
    }

    // Esc then Enter is a portable newline chord in terminals that don't
    // distinguish Shift+Enter. Record Esc here and consume it; the next
    // Enter inserts a newline instead of submitting. Any other key cancels it.
    if (key.escape) {
      pendingEscapeRef.current = true
      return
    }
    if (pendingEscapeRef.current && !key.return) {
      pendingEscapeRef.current = false
    }

    // Ctrl+O: reliable cross-terminal newline shortcut.
    if (key.ctrl && input === 'o') {
      insertNewline()
      return
    }

    // ── Tab: cycle slash command completions ────────────────────────────
    if (key.tab && !key.shift) {
      // Only complete when input looks like a slash command (first word)
      const m = value.match(/^\/(\S*)$/)
      if (!m) return
      const prefix = m[1].toLowerCase()
      const matches = completions.filter(c =>
        c.toLowerCase().startsWith('/' + prefix),
      )
      if (matches.length === 0) return
      if (tabCandidates.length === 0 || tabCandidates[tabIdx] !== value) {
        // Fresh completion cycle
        setTabCandidates(matches)
        setTabIdx(0)
        setValue(matches[0])
        setCursor(matches[0].length)
      } else {
        // Cycle to next
        const next = (tabIdx + 1) % tabCandidates.length
        setTabIdx(next)
        setValue(tabCandidates[next])
        setCursor(tabCandidates[next].length)
      }
      return
    }
    // Shift+Tab: cycle backwards
    if (key.tab && key.shift) {
      if (tabCandidates.length === 0) return
      const prev = (tabIdx - 1 + tabCandidates.length) % tabCandidates.length
      setTabIdx(prev)
      setValue(tabCandidates[prev])
      setCursor(tabCandidates[prev].length)
      return
    }

    // ── Up/Down: line-aware navigation + command history ────────────────
    if (key.upArrow) {
      const allLines = value.split('\n')
      const [curLine, curCol] = getLineAndCol(value, cursor)

      if (curLine > 0) {
        // Move cursor up one line (keep column if possible)
        const newCursor = cursorFromLineCol(allLines, curLine - 1, curCol)
        setCursor(newCursor)
        resetCompletion()
      } else if (history.length > 0) {
        // Already on first line → browse history
        if (historyIdx === -1) {
          // Start browsing — snapshot current draft
          draftRef.current = value
          const last = history.length - 1
          setHistoryIdx(last)
          setText(history[last])
        } else if (historyIdx > 0) {
          setHistoryIdx(historyIdx - 1)
          setText(history[historyIdx - 1])
        }
      }
      return
    }
    if (key.downArrow) {
      const allLines = value.split('\n')
      const [curLine, curCol] = getLineAndCol(value, cursor)

      if (curLine < allLines.length - 1) {
        // Move cursor down one line (keep column if possible)
        const newCursor = cursorFromLineCol(allLines, curLine + 1, curCol)
        setCursor(newCursor)
        resetCompletion()
      } else if (historyIdx !== -1) {
        // Already on last line → browse history forward
        if (historyIdx < history.length - 1) {
          setHistoryIdx(historyIdx + 1)
          setText(history[historyIdx + 1])
        } else {
          // Past the end — restore draft
          setHistoryIdx(-1)
          setText(draftRef.current)
        }
      }
      return
    }

    // ── Enter: submit or newline ────────────────────────────────────────
    if (key.return) {
      // Only treat Return as a pasted newline when we are still inside a
      // paste burst that started with a multi-char paste payload. This
      // avoids the previous heuristic that swallowed normal Enter from
      // fast typists who hit Return shortly after a character.
      const inPasteBurst = Date.now() < pasteBurstUntilRef.current

      if (key.meta || key.shift || pendingEscapeRef.current || inPasteBurst) {
        insertNewline()
        return
      }

      const trimmed = value.trim()
      if (trimmed || allowEmpty) {
        // Push non-empty entries into history (dedupe consecutive) before submit,
        // so the caller can persist it even if submit starts async work.
        if (trimmed && (history.length === 0 || history[history.length - 1] !== trimmed)) {
          history.push(trimmed)
          onHistoryChange?.(history)
        }
        onSubmit(trimmed)
        setHistoryIdx(-1)
        draftRef.current = ''
        pendingEscapeRef.current = false
        setValue('')
        setCursor(0)
        resetCompletion()
      }
      return
    }

    // ── Backspace / Delete ──────────────────────────────────────────────
    if (key.backspace || key.delete) {
      if (cursor === 0) return
      const next = value.slice(0, cursor - 1) + value.slice(cursor)
      setValue(next)
      setCursor(cursor - 1)
      resetCompletion()
      return
    }

    // ── Cursor movement ─────────────────────────────────────────────────
    if (key.leftArrow) {
      setCursor(Math.max(0, cursor - 1))
      resetCompletion()
      return
    }
    if (key.rightArrow) {
      setCursor(Math.min(value.length, cursor + 1))
      resetCompletion()
      return
    }

    // Ctrl+A → start of current line, Ctrl+E → end of current line
    // (In multi-line mode this is more useful than jumping to position 0
    // or value.length; single-line behaviour is identical.)
    if (key.ctrl && input === 'a') {
      const [, col] = getLineAndCol(value, cursor)
      setCursor(cursor - col)
      return
    }
    if (key.ctrl && input === 'e') {
      const [line] = getLineAndCol(value, cursor)
      const lines = value.split('\n')
      const lineStart = cursor - getLineAndCol(value, cursor)[1]
      setCursor(lineStart + lines[line].length)
      return
    }
    // Ctrl+U → clear current line
    if (key.ctrl && input === 'u') {
      const [line, col] = getLineAndCol(value, cursor)
      const lines = value.split('\n')
      const lineStart = cursor - col
      const lineEnd = lineStart + lines[line].length
      const next = value.slice(0, lineStart) + value.slice(lineEnd)
      setValue(next)
      setCursor(lineStart)
      resetCompletion()
      return
    }

    // Plain printable input. Multi-character non-newline bursts are inserted
    // atomically; multiline/bracketed paste is handled near the top.
    if (input && !key.ctrl && !key.meta) {
      insertText(input)
    }
  })

  // ── Render ──────────────────────────────────────────────────────────────
  //
  // Multi-line content is rendered line-by-line so that Ink layouts each
  // line correctly.  The cursor block is placed on the appropriate line.
  // Continuation lines are indented to align with the first line's text.

  const showPlaceholder = !value && placeholder

  // Compute cursor line/col for rendering
  const allLines = value.split('\n')
  const [cursorLine, cursorCol] = getLineAndCol(value, cursor)

  // Continuation-line indent = same width as the prompt string
  const indent = ' '.repeat(prompt.length)

  return (
    <Box flexDirection="column">
      {showPlaceholder ? (
        <Box>
          <Text color={theme.primary}>{prompt}</Text>
          <Box flexGrow={1}>
            <Text>
              {!disabled && <Text color={theme.text} inverse> </Text>}
              <Text> </Text>
              <Text color={theme.muted} dimColor>{placeholder}</Text>
            </Text>
          </Box>
        </Box>
      ) : (
        allLines.map((line, i) => {
          const isFirstLine = i === 0
          const isCursorLine = i === cursorLine

          // Prefix: prompt on first line, indent on continuation lines
          const prefix = isFirstLine
            ? <Text color={theme.primary}>{prompt}</Text>
            : <Text>{indent}</Text>

          if (isCursorLine) {
            const before = line.slice(0, cursorCol)
            const at = line[cursorCol] ?? ' '
            const after = line.slice(cursorCol + 1)

            return (
              <Box key={i}>
                {prefix}
                <Text>
                  <Text color={theme.text}>{before}</Text>
                  {!disabled && <Text color={theme.text} inverse>{at}</Text>}
                  <Text color={theme.text}>{after}</Text>
                </Text>
              </Box>
            )
          }

          return (
            <Box key={i}>
              {prefix}
              <Text color={theme.text}>{line || ' '}</Text>
            </Box>
          )
        })
      )}
      {tabCandidates.length > 1 && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color={theme.muted} dimColor>
            {tabCandidates.length} matches — Tab/Shift+Tab cycle, Enter accept:
          </Text>
          <Box flexWrap="wrap">
            {tabCandidates.slice(0, 20).map((c, i) => (
              <Box key={c} marginRight={2}>
                <Text color={i === tabIdx ? theme.accent : theme.muted}
                      bold={i === tabIdx}
                      inverse={i === tabIdx}>
                  {c}
                </Text>
              </Box>
            ))}
            {tabCandidates.length > 20 && (
              <Text color={theme.muted} dimColor>…+{tabCandidates.length - 20} more</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}
