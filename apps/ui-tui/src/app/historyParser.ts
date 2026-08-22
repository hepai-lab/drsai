/**
 * Parse history messages from the backend into Turn objects for the transcript.
 *
 * Background:
 *   session.resume returns a `history` array containing raw message objects
 *   from the database. We need to convert these into the Turn format that
 *   the transcript component expects.
 *
 * Message format (from backend):
 *   {
 *     role: 'user' | 'assistant',
 *     content: string,
 *     tool_calls?: [...],
 *     usage?: { prompt_tokens, completion_tokens, ... },
 *     ...
 *   }
 */

import type { AssistantTurn, Turn, UserTurn } from './types.js'

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function asArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return { _raw: value }
    }
  }
  return {}
}

export function parseHistoryMessage(msg: Record<string, unknown>): Turn | null {
  const role = msg.role as string
  
  if (role === 'user') {
    return {
      role: 'user',
      text: (msg.content as string) || '',
      ts: asNumber(msg.created_at ?? msg.timestamp, Date.now()),
    } satisfies UserTurn
  }
  
  if (role === 'assistant') {
    const turn: AssistantTurn = {
      role: 'assistant',
      text: (msg.content as string) || '',
      startedAt: asNumber(msg.created_at ?? msg.timestamp, Date.now()),
      tools: [],
      reasoning: '',
      contentParts: [],
      status: 'complete',
    }
    
    // Parse tool calls if present
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      turn.tools = msg.tool_calls.map((tc: any) => ({
        id: tc.id || tc.tool_id || '',
        name: tc.function?.name || tc.name || '',
        args: asArgs(tc.function?.arguments ?? tc.args),
        status: 'complete',
        result: tc.result || '',
        durationMs: tc.duration_ms || tc.durationMs || 0,
        startedAt: asNumber(tc.started_at ?? tc.startedAt, Date.now()),
      }))
    }
    
    // Parse usage if present
    if (msg.usage && typeof msg.usage === 'object') {
      const usage = msg.usage as Record<string, unknown>
      turn.usage = {
        model: (usage.model as string) || 'unknown',
        prompt_tokens: (usage.prompt_tokens as number) || 0,
        completion_tokens: (usage.completion_tokens as number) || 0,
        total_tokens: (usage.total_tokens as number) || 0,
        status: (usage.status as string) || 'complete',
      }
    }
    
    return turn
  }
  
  // Skip system messages or unknown roles
  return null
}

/**
 * Parse an array of history messages into Turn objects.
 * Filters out null results (system messages, etc.)
 */
export function parseHistory(history: Array<Record<string, unknown>>): Turn[] {
  return history
    .map(parseHistoryMessage)
    .filter((turn): turn is Turn => turn !== null)
}
