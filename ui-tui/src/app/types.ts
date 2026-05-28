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
  return {
    ...call,
    status: 'complete',
    result: p.result,
    durationMs: p.duration_ms || (Date.now() - call.startedAt),
  }
}
