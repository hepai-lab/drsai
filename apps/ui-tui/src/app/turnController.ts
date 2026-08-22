/**
 * TurnController — orchestrates one prompt → response cycle.
 *
 *   1. User submits text → append UserTurn to transcript, set $isStreaming.
 *   2. Issue `prompt.submit` RPC (returns IMMEDIATELY with status="streaming";
 *      the actual turn runs in the background on the gateway).
 *   3. While streaming, GatewayEventHandler mutates $current and overlay stores.
 *   4. The handler calls `controller.finalize()` when it sees `message.complete`
 *      or `error` — that's what closes out the turn (NOT the RPC response).
 *
 * The old design awaited the RPC response, which timed out at 120 s for any
 * turn that took longer than that (tool calls, sub-agents, big LLMs). The new
 * design keeps the streaming UX but only relies on events to know when we're
 * done.
 */

import type { GatewayClient } from '../gatewayClient.js'

import { $isStreaming, $current, appendTurn, setCurrent } from './turnStore.js'
import { $memoryPreview } from './uiStore.js'
import { newAssistantTurn } from './types.js'
import { clearHeightCache } from './heightCache.js'
import { cancelPendingInkThrottles, resetInkLastOutputHeight } from './inkInstanceRef.js'

export interface ImageAttachment {
  /** Original file path (for display / debugging). */
  path: string
  /** Base64-encoded image data (no data-URI prefix). */
  base64: string
  /** MIME type, e.g. "image/png". */
  mime_type: string
}

export interface SubmitOptions {
  sessionId: string
  text: string
  /** Optional compact text shown in transcript when submitted text is expanded from long-paste tokens. */
  displayText?: string
  /** Optional image attachments to send as a MultiModalMessage. */
  images?: ImageAttachment[]
}

export class TurnController {
  public readonly gw: GatewayClient
  constructor(gw: GatewayClient) {
    this.gw = gw
  }

  async submit(opts: SubmitOptions): Promise<void> {
    const trimmed = opts.text.trim()
    if (!trimmed) return
    if ($isStreaming.get()) return

    // Clear the memory preview banner — user has seen it and is now
    // starting a new interaction.
    $memoryPreview.set('')

    // Lock in user turn + start a placeholder assistant turn.
    appendTurn({ role: 'user', text: opts.displayText?.trim() || trimmed, ts: Date.now() })
    setCurrent(newAssistantTurn())
    clearHeightCache()  // reset height cache for the new streaming turn
    $isStreaming.set(true)

    // Fire and forget: the RPC just kicks off the turn on the gateway side.
    // It returns `{status: "streaming"}` almost immediately. The actual end
    // of the turn is signalled by a `message.complete` (or `error`) event,
    // which the GatewayEventHandler routes to `controller.finalize()`.
    try {
      const rpcParams: Record<string, unknown> = {
        session_id: opts.sessionId,
        text: trimmed,
      }
      if (opts.images && opts.images.length > 0) {
        rpcParams.images = opts.images
      }
      await this.gw.request('prompt.submit', rpcParams)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const cur = $current.get()
      if (cur) {
        setCurrent({ ...cur, status: 'error', errorMessage: msg })
      }
      this.finalize()
    }
    // Don't finalize on success here — wait for `message.complete` event.
  }

  cancel(sessionId: string): void {
    // Fire-and-forget: prompt.cancel is idempotent.
    this.gw.request('prompt.cancel', { session_id: sessionId }).catch(() => {})
  }

  /** Move the in-flight turn into the transcript and clear streaming state. */
  finalize(): void {
    // Cancel any pending throttledLog/throttledOnRender trailing calls
    // from the last streaming render. If left pending, the trailing
    // call fires AFTER onImmediateRender writes the new (small) frame,
    // overwriting it with the old (large) streaming frame — causing
    // text overlap and bottom blank space.
    cancelPendingInkThrottles()

    // Reset Ink's lastOutputHeight to 0 to prevent the fullscreen branch
    // from firing on the finalize render. The fullscreen branch fires
    // when lastOutputHeight >= stdout.rows (from the PREVIOUS render,
    // which was the tall streaming frame). It calls log.sync() which
    // sets previousLineCount WITHOUT writing to the terminal — corrupting
    // line tracking. On the next render, eraseLines() erases the wrong
    // number of lines, leaving 1 blank line per turn (the "growing
    // bottom blank space" bug).
    resetInkLastOutputHeight()

    const cur = $current.get()
    if (cur) {
      const finalized = {
        ...cur,
        status: cur.status === 'streaming' ? 'complete' as const : cur.status,
        completedAt: Date.now(),
      }
      appendTurn(finalized)
      setCurrent(null)
    }
    $isStreaming.set(false)
    // No manual scroll-to-bottom: with <Static> in TranscriptPane the
    // terminal's native scroll position is the source of truth, and a
    // freshly written turn naturally appears at the bottom.
  }
}
