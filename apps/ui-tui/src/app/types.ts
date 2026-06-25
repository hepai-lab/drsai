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
 *  sessions with many tool calls (e.g. reading large files). */
export const MAX_TOOL_RESULT_CHARS = parseInt(process.env.DRSAI_MAX_TOOL_RESULT || '10000', 10)
export const TOOL_TRUNC_SUFFIX = '\n…[output truncated]'

export interface AssistantTurn {
  role: 'assistant'
  text: string                  // streamed body (visible)
  reasoning: string             // streamed thinking.delta / reasoning.delta
  tools: ToolCall[]
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
    tools: [],
    status: 'streaming',
    startedAt: Date.now(),
  }
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
