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

import { useStore } from '@nanostores/react'
import { Box, Text, useInput } from 'ink'
import { useEffect, useRef, useState } from 'react'

import { isTerminalFocusEvent, parseMouseEvent } from '../app/focusEvents.js'
import { $terminalFocused } from '../app/uiStore.js'
import { theme } from '../theme.js'

const BRACKET_PASTE_RE = /\x1b?\[20[01]~/g
const BRACKET_PASTE_DETECT_RE = /\x1b?\[20[01]~/

// ── Cursor blink ──────────────────────────────────────────────────────
//
// Ink hides the real terminal cursor (`\x1b[?25l`) so we draw a fake one
// using <Text inverse>. Without animation users can't tell whether the
// TUI has focus — they keep typing speculatively. We toggle visibility
// at ~530 ms, matching the default xterm blink rate.
//
// Pause conditions (cursor renders a steady block, no setState loop):
//   - `active` arg is false (caller says "stop blinking right now")
//   - The TextInput is disabled (caller passes `blink=false`)
//   - The terminal window itself has lost focus (XTerm focus reporting;
//     see entry.tsx + app.tsx for the wiring). This matches real
//     terminal behavior: hardware cursor stops blinking when the window
//     is in the background. Without this, users see a fake-looking
//     pulse in the corner of an inactive window, which is more
//     distracting than helpful.
//
// Caveats:
//   - Every toggle triggers a re-render of the dynamic frame. We mitigate
//     by only blinking when the input is enabled AND has focus.
//   - When the input is disabled OR unfocused, we render a steady dim
//     block so users can still see *where* the cursor lives.
const CURSOR_BLINK_MS = 530

function useCursorBlink(active: boolean): boolean {
  const termFocused = useStore($terminalFocused)
  const shouldBlink = active && termFocused
  const [on, setOn] = useState(true)
  useEffect(() => {
    if (!shouldBlink) {
      setOn(true)
      return
    }
    const t = setInterval(() => setOn(o => !o), CURSOR_BLINK_MS)
    return () => clearInterval(t)
  }, [shouldBlink])
  return on
}

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
  /**
   * When ``true``:
   *   - The cursor block renders dimmed and does not blink.
   *   - All keypresses are silently dropped (the ``useInput`` hook still
   *     consumes stdin so terminal-side characters are not echoed; this
   *     is the fix for the "ghost typing" bug seen between turns).
   *   - The cursor block is hidden so it does not look like the input is
   *     ready to accept text.
   */
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
  /**
   * Whether the cursor block should blink. Default ``true``. Set to
   * ``false`` when an overlay is consuming keys so we don't burn CPU
   * re-rendering an off-focus cursor.
   */
  blink?: boolean
  /**
   * Whether this input is actively consuming keystrokes. When
   * ``false``, the underlying ``useInput`` is NOT installed at all
   * (Ink's native opt-out via ``{ isActive: false }``), so the input
   * is invisible to Ink's stdin dispatch.
   *
   * Different from ``disabled``:
   *   - ``disabled=true`` still keeps the ``useInput`` listener live;
   *     it just drops every key on the floor. The reason is to soak
   *     up stdin bytes during streaming so the terminal doesn't echo
   *     "ghost" characters (see P1-02).
   *   - ``isActive=false`` actually unhooks the listener. Use this
   *     when another component owns the keyboard — e.g. an approval
   *     overlay is asking the user to press a number. We don't want
   *     that "1" to also land in the composer.
   *
   * Default ``true`` — i.e. existing callers see no change.
   */
  isActive?: boolean
  /**
   * Render each character as a mask (``true`` → ``●``, string → custom
   * single-char mask). The actual value is still passed unchanged to
   * ``onSubmit`` and to ``onHistoryChange`` — only the visible glyph is
   * replaced.
   *
   * Used by the Secret / Sudo overlays so passwords / API tokens are
   * not visible in the terminal scrollback (and don't get screenshotted
   * in screen-share / pair-programming sessions).
   *
   * Default ``false`` — no masking, behaves like before.
   */
  mask?: boolean | string
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
  blink = true,
  isActive = true,
  mask = false,
}: TextInputProps) {
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const pendingEscapeRef = useRef(false)

  // Resolve the mask glyph once per render. ``true`` → ``●``; a single
  // char string is used verbatim; anything else (false, '') → no mask.
  const maskChar: string | null =
    mask === true
      ? '●'
      : typeof mask === 'string' && mask.length > 0
        ? mask[0]
        : null

  /** Apply the mask glyph to a visible string, preserving length. */
  function masked(s: string): string {
    if (maskChar === null) return s
    return maskChar.repeat(s.length)
  }

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
    // XTerm focus reporting (\x1b[?1004) sends "\x1b[I" / "\x1b[O" on
    // window focus changes; Ink strips the ESC, leaving "[I" / "[O".
    // Without this guard we would insert that pair into the user's
    // text every time they switched windows. See app/focusEvents.ts.
    if (isTerminalFocusEvent(input)) return
    
    // Mouse tracking (\x1b[?1000h\x1b[?1006h) sends SGR mouse events.
    // Without this guard, wheel-up/down would be misinterpreted as
    // arrow keys and trigger unwanted prompt history navigation (Issue #7).
    // See app/focusEvents.ts for details.
    const mouse = parseMouseEvent(input)
    if (mouse.isMouse) {
      // Swallow all mouse events in the input area.
      // Future: could dispatch wheel events to scroll transcript.
      return
    }
    
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
    //
    // With mouse tracking OFF by default (so the terminal owns the
    // scrollback / selection UX), we go back to the standard readline
    // behavior: arrow keys move the cursor between lines in a multi-line
    // draft, and at the edge they browse command history.
    //
    // If your terminal translates wheel events into fake arrow keys
    // AND you want the program to swallow them, opt in via
    // DRSAI_TUI_ENABLE_MOUSE_TRACKING=1 — but be aware that re-enables
    // mouse capture and disables native scroll / selection.
    if (key.upArrow) {
      const allLines = value.split('\n')
      const [curLine, curCol] = getLineAndCol(value, cursor)

      if (curLine > 0) {
        // Move cursor up one line (keep column if possible)
        const newCursor = cursorFromLineCol(allLines, curLine - 1, curCol)
        setCursor(newCursor)
        resetCompletion()
      } else if (history.length > 0) {
        // Already on first line → browse history backward
        if (historyIdx === -1) {
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
          setHistoryIdx(-1)
          setText(draftRef.current)
        }
      }
      return
    }

    // ── Ctrl+P / Ctrl+N: readline-style history aliases ─────────────────
    // Kept as alternatives for users on terminals that DO send wheel
    // events as fake arrow keys (rare; opt in to mouse tracking and the
    // program will swallow them, but these shortcuts still work then).
    if (key.ctrl && input === 'p') {
      if (history.length === 0) return
      if (historyIdx === -1) {
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
    if (key.ctrl && input === 'n') {
      if (historyIdx === -1) return
      if (historyIdx < history.length - 1) {
        setHistoryIdx(historyIdx + 1)
        setText(history[historyIdx + 1])
      } else {
        setHistoryIdx(-1)
        setText(draftRef.current)
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
        //
        // EXCEPT when masking: secrets / passwords must NEVER touch the
        // on-disk prompt history. The whole point of mask=true is that
        // the value never leaves volatile memory.
        if (
          trimmed &&
          maskChar === null &&
          (history.length === 0 || history[history.length - 1] !== trimmed)
        ) {
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
  }, { isActive })

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

  // Blink only when input is interactive AND parent has focus.
  // Disabled state shows a steady dim block instead of a blinking one so
  // users can still see *where* the cursor is during streaming, but it
  // does not pretend to accept input.
  const blinkOn = useCursorBlink(!disabled && blink)
  const showCursorBlock = !disabled && blinkOn

  // Pick the cursor's visible representation:
  //   enabled + blink-on   → bright reverse block
  //   enabled + blink-off  → invisible (rendered as a normal char so
  //                          surrounding text doesn't shift)
  //   disabled             → dim non-inverted block (steady)
  function renderCursorAt(ch: string) {
    if (disabled) {
      return <Text color={theme.muted} dimColor>{ch}</Text>
    }
    if (showCursorBlock) {
      return <Text color={theme.text} inverse>{ch}</Text>
    }
    return <Text color={theme.text}>{ch}</Text>
  }

  return (
    <Box flexDirection="column">
      {showPlaceholder ? (
        <Box>
          <Text color={theme.primary}>{prompt}</Text>
          <Box flexGrow={1}>
            <Text>
              {renderCursorAt(' ')}
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

            // When masking, replace the visible characters with the mask
            // glyph but keep the cursor block on a non-masked space so the
            // user can still tell where their cursor is. The mask char
            // itself is what appears in `before` / `after` segments.
            const visBefore = masked(before)
            // The cursor sits on top of a real character; replace with the
            // mask glyph so it doesn't leak a single plaintext char.
            const visAt = maskChar !== null && cursorCol < line.length ? maskChar : at
            const visAfter = masked(after)

            return (
              <Box key={i}>
                {prefix}
                <Text>
                  <Text color={theme.text}>{visBefore}</Text>
                  {renderCursorAt(visAt)}
                  <Text color={theme.text}>{visAfter}</Text>
                </Text>
              </Box>
            )
          }

          return (
            <Box key={i}>
              {prefix}
              <Text color={theme.text}>{masked(line) || ' '}</Text>
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
