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
  error?: { code?: string; message?: string; retryable?: boolean; correlation_id?: string };
  detail?: string | { code?: string; message?: string; correlation_id?: string };
}

export class RemoteProtocolError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly correlationId?: string,
    readonly retryable = false,
  ) { super(message); this.name = "RemoteProtocolError"; }
}

export function parseRemoteProtocolError(status: number, body: RemoteProtocolErrorBody | null, correlationHeader?: string | null): RemoteProtocolError {
  const detail = body?.error ?? (typeof body?.detail === "object" ? body.detail : undefined);
  const message = detail?.message ?? (typeof body?.detail === "string" ? body.detail : `Remote Gateway request failed (${status}).`);
  return new RemoteProtocolError(message, status, detail?.code ?? `http_${status}`, detail?.correlation_id ?? correlationHeader ?? undefined, body?.error?.retryable === true);
}
