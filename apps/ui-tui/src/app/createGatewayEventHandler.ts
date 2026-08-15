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
import { $connectionError, $connectionStatus, $lastUsage, $memoryPreview, $remoteHost, $sessionMeta, $skin, $statusLine, $userId } from './uiStore.js'
import {
  applyToolComplete,
  MAX_TOOL_RESULT_CHARS,
  toolFromStart,
  TOOL_TRUNC_SUFFIX,
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
  // Why 80 ms (default, reduced from 160 ms since alt-screen resolves P1-01):
  //   Every flush triggers Ink's eraseLines(previousLineCount) + write(new
  //   frame). The eraseLines sequence is interpreted by most terminals
  //   (iTerm2, Alacritty, kitty, Windows Terminal, VSCode, GNU screen) as
  //   a "cursor moved into the visible region" event, which RESETS the
  //   user's manual scroll-back to the bottom. So during a long streaming
  //   answer, any attempt to scroll up is yanked back every FLUSH_MS.
  //
  //   80 ms → ~12 fps flushes → responsive streaming, smooth text flow.
  //
  //   With alternate-screen buffer mode enabled (entry.tsx \x1b[?1049h),
  //   the scroll-anchor issue (P1-01) is fully resolved — the TUI runs in
  //   its own terminal page so eraseLines() no longer resets the user's
  //   scrollback. This means we can safely use a lower FLUSH_MS for more
  //   responsive streaming without the scroll-jank penalty. 80 ms is a
  //   good balance: ~12 fps updates feel smooth while still coalescing
  //   token-level bursts.
  //
  // Override with DRSAI_TUI_FLUSH_MS for tuning. Clamped to [16, 500].
  const envFlush = Number.parseInt(process.env.DRSAI_TUI_FLUSH_MS || '', 10)
  const FLUSH_MS = Number.isFinite(envFlush)
    ? Math.max(16, Math.min(500, envFlush))
    : 80
  let textBuf = ''
  let reasoningBuf = ''
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  // ── Subagent visual distinction ─────────────────────────────────────────
  //
  // When a subagent streams text via `subagent.thinking`, we wrap its output
  // in a visual box so the user can tell which part came from the subagent
  // vs. the main agent. We track whether we're currently inside a subagent
  // block so we know when to emit the opening/closing separators.
  let isSubagentActive = false
  let subagentSource = ''

  function flushBuffers() {
    flushTimer = null
    if (textBuf) {
      const t = textBuf
      textBuf = ''
      updateCurrent(c => {
        // Maintain ordered contentParts: if the last part is a text
        // segment, append a chunk (O(1) amortised) instead of
        // concatenating strings (O(n) per flush → O(n²) total over a
        // long answer). The full text is lazily joined by getPartText()
        // only when a visible part needs rendering.
        const parts = [...c.contentParts]
        const last = parts[parts.length - 1]
        if (last && last.kind === 'text') {
          parts[parts.length - 1] = {
            ...last,
            chunks: [...last.chunks, t],
            text: '',  // invalidate lazy-join cache
          }
        } else {
          parts.push({ kind: 'text', id: `text-${c.startedAt}-${parts.length}`, chunks: [t], text: '' })
        }
        // Don't update c.text during streaming — it would copy the
        // entire accumulated text each flush. Text is materialised at
        // finalize() by joining all contentParts' chunks.
        return { ...c, contentParts: parts }
      })
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
      case 'remote.lost': {
        // Remote SSH connection dropped — update status but don't exit.
        // The App-level handler will transition to the remote_lost screen.
        $connectionStatus.set('remote_lost')
        $remoteHost.set('')
        const payload = ev.payload as { reason?: string } | undefined
        $connectionError.set(payload?.reason || 'Remote connection lost')
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
        // If we were inside a subagent block, close it before main agent resumes
        if (isSubagentActive) {
          flushBuffers()
          textBuf += '\n└───────────────────────────────\n'
          isSubagentActive = false
          subagentSource = ''
        }
        textBuf += text
        scheduleFlush()
        return
      }
      case 'message.complete': {
        // Close any active subagent block before finalizing
        if (isSubagentActive) {
          flushBuffers()
          textBuf += '\n└───────────────────────────────\n'
          isSubagentActive = false
          subagentSource = ''
        }
        // Make sure all buffered deltas land in the turn before we close it.
        flushBuffers()
        const p = ev.payload as { usage?: unknown; status?: string; reasoning?: string } | undefined
        
        // ADDED: Store the latest usage in $lastUsage for StatusBar display (Issue #8 fix)
        if (p?.usage) {
          const usage = p.usage as AssistantTurn['usage']
          if (usage) {
            $lastUsage.set({
              model: usage.model,
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens,
            })
          }
        }
        
        // Materialise the full text from contentParts chunks so that
        // transcript / legacy rendering / truncation have the joined
        // string. During streaming we only pushed to chunks[] (O(1)),
        // avoiding O(n²) concatenation. Now that streaming is done we
        // join once — O(n) total, not O(n²).
        updateCurrent(t => {
          let fullText = t.text
          if (t.contentParts.length > 0 && !fullText) {
            fullText = t.contentParts
              .filter((part): part is import('./types.js').TextContentPart => part.kind === 'text')
              .map(part => {
                if (!part.text) part.text = part.chunks.join('')
                return part.text
              })
              .join('')
          }
          return {
            ...t,
            text: fullText,
            usage: (p?.usage as AssistantTurn['usage']) ?? t.usage,
            status:
              p?.status === 'interrupted' || p?.status === 'error'
                ? (p.status as AssistantTurn['status'])
                : 'complete',
            reasoning: p?.reasoning ? t.reasoning + (t.reasoning ? '\n' : '') + p.reasoning : t.reasoning,
          }
        })
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
        // Flush any pending text buffer first so the text that arrived
        // BEFORE this tool call is committed as a separate text segment
        // in contentParts — otherwise it would be appended after the
        // tool part (breaking the interleaving order).
        flushBuffers()
        const tool = toolFromStart(ev.payload as never)
        updateCurrent(t => ({
          ...t,
          tools: [...t.tools, tool],
          contentParts: [...t.contentParts, { kind: 'tool', id: `cp-${tool.id}`, toolId: tool.id }],
        }))
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
      case 'subagent.spawn_requested': {
        // 子智能体被请求启动 — 短暂显示提示
        const p = ev.payload as { source?: string; goal?: string } | undefined
        const name = p?.source?.replace(/^sub:/, '') ?? 'subagent'
        $statusLine.set(`⚡ Starting ${name}…`)
        return
      }
      case 'subagent.start': {
        // 子智能体开始工作 — 在状态栏显示提示
        const p = ev.payload as { source?: string; goal?: string } | undefined
        const name = p?.source?.replace(/^sub:/, '') ?? 'subagent'
        $statusLine.set(`⚡ ${name}: ${p?.goal ? p.goal.slice(0, 60) : 'working…'}`)
        return
      }
      case 'subagent.thinking': {
        // 子智能体流式 token — 追加到当前 turn 的 text，带视觉区分标记
        const text = (ev.payload as { text?: string } | undefined)?.text || ''
        if (!text) return

        // 如果之前不在子智能体模式，先 flush 主缓冲区并插入开始标记
        if (!isSubagentActive) {
          flushBuffers()
          isSubagentActive = true
          const source = (ev.payload as { source?: string } | undefined)?.source?.replace(/^sub:/, '') ?? 'subagent'
          subagentSource = source
          textBuf += `\n\n┌─ 🤖 ${source} ─────────────────\n`
        }

        textBuf += text
        scheduleFlush()
        return
      }
      case 'subagent.tool': {
        // 子智能体的工具调用 — 追加到当前 turn 的工具列表，带 sub: 前缀区分来源
        const p = ev.payload as { tool_id?: string; name?: string; args?: Record<string, unknown>; preview?: string; result?: string; status?: string } | undefined
        if (!p?.name) return

        const toolId = p.tool_id || `sub-${Date.now()}`
        const existing = $current.get()
        if (existing) {
          const existingTool = existing.tools.find(t => t.id === toolId)
          if (existingTool) {
            // 更新已有工具（完成状态）
            // Cap result size to prevent heap growth from large subagent tool outputs.
            let subResult = p.result
            if (subResult && subResult.length > MAX_TOOL_RESULT_CHARS) {
              subResult = subResult.slice(0, MAX_TOOL_RESULT_CHARS) + TOOL_TRUNC_SUFFIX
            }
            updateCurrent(c => ({
              ...c,
              tools: c.tools.map(t =>
                t.id === toolId
                  ? { ...t, status: 'complete' as const, result: subResult, durationMs: Date.now() - t.startedAt }
                  : t,
              ),
            }))
          } else {
            // 新工具调用 — flush pending text first to preserve order
            flushBuffers()
            const subTool = toolFromStart({
              tool_id: toolId,
              name: `sub:${p.name}`,
              args: p.args || {},
              preview: p.preview,
            })
            updateCurrent(c => ({
              ...c,
              tools: [...c.tools, subTool],
              contentParts: [...c.contentParts, { kind: 'tool', id: `cp-${subTool.id}`, toolId: subTool.id }],
            }))
          }
        }
        return
      }
      case 'subagent.progress': {
        // 子智能体进度更新 — 显示在状态栏（不追加到 transcript）
        const p = ev.payload as { text?: string; percent?: number } | undefined
        if (p?.text) {
          const pct = p.percent != null ? ` (${p.percent}%)` : ''
          $statusLine.set(`⚡ ${subagentSource || 'subagent'}: ${p.text.slice(0, 80)}${pct}`)
        }
        return
      }
      case 'subagent.complete': {
        // 子智能体完成 — 如有流式输出则添加结束标记
        if (isSubagentActive) {
          flushBuffers()
          textBuf += '\n└───────────────────────────────\n'
          scheduleFlush()
          isSubagentActive = false
          subagentSource = ''
        }

        const p = ev.payload as { text?: string; source?: string } | undefined
        const finalText = p?.text || ''
        // 如果没有经过 subagent.thinking 流式传输（非流式子智能体），
        // 则把最终文本作为一次性 delta 追加（带视觉标记）
        if (finalText) {
          const cur = $current.get()
          if (cur && !cur.text && !textBuf) {
            const source = p?.source?.replace(/^sub:/, '') ?? 'subagent'
            textBuf += `\n\n┌─ 🤖 ${source} ─────────────────\n`
            textBuf += finalText
            textBuf += '\n└───────────────────────────────\n'
            scheduleFlush()
          }
        }
        $statusLine.set('')
        return
      }

      // ── Status ───────────────────────────────────────────────
      case 'status.update': {
        const p = ev.payload as { kind?: string; text?: string } | undefined
        // Memory preview: display as a persistent banner, not a fleeting status line
        if (p?.kind === 'memory.preview' && p?.text) {
          $memoryPreview.set(p.text)
          $statusLine.set('')
          return
        }
        if (p?.text) $statusLine.set(`${p.kind ?? 'status'}: ${p.text}`)
        else $statusLine.set('')
        return
      }
      case 'error': {
        // Close any active subagent block, then flush so the partial answer
        // up to the error is preserved.
        if (isSubagentActive) {
          flushBuffers()
          textBuf += '\n└───────────────────────────────\n'
          isSubagentActive = false
          subagentSource = ''
        }
        flushBuffers()
        const msg = (ev.payload as { message?: string } | undefined)?.message || 'unknown error'
        const cur = $current.get()
        if (cur) {
          // Materialise full text from chunks (same as message.complete).
          let fullText = cur.text
          if (cur.contentParts.length > 0 && !fullText) {
            fullText = cur.contentParts
              .filter((part): part is import('./types.js').TextContentPart => part.kind === 'text')
              .map(part => {
                if (!part.text) part.text = part.chunks.join('')
                return part.text
              })
              .join('')
          }
          setCurrent({ ...cur, text: fullText, status: 'error', errorMessage: msg })
          // End of turn (errored) — finalize too.
          controller?.finalize()
        } else {
          $statusLine.set(`error: ${msg}`)
        }
        return
      }

      // ── Background task completion ───────────────────────────
      case 'background.complete': {
        flushBuffers()
        const p = ev.payload as {
          task_id?: string
          task_name?: string
          status?: string
          result_preview?: string
          duration_ms?: number
        } | undefined
        const taskName = p?.task_name || p?.task_id || 'task'
        const icon = p?.status === 'success' ? '✅' : p?.status === 'error' ? '❌' : '⏱'
        const dur = p?.duration_ms ? ` (${(p.duration_ms / 1000).toFixed(1)}s)` : ''
        $statusLine.set(`${icon} Task "${taskName}" ${p?.status || 'complete'}${dur}`)
        // Auto-clear status after 5 seconds
        setTimeout(() => {
          const cur = $statusLine.get()
          if (cur?.includes(taskName)) $statusLine.set('')
        }, 5000)
        return
      }

      // ── Reasoning availability notification ──────────────────
      case 'reasoning.available': {
        const p = ev.payload as { available?: boolean; levels?: string[] } | undefined
        if (p?.available) {
          $statusLine.set(`💡 Reasoning available: ${(p.levels || []).join(', ')}`)
          setTimeout(() => {
            const cur = $statusLine.get()
            if (cur?.includes('Reasoning available')) $statusLine.set('')
          }, 3000)
        }
        return
      }

      default:
        return
    }
  }
}
