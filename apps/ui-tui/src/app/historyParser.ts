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

export function parseHistoryMessage(msg: Record<string, unknown>): Turn | null {
  const role = msg.role as string
  
  if (role === 'user') {
    return {
      role: 'user',
      text: (msg.content as string) || '',
      timestamp: Date.now(),
    } as UserTurn
  }
  
  if (role === 'assistant') {
    const turn: AssistantTurn = {
      role: 'assistant',
      text: (msg.content as string) || '',
      timestamp: Date.now(),
      tools: [],
      reasoning: '',
      status: 'completed',
    }
    
    // Parse tool calls if present
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
      turn.tools = msg.tool_calls.map((tc: any) => ({
        id: tc.id || tc.tool_id || '',
        name: tc.function?.name || tc.name || '',
        args: typeof tc.function?.arguments === 'string' 
          ? tc.function.arguments 
          : JSON.stringify(tc.function?.arguments || tc.args || {}),
        result: tc.result || '',
        duration_ms: tc.duration_ms || 0,
        completed: true,
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
