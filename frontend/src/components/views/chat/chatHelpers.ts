import { AgentMessageConfig, Message } from "../../types/datamodel";

/**
 * Create a Message object from AgentMessageConfig
 */
export const createMessage = (
  config: AgentMessageConfig,
  runId: string,
  sessionId: number,
  userEmail?: string
): Message => ({
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  config,
  session_id: sessionId,
  run_id: runId,
  user_id: userEmail || undefined,
});

