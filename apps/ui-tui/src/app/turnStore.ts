/**
 * turnStore — append-only transcript + currently-streaming assistant turn.
 *
 * `$transcript` is the locked-in history (read by TranscriptPane).
 * `$current` is the in-flight assistant turn (read by StreamingAssistant).
 * When the turn completes, the controller moves it from $current to $transcript.
 *
 * ── Memory management ──────────────────────────────────────────────
 *
 * Ink's `<Static>` component tracks an internal `index` state that only
 * moves forward — it renders `items.slice(index)` and then sets
 * `index = items.length`.  This means:
 *
 *   1. We can NEVER shrink the array from the front — doing so would
 *      leave `index` pointing past the end, so new turns would never
 *      render.  (The old `slice(-(maxTurns-1))` trim was broken.)
 *
 *   2. Old turns have already been written to the terminal scrollback
 *      by `<Static>`.  The user can still scroll back to see them.
 *      We only need the in-memory copies for React keys / potential
 *      re-renders that never actually happen.
 *
 *   3. Therefore we can safely **truncate the content** of old turns
 *      (text, reasoning, tool results) to reclaim memory without
 *      affecting the user-visible output.
 *
 * The strategy:
 *   - Keep the last `KEEP_FULL_TURNS` turns at full fidelity.
 *   - For older turns, replace `text` with a short excerpt, clear
 *     `reasoning`, and truncate each `tool.result`.
 *   - A `WeakSet` tracks already-truncated objects so we only
 *     process each turn once.
 *   - A hard cap (`HARD_CAP_TURNS`) clears the transcript entirely
 *     if the array grows pathologically large; the `generation`
 *     counter bumps the `<Static>` remount key so its index resets.
 */

import { atom } from 'nanostores'

import type { AssistantTurn, Turn } from './types.js'

export const $transcript = atom<Turn[]>([])
export const $current = atom<AssistantTurn | null>(null)
export const $isStreaming = atom<boolean>(false)

// Bumps every time the transcript is hard-reset so <Static> remounts
// and its internal index cursor resets to 0.
export const $transcriptGeneration = atom<number>(0)

// ── Tunables ────────────────────────────────────────────────────────

/** Number of recent turns kept at full fidelity. */
const KEEP_FULL_TURNS = parseInt(process.env.DRSAI_KEEP_FULL_TURNS || '20', 10)

/** Max chars retained for an old turn's `text` field. */
const MAX_TRUNCATED_TEXT = parseInt(process.env.DRSAI_MAX_TRUNC_TEXT || '200', 10)

/** Max chars retained for an old turn's tool `result` field. */
const MAX_TRUNCATED_TOOL = parseInt(process.env.DRSAI_MAX_TRUNC_TOOL || '200', 10)

/** Hard cap on total turns before a full reset. */
const HARD_CAP_TURNS = parseInt(process.env.DRSAI_HARD_CAP_TURNS || '5000', 10)

// ── Truncation helpers ─────────────────────────────────────────────

const TRUNC_SUFFIX = '…[truncated]'
const truncatedTurns = new WeakSet<object>()

function truncateText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '\n' + TRUNC_SUFFIX : s
}

/** Create a memory-minimal copy of a turn.  Old turns only need
 *  enough data for React keys and the rare re-render path. */
function truncateTurn(turn: Turn): Turn {
  if (turn.role === 'user') {
    return { ...turn, text: truncateText(turn.text, MAX_TRUNCATED_TEXT) }
  }
  // Assistant turn — clear reasoning entirely (biggest memory hog),
  // truncate text, and truncate each tool result.
  return {
    ...turn,
    text: truncateText(turn.text, MAX_TRUNCATED_TEXT),
    reasoning: '',
    tools: turn.tools.map(t => ({
      ...t,
      result: t.result ? truncateText(t.result, MAX_TRUNCATED_TOOL) : t.result,
    })),
  }
}

/** Walk the array and truncate any old turn that hasn't been
 *  truncated yet.  Called from `appendTurn`. */
function truncateOldTurns(turns: Turn[]): void {
  if (turns.length <= KEEP_FULL_TURNS) return
  // The turn at this index just crossed the cutoff — truncate it.
  // (Older turns were already truncated on previous appendTurn calls.)
  const idx = turns.length - KEEP_FULL_TURNS - 1
  const t = turns[idx]
  if (!truncatedTurns.has(t)) {
    const tr = truncateTurn(t)
    truncatedTurns.add(tr)
    turns[idx] = tr
  }
}

// ── Public API ─────────────────────────────────────────────────────

export function appendTurn(turn: Turn): void {
  const current = $transcript.get()

  // Hard cap: if the array is pathologically large, reset entirely.
  // The terminal scrollback retains the old content; <Static> remounts
  // via the generation key bump.
  if (current.length >= HARD_CAP_TURNS) {
    truncatedTurns.add(turn)
    $transcript.set([turn])
    $transcriptGeneration.set($transcriptGeneration.get() + 1)
    return
  }

  const next = [...current, turn]
  truncateOldTurns(next)
  $transcript.set(next)
}

/** Replace the entire transcript (e.g. on session resume).
 *  Truncates old turns immediately to bound initial memory. */
export function setTranscript(turns: Turn[]): void {
  // Truncate everything older than KEEP_FULL_TURNS right away.
  for (let i = 0; i < turns.length - KEEP_FULL_TURNS; i++) {
    const t = turns[i]
    if (!truncatedTurns.has(t)) {
      const tr = truncateTurn(t)
      truncatedTurns.add(tr)
      turns[i] = tr
    }
  }
  $transcript.set(turns)
}

export function setCurrent(turn: AssistantTurn | null): void {
  $current.set(turn)
}

export function updateCurrent(updater: (t: AssistantTurn) => AssistantTurn): void {
  const c = $current.get()
  if (c) $current.set(updater(c))
}
