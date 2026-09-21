export const REMOTE_SSH_PROTOCOL_VERSION = 1 as const;

export const REMOTE_CAPABILITY_VERSIONS = {
  threads: 1,
  chat: 1,
  files: 2,
  "file-watch": 2,
  git: 1,
  approvals: 1,
  "hepai-worker": 1,
  pty: 2,
} as const;

export type RemoteCapability = keyof typeof REMOTE_CAPABILITY_VERSIONS;

export interface RemoteProtocolErrorBody {
  error?: RemoteProtocolErrorDetail;
  detail?: string | RemoteProtocolErrorDetail;
}

interface RemoteProtocolErrorDetail {
  code?: string; message?: string; retryable?: boolean; correlation_id?: string;
  detail?: { approval_id?: string };
  category?: string; user_message_key?: string; recovery_actions?: string[];
  diagnostic_reference?: string; redacted_details?: Record<string, unknown>;
}

export class RemoteProtocolError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly correlationId?: string,
    readonly retryable = false,
    readonly detail: { approvalId?: string } = {},
    readonly envelope?: RemoteProtocolErrorDetail,
  ) { super(message); this.name = "RemoteProtocolError"; }
}

export function parseRemoteProtocolError(status: number, body: RemoteProtocolErrorBody | null, correlationHeader?: string | null): RemoteProtocolError {
  const errorValue: unknown = body?.error;
  const detailValue: unknown = body?.detail;
  const detail = errorValue && typeof errorValue === "object"
    ? errorValue as NonNullable<RemoteProtocolErrorBody["error"]>
    : detailValue && typeof detailValue === "object"
      ? detailValue as Exclude<RemoteProtocolErrorBody["detail"], string | undefined>
      : undefined;
  const stringError = typeof errorValue === "string" ? errorValue : undefined;
  const message = detail?.message
    ?? (typeof detailValue === "string" ? detailValue : stringError)
    ?? `Remote Gateway request failed (${status}).`;
  return new RemoteProtocolError(
    message, status, detail?.code ?? `http_${status}`,
    detail?.correlation_id ?? correlationHeader ?? undefined,
    detail?.retryable === true,
    { approvalId: detail?.detail?.approval_id },
    detail,
  );
}
