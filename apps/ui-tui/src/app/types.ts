/**
 * Domain types for the UI: messages, turns, tool calls.
 *
 * Distinct from gatewayTypes.ts (which mirrors the wire protocol). These are
 * shapes the React components consume — denormalised, append-only friendly.
 */

import type { ToolCompletePayload, ToolStartPayload, UsagePayload } from '../gatewayTypes.js'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'running' | 'complete' | 'error'
  result?: string
  durationMs?: number
  startedAt: number
}

/** Maximum character length for a tool result stored in memory.
 *  Larger results are truncated to prevent heap growth during long
 *  sessions with many tool calls (e.g. reading large files).
 *  Reduced from 10000 to 5000 — the full output was already
 *  streamed to the terminal during the tool's execution; the
 *  in-memory copy only needs enough for the transcript display. */
export const MAX_TOOL_RESULT_CHARS = parseInt(process.env.DRSAI_MAX_TOOL_RESULT || '5000', 10)
export const TOOL_TRUNC_SUFFIX = '\n…[output truncated]'

/**
 * An ordered content part within an assistant turn. This preserves the
 * real interleaving order of text segments and tool calls as they
 * arrive from the LLM (e.g. text → tool → text → tool → text), which
 * the legacy flat ``text`` + ``tools[]`` fields cannot represent.
 *
 * ``text`` parts hold a contiguous text segment; when a tool call
 * interrupts the stream we close the current text part and open a new
 * one after the tool, so the rendering can show content in the correct
 * sequence.
 *
 * ── Chunk-based text accumulation ──────────────────────────────────
 *
 * During streaming, each text delta is pushed to ``chunks`` (O(1)
 * amortised) instead of concatenated into ``text`` (O(n) per flush,
 * causing O(n²) total over a long answer). The ``text`` field is
 * lazily computed by ``getPartText()`` (see below) and serves as a
 * cache: it is ``''`` until first accessed, then set to
 * ``chunks.join('')``.
 *
 * History-loaded turns set ``text`` directly with ``chunks = []``
 * (empty array means "no streaming chunks; text is authoritative").
 */
export interface TextContentPart {
  kind: 'text'
  id: string
  /** Incremental text segments pushed during streaming (source of truth). */
  chunks: string[]
  /** Lazily-joined text cache. Use ``getPartText()`` to read. */
  text: string
}

export type ContentPart = TextContentPart | { kind: 'tool'; id: string; toolId: string }

/**
 * Get the full text of a text ContentPart. If the part was streamed
 * (has chunks), join them on first access and cache the result in
 * ``part.text``. If the part has no chunks (history-loaded), return
 * ``part.text`` directly.
 *
 * This avoids O(n²) string concatenation during streaming: each flush
 * only pushes to the chunks array, and the join happens at most once
 * per render cycle (and only for VISIBLE parts).
 */
export function getPartText(part: TextContentPart): string {
  if (part.chunks.length > 0 && !part.text) {
    part.text = part.chunks.join('')
  }
  return part.text
}

export interface AssistantTurn {
  role: 'assistant'
  text: string                  // streamed body — full concatenated text (legacy / Markdown)
  reasoning: string             // streamed thinking.delta / reasoning.delta (lazy-join cache; use getReasoningText())
  reasoningChunks: string[]     // incremental reasoning segments pushed during streaming (source of truth)
  tools: ToolCall[]
  contentParts: ContentPart[]   // ordered content blocks (text ↔ tool interleaving)
  usage?: UsagePayload
  status: 'streaming' | 'complete' | 'interrupted' | 'error'
  errorMessage?: string
  startedAt: number
  completedAt?: number
}

export interface UserTurn {
  role: 'user'
  text: string
  ts: number
}

export type Turn = UserTurn | AssistantTurn

export function newAssistantTurn(): AssistantTurn {
  return {
    role: 'assistant',
    text: '',
    reasoning: '',
    reasoningChunks: [],
    tools: [],
    contentParts: [],
    status: 'streaming',
    startedAt: Date.now(),
  }
}

/**
 * Get the full reasoning text of an AssistantTurn. If the turn was
 * streamed (has reasoningChunks), join them on first access and cache
 * the result in ``turn.reasoning``. If the turn has no chunks
 * (history-loaded), return ``turn.reasoning`` directly.
 *
 * Mirrors the chunk-based pattern of ``getPartText()``: each flush
 * only pushes to the chunks array (O(1)), and the join happens at
 * most once per render cycle.
 */
export function getReasoningText(turn: AssistantTurn): string {
  if (turn.reasoningChunks.length > 0 && !turn.reasoning) {
    turn.reasoning = turn.reasoningChunks.join('')
  }
  return turn.reasoning
}

export function toolFromStart(p: ToolStartPayload): ToolCall {
  return {
    id: p.tool_id || `tool-${Date.now()}`,
    name: p.name,
    args: p.args,
    status: 'running',
    startedAt: Date.now(),
  }
}

export function applyToolComplete(call: ToolCall, p: ToolCompletePayload): ToolCall {
  // Cap result size to prevent unbounded heap growth from large tool
  // outputs (e.g. `cat` on a huge file).  The full output was already
  // streamed to the terminal during the tool's execution; the in-memory
  // copy only needs to be enough for display in the transcript.
  let result = p.result
  if (result && result.length > MAX_TOOL_RESULT_CHARS) {
    result = result.slice(0, MAX_TOOL_RESULT_CHARS) + TOOL_TRUNC_SUFFIX
  }
  return {
    ...call,
    status: 'complete',
    result,
    durationMs: p.duration_ms || (Date.now() - call.startedAt),
  }
}
