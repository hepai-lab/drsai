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
import { newAssistantTurn } from './types.js'

export interface SubmitOptions {
  sessionId: string
  text: string
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

    // Lock in user turn + start a placeholder assistant turn.
    appendTurn({ role: 'user', text: trimmed, ts: Date.now() })
    setCurrent(newAssistantTurn())
    $isStreaming.set(true)

    // Fire and forget: the RPC just kicks off the turn on the gateway side.
    // It returns `{status: "streaming"}` almost immediately. The actual end
    // of the turn is signalled by a `message.complete` (or `error`) event,
    // which the GatewayEventHandler routes to `controller.finalize()`.
    try {
      await this.gw.request('prompt.submit', {
        session_id: opts.sessionId,
        text: trimmed,
      })
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
  }
}
