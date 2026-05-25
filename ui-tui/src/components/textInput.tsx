/**
 * TextInput — multiline text input for Ink with command history + Tab completion.
 *
 * Features:
 *   - Enter         submit
 *   - Alt+Enter / Shift+Enter / Esc then Enter / Ctrl+O  insert newline
 *   - Backspace     delete one char
 *   - Left/Right    move cursor
 *   - Up/Down       walk through command history (when at first/last line)
 *   - Tab           cycle through slash-command completions (only when input starts with /)
 *   - Ctrl+U        clear current line
 *   - Ctrl+A / Ctrl+E   start / end of line
 *
 * Command history persists in-memory for the session; the parent supplies
 * `completions` (a flat list of `/command` strings) to drive Tab.
 */

import { Box, Text, useInput } from 'ink'
import { useRef, useState } from 'react'

import { theme } from '../theme.js'

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

  function insertNewline() {
    const next = value.slice(0, cursor) + '\n' + value.slice(cursor)
    setValue(next)
    setCursor(cursor + 1)
    pendingEscapeRef.current = false
    resetCompletion()
  }

  useInput((input, key) => {
    if (disabled) return

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

    // ── Up/Down: command history ────────────────────────────────────────
    if (key.upArrow) {
      if (history.length === 0) return
      if (historyIdx === -1) {
        // start browsing — snapshot current draft
        draftRef.current = value
        const last = history.length - 1
        setHistoryIdx(last)
        setText(history[last])
      } else if (historyIdx > 0) {
        setHistoryIdx(historyIdx - 1)
        setText(history[historyIdx - 1])
      }
      return
    }
    if (key.downArrow) {
      if (historyIdx === -1) return
      if (historyIdx < history.length - 1) {
        setHistoryIdx(historyIdx + 1)
        setText(history[historyIdx + 1])
      } else {
        // Past the end — restore draft
        setHistoryIdx(-1)
        setText(draftRef.current)
      }
      return
    }

    // ── Enter: submit (or newline) ──────────────────────────────────────
    if (key.return) {
      if (key.meta || key.shift || pendingEscapeRef.current) {
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

    // Ctrl+A → start of line, Ctrl+E → end of line, Ctrl+U → clear
    if (key.ctrl && input === 'a') {
      setCursor(0)
      return
    }
    if (key.ctrl && input === 'e') {
      setCursor(value.length)
      return
    }
    if (key.ctrl && input === 'u') {
      setValue('')
      setCursor(0)
      resetCompletion()
      return
    }

    // Plain printable input (multi-character paste lands here too).
    if (input && !key.ctrl && !key.meta) {
      const next = value.slice(0, cursor) + input + value.slice(cursor)
      setValue(next)
      setCursor(cursor + input.length)
      resetCompletion()
      if (historyIdx !== -1) {
        // User started typing while browsing history → exit browse mode
        setHistoryIdx(-1)
        draftRef.current = next
      }
    }
  })

  // Render with a visible block-cursor at `cursor` position.
  const before = value.slice(0, cursor)
  const at = value[cursor] ?? ' '
  const after = value.slice(cursor + 1)
  const showPlaceholder = !value && placeholder
  const cursorChar = disabled ? '' : at

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.primary}>{prompt}</Text>
        <Box flexGrow={1}>
          {showPlaceholder ? (
            <Text>
              {!disabled && <Text color={theme.text} inverse> </Text>}
              <Text> </Text>
              <Text color={theme.muted} dimColor>{placeholder}</Text>
            </Text>
          ) : (
            <Text>
              <Text color={theme.text}>{before}</Text>
              {!disabled && <Text color={theme.text} inverse>{cursorChar}</Text>}
              <Text color={theme.text}>{after}</Text>
            </Text>
          )}
        </Box>
      </Box>
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
