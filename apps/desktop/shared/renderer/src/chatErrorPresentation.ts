import type { UserFacingError, UserFacingRecoveryAction } from "./userFacingErrors";

export type ChatErrorSeverity = "warning" | "error";

/** Optional progressive error UI attached to an assistant message. Legacy flags remain authoritative for compatibility. */
export interface ChatErrorPresentation {
  severity: ChatErrorSeverity;
  title: string;
  summary: string;
  code: string;
  traceId: string;
  retryable: boolean;
  partialContentPreserved: boolean;
  actions: UserFacingRecoveryAction[];
}

export function createChatErrorPresentation(
  error: UserFacingError,
  traceId: string,
): ChatErrorPresentation {
  const [code = "unexpected_error"] = error.diagnosticCode.split("·", 1);
  return {
    severity: "error",
    title: error.title,
    summary: error.action,
    code: code.trim() || "unexpected_error",
    traceId,
    retryable: error.retryable,
    partialContentPreserved: false,
    actions: error.actions,
  };
}

export function applyChatTransportFailure<T extends {
  content: string;
  error?: boolean;
  replyFailed?: boolean;
  streaming?: boolean;
  recoveryActions?: UserFacingRecoveryAction[];
  errorPresentation?: ChatErrorPresentation;
}>(message: T, presentation: ChatErrorPresentation): T {
  const partialContentPreserved = Boolean(message.content.trim());
  return {
    ...message,
    // Error copy belongs to the card, never to the assistant's answer body.
    content: message.content,
    replyFailed: false,
    streaming: false,
    error: !partialContentPreserved,
    recoveryActions: presentation.actions,
    errorPresentation: { ...presentation, partialContentPreserved },
  };
}

export function terminalEventShowsSystemError(type: "done" | "aborted" | "error"): boolean {
  return type === "error";
}
