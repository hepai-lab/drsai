import type { OaepEvent, OaepEventPage, OaepSnapshot } from "./runtimeClient";
import type { ExternalAgentRuntimeDescriptor } from "./externalAgentRuntimes";

interface RuntimeErrorEnvelope {
  error?: { code?: string; message?: string; retryable?: boolean };
  snapshot?: OaepSnapshot;
}

export class ExternalOaepRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly snapshot?: OaepSnapshot,
  ) {
    super(message);
    this.name = "ExternalOaepRuntimeError";
  }
}

export class ExternalOaepRuntimeClient {
  constructor(readonly descriptor: ExternalAgentRuntimeDescriptor) {}

  async createSession(idempotencyKey: string, signal?: AbortSignal): Promise<string> {
    const value = await this.json<{ session: { id: string } }>("/v1/sessions", {
      method: "POST", body: { idempotency_key: idempotencyKey }, signal,
    });
    return value.session.id;
  }

  async resumeSession(sessionId: string, signal?: AbortSignal): Promise<OaepSnapshot> {
    const value = await this.json<{ snapshot: OaepSnapshot }>(
      `/v1/sessions/${this.id(sessionId)}/resume`, { method: "POST", body: {}, signal },
    );
    return value.snapshot;
  }

  async startRun(
    sessionId: string,
    idempotencyKey: string,
    contentBlocks: Array<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<{ run_id: string; status: string }> {
    return this.json(`/v1/sessions/${this.id(sessionId)}/runs`, {
      method: "POST", body: { idempotency_key: idempotencyKey, content_blocks: contentBlocks }, signal,
    });
  }

  async cancelRun(runId: string): Promise<void> {
    await this.json(`/v1/runs/${this.id(runId)}/cancel`, { method: "POST", body: {} });
  }

  async respondApproval(runId: string, approvalId: string, outcome: string): Promise<void> {
    await this.json(`/v1/runs/${this.id(runId)}/approvals/${this.id(approvalId)}/decision`, {
      method: "POST", body: { outcome },
    });
  }

  getSnapshot(sessionId: string, signal?: AbortSignal): Promise<OaepSnapshot> {
    return this.json(`/v1/sessions/${this.id(sessionId)}/oaep-snapshot`, { method: "GET", signal });
  }

  getEvents(sessionId: string, afterSequence: number, signal?: AbortSignal): Promise<OaepEventPage> {
    return this.json(
      `/v1/sessions/${this.id(sessionId)}/oaep-events?after_sequence=${afterSequence}&limit=200`,
      { method: "GET", signal },
    );
  }

  async waitEvents(sessionId: string, afterSequence: number, signal?: AbortSignal): Promise<OaepEvent[]> {
    const response = await this.request(
      `/v1/sessions/${this.id(sessionId)}/oaep-events/stream?after_sequence=${afterSequence}&limit=200&wait_seconds=25`,
      { method: "GET", signal },
    );
    const text = await response.text();
    return text.replace(/\r\n/g, "\n").split("\n\n").flatMap((frame) => {
      const data = frame.split("\n").filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      return data ? [JSON.parse(data) as OaepEvent] : [];
    });
  }

  private async json<T>(
    path: string,
    options: { method: "GET" | "POST"; body?: Record<string, unknown>; signal?: AbortSignal },
  ): Promise<T> {
    const response = await this.request(path, options);
    return response.json() as Promise<T>;
  }

  private async request(
    path: string,
    options: { method: "GET" | "POST"; body?: Record<string, unknown>; signal?: AbortSignal },
  ): Promise<Response> {
    const response = await fetch(`${this.descriptor.baseUrl}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${this.descriptor.bearerToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: options.signal,
    });
    if (response.ok) return response;
    let envelope: RuntimeErrorEnvelope = {};
    try { envelope = await response.json() as RuntimeErrorEnvelope; } catch { /* bounded generic error below */ }
    throw new ExternalOaepRuntimeError(
      envelope.error?.code || `runtime_http_${response.status}`,
      envelope.error?.message || "External Agent Runtime request failed.",
      response.status,
      envelope.error?.retryable === true,
      envelope.snapshot,
    );
  }

  private id(value: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) throw new Error("External Runtime resource id is invalid.");
    return encodeURIComponent(value);
  }
}
