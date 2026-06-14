/**
 * Helpers for XTerm focus-reporting (\x1b[?1004) events.
 *
 * Background:
 *   We enable focus reporting in entry.tsx so the terminal sends
 *   ``\x1b[I`` on focus-in and ``\x1b[O`` on focus-out. Ink's
 *   ``parseKeypress`` doesn't know what those sequences mean — it
 *   strips the leading ESC byte and passes ``"[I"`` / ``"[O"`` to
 *   every ``useInput`` callback as plain text.
 *
 *   Without an explicit guard, every ``useInput`` site would either
 *   insert the bracket-letter pair into the user's text (TextInput
 *   does this — that's how the "[O[I[O[I" smearing was first
 *   reported), or trigger a wrong code path (e.g. a 1-key menu
 *   shortcut where '[' or 'I' or 'O' is a hot key).
 *
 *   ``useInput`` in Ink fans out to every mounted listener; there
 *   is no event-stopPropagation. So we cannot fix this in ONE
 *   place — every callsite must check first thing.
 *
 *   Single human keypress that would produce exactly ``"[I"`` or
 *   ``"[O"`` does not exist: Alt+'[' then 'I' arrives as two
 *   independent useInput callbacks (one for each keypress), since
 *   Ink parses one keypress at a time. So matching the two-char
 *   string is safe.
 *
 * Idiomatic usage in every useInput callback:
 *
 *   useInput((input, key) => {
 *     if (isTerminalFocusEvent(input)) return
 *     // ...rest of the handler
 *   })
 *
 * The single place where we also UPDATE the focus state lives in
 * ``app.tsx`` — every other callsite only needs to swallow the event.
 */

export const FOCUS_IN_INPUT = '[I'
export const FOCUS_OUT_INPUT = '[O'

export function isTerminalFocusEvent(input: string): boolean {
  return input === FOCUS_IN_INPUT || input === FOCUS_OUT_INPUT
}
