/**
 * turnStore — append-only transcript + currently-streaming assistant turn.
 *
 * `$transcript` is the locked-in history (read by TranscriptPane).
 * `$current` is the in-flight assistant turn (read by StreamingAssistant).
 * When the turn completes, the controller moves it from $current to $transcript.
 */

import { atom } from 'nanostores'

import type { AssistantTurn, Turn } from './types.js'

export const $transcript = atom<Turn[]>([])
export const $current = atom<AssistantTurn | null>(null)
export const $isStreaming = atom<boolean>(false)

// Fix 3.1: Limit transcript size to prevent memory leak
// Keep only the most recent turns to avoid unbounded growth
const MAX_TRANSCRIPT_TURNS = 200 // Configurable via env var

export function appendTurn(turn: Turn): void {
  const current = $transcript.get()
  const maxTurns = parseInt(process.env.DRSAI_MAX_TRANSCRIPT_TURNS || String(MAX_TRANSCRIPT_TURNS), 10)
  
  if (current.length >= maxTurns) {
    // Keep most recent turns, drop oldest
    $transcript.set([...current.slice(-(maxTurns - 1)), turn])
  } else {
    $transcript.set([...current, turn])
  }
}

export function setCurrent(turn: AssistantTurn | null): void {
  $current.set(turn)
}

export function updateCurrent(updater: (t: AssistantTurn) => AssistantTurn): void {
  const c = $current.get()
  if (c) $current.set(updater(c))
}
