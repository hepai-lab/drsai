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
  // We coalesce text deltas into a small buffer and flush every ~FLUSH_MS so
  // Ink has time to fully reflow each frame.
  //
  // Why 160 ms (changed from 80 ms):
  //   Every flush triggers Ink's eraseLines(previousLineCount) + write(new
  //   frame). The eraseLines sequence is interpreted by most terminals
  //   (iTerm2, Alacritty, kitty, Windows Terminal, VSCode, GNU screen) as
  //   a "cursor moved into the visible region" event, which RESETS the
  //   user's manual scroll-back to the bottom. So during a long streaming
  //   answer, any attempt to scroll up is yanked back every FLUSH_MS.
  //
  //   80 ms → 12.5 flushes/sec → user gets ≤ 80 ms of scrollback time.
  //   160 ms → 6.25 flushes/sec → user gets up to 160 ms (2x).
  //
  //   160 ms is still well below the 250 ms "feels laggy" threshold for
  //   live-streaming text (per Doherty / Nielsen rule-of-thumb), and the
  //   visible per-flush chunk on a fast LLM is roughly 1 line either way.
  //   The user-perceptible loss is near-zero; the scrollback usability win
  //   is real and measurable.
  //
  //   The PROPER fix (P1-01-followup) is to enter an alternate-screen
  //   buffer (\x1b[?1049h) so the terminal stops conflating cursor moves
  //   with viewport anchoring. That is tracked as P3-15 + alt-screen mode
  //   and will be a larger change.
  //
  // Override with DRSAI_TUI_FLUSH_MS for tuning. Clamped to [16, 500].
  // Power users on slow terminals can push it to 240+ for even better
  // scrollback usability; speed-readers can drop it back to 80.
  const envFlush = Number.parseInt(process.env.DRSAI_TUI_FLUSH_MS || '', 10)
  const FLUSH_MS = Number.isFinite(envFlush)
    ? Math.max(16, Math.min(500, envFlush))
    : 160
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

      // ── Subagent streaming ───────────────────────────────────
      case 'subagent.start': {
        // 子智能体开始工作 — 在状态栏显示提示
        const p = ev.payload as { source?: string; goal?: string } | undefined
        const name = p?.source?.replace(/^sub:/, '') ?? 'subagent'
        $statusLine.set(`⚡ ${name}: ${p?.goal ? p.goal.slice(0, 60) : 'working…'}`)
        return
      }
      case 'subagent.thinking': {
        // 子智能体流式 token — 追加到当前 turn 的 text（与 message.delta 同等处理）
        const text = (ev.payload as { text?: string } | undefined)?.text || ''
        if (!text) return
        textBuf += text
        scheduleFlush()
        return
      }
      case 'subagent.complete': {
        // 子智能体完成 — 如有最终 text 且尚未流式输出则补充，然后清除状态栏
        const p = ev.payload as { text?: string; source?: string } | undefined
        const finalText = p?.text || ''
        // 如果没有经过 subagent.thinking 流式传输（非流式子智能体），
        // 则把最终文本作为一次性 delta 追加
        if (finalText) {
          const cur = $current.get()
          if (cur && !cur.text && !textBuf) {
            // 没有已流式的内容，把最终答案全量追加
            textBuf += finalText
            scheduleFlush()
          }
        }
        $statusLine.set('')
        return
      }

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
