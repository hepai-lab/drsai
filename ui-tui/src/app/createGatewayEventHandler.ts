/**
 * createGatewayEventHandler — central dispatch from GatewayEvent → store mutations.
 *
 * Lives outside React: subscribed once at app startup, runs on every gateway
 * frame. Components re-render via nanostores ``useStore`` hooks.
 */

import type { GatewayClient } from '../gatewayClient.js'
import type { GatewayEvent } from '../gatewayTypes.js'

import { $approval, $clarify, $secret, $sudo } from './overlayStore.js'
import type { TurnController } from './turnController.js'
import { $connectionError, $connectionStatus, $sessionMeta, $skin, $statusLine, $userId } from './uiStore.js'
import {
  applyToolComplete,
  toolFromStart,
  type AssistantTurn,
} from './types.js'
import { $current, setCurrent, updateCurrent } from './turnStore.js'

export function createGatewayEventHandler(
  _gw: GatewayClient,
  controller?: TurnController,
): (ev: GatewayEvent) => void {
  // ── Streaming delta throttling ──────────────────────────────────────────
  //
  // LLM streams send `message.delta` / `thinking.delta` / `reasoning.delta`
  // events at 100-200 Hz. Each store mutation triggers a React re-render +
  // Ink reconciliation, which can't keep up at that rate — especially with
  // CJK characters where yoga-layout's column width calculation lags. The
  // visible symptom is text fragments getting scattered across columns and
  // wrap positions going wonky during interruption.
  //
  // We coalesce text deltas into a small buffer and flush every ~50 ms so
  // Ink has time to fully reflow each frame. The user-visible streaming
  // experience is unchanged (still "live"), just less wasteful.
  const FLUSH_MS = 50
  let textBuf = ''
  let reasoningBuf = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  function flushBuffers() {
    flushTimer = null
    if (textBuf) {
      const t = textBuf
      textBuf = ''
      updateCurrent(c => ({ ...c, text: c.text + t }))
    }
    if (reasoningBuf) {
      const r = reasoningBuf
      reasoningBuf = ''
      updateCurrent(c => ({ ...c, reasoning: c.reasoning + r }))
    }
  }

  function scheduleFlush() {
    if (flushTimer == null) {
      flushTimer = setTimeout(flushBuffers, FLUSH_MS)
    }
  }

  return (ev: GatewayEvent) => {
    switch (ev.type) {
      // ── Lifecycle ────────────────────────────────────────────
      case 'gateway.ready': {
        const payload = ev.payload as { skin?: unknown } | undefined
        if (payload?.skin) $skin.set(payload.skin as never)
        $connectionStatus.set('ready')
        return
      }
      case 'gateway.exit': {
        $connectionStatus.set('exited')
        const payload = ev.payload as { reason?: string } | undefined
        if (payload?.reason) $connectionError.set(payload.reason)
        return
      }
      case 'gateway.protocol_error': {
        const payload = ev.payload as { preview?: string } | undefined
        $connectionStatus.set('error')
        $connectionError.set(payload?.preview || 'protocol error')
        return
      }
      case 'session.info': {
        const payload = ev.payload as { user_id?: string } | undefined
        $sessionMeta.set(ev.payload as never)
        // Reflect the gateway's user_id in the StatusBar — this is the
        // most reliable source since session.info fires whenever an agent
        // session is (re-)initialised.
        if (payload?.user_id && $userId.get() !== payload.user_id) {
          $userId.set(payload.user_id)
        }
        return
      }

      // ── Message stream ───────────────────────────────────────
      case 'message.start': {
        // Controller already created the placeholder; nothing to do.
        return
      }
      case 'message.delta': {
        const text = (ev.payload as { text?: string } | undefined)?.text || ''
        if (!text) return
        textBuf += text
        scheduleFlush()
        return
      }
      case 'message.complete': {
        // Make sure all buffered deltas land in the turn before we close it.
        flushBuffers()
        const p = ev.payload as { usage?: unknown; status?: string; reasoning?: string } | undefined
        updateCurrent(t => ({
          ...t,
          usage: (p?.usage as AssistantTurn['usage']) ?? t.usage,
          status:
            p?.status === 'interrupted' || p?.status === 'error'
              ? (p.status as AssistantTurn['status'])
              : 'complete',
          reasoning: p?.reasoning ? t.reasoning + (t.reasoning ? '\n' : '') + p.reasoning : t.reasoning,
        }))
        // End of turn — move $current into transcript and clear streaming state.
        controller?.finalize()
        return
      }
      case 'thinking.delta':
      case 'reasoning.delta': {
        const text = (ev.payload as { text?: string } | undefined)?.text || ''
        if (!text) return
        reasoningBuf += text
        scheduleFlush()
        return
      }

      // ── Tools ────────────────────────────────────────────────
      case 'tool.start': {
        const tool = toolFromStart(ev.payload as never)
        updateCurrent(t => ({ ...t, tools: [...t.tools, tool] }))
        return
      }
      case 'tool.complete': {
        const p = ev.payload as { tool_id?: string; name?: string }
        updateCurrent(t => ({
          ...t,
          tools: t.tools.map(c =>
            c.id === p.tool_id || (!p.tool_id && c.name === p.name && c.status === 'running')
              ? applyToolComplete(c, ev.payload as never)
              : c,
          ),
        }))
        return
      }

      // ── Interactive prompts ──────────────────────────────────
      case 'approval.request':
        $approval.set(ev.payload as never)
        return
      case 'clarify.request':
        $clarify.set(ev.payload as never)
        return
      case 'secret.request':
        $secret.set(ev.payload as never)
        return
      case 'sudo.request':
        $sudo.set(ev.payload as never)
        return

      // ── Status ───────────────────────────────────────────────
      case 'status.update': {
        const p = ev.payload as { kind?: string; text?: string } | undefined
        if (p?.text) $statusLine.set(`${p.kind ?? 'status'}: ${p.text}`)
        return
      }
      case 'error': {
        // Flush so the partial answer up to the error is preserved.
        flushBuffers()
        const msg = (ev.payload as { message?: string } | undefined)?.message || 'unknown error'
        const cur = $current.get()
        if (cur) {
          setCurrent({ ...cur, status: 'error', errorMessage: msg })
          // End of turn (errored) — finalize too.
          controller?.finalize()
        } else {
          $statusLine.set(`error: ${msg}`)
        }
        return
      }

      default:
        return
    }
  }
}
