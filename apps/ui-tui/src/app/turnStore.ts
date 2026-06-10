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

export function appendTurn(turn: Turn): void {
  $transcript.set([...$transcript.get(), turn])
}

export function setCurrent(turn: AssistantTurn | null): void {
  $current.set(turn)
}

export function updateCurrent(updater: (t: AssistantTurn) => AssistantTurn): void {
  const c = $current.get()
  if (c) $current.set(updater(c))
}
