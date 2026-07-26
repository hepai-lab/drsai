export interface DesktopIpcWebContents {
  getURL(): string;
  isDestroyed(): boolean;
}

export interface DesktopIpcInvokeEvent {
  sender: DesktopIpcWebContents;
  senderFrame?: { url?: string } | null;
}

export interface DesktopIpcRegistrar {
  handle(channel: string, handler: (event: DesktopIpcInvokeEvent, ...args: unknown[]) => unknown): void;
}

export type DesktopIpcAuditEvent = {
  channel: string;
  outcome: "started" | "succeeded" | "blocked" | "failed";
  durationMs: number;
  argumentCount: number;
  errorCode?: string;
};

export class DesktopIpcBoundaryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopIpcBoundaryError";
    this.code = code;
  }
}

export type SecureIpcOptions = {
  registrar: DesktopIpcRegistrar;
  getTrustedWebContents: () => DesktopIpcWebContents | null | undefined;
  allowDevelopmentUrl?: (url: string) => boolean;
  audit?: (event: DesktopIpcAuditEvent) => void | Promise<void>;
  now?: () => number;
  defaultTimeoutMs?: number;
  deduplicationWindowMs?: number;
  policyForChannel?: (channel: string) => DesktopIpcChannelPolicy | undefined;
};

export type DesktopIpcChannelPolicy = {
  timeoutMs?: number;
  validateArguments?: (args: unknown[]) => void;
  validateResult?: (result: unknown) => void;
  deduplicate?: boolean;
};

type IpcExecutionContext = { signal: AbortSignal; channel: string };
const executionContext = new AsyncLocalStorage<IpcExecutionContext>();

export function getCurrentDesktopIpcAbortSignal(): AbortSignal | undefined {
  return executionContext.getStore()?.signal;
}

function stableError(code: string, message: string): DesktopIpcBoundaryError {
  return new DesktopIpcBoundaryError(code, message);
}

function sanitizeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "Desktop operation failed.";
  return raw
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[PATH]")
    .replace(/\/(?:Users|home)\/[^\s]+/g, "[PATH]")
    .slice(0, 500) || "Desktop operation failed.";
}

export function assertDesktopIpcValue(value: unknown, label: string): void {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let stringBytes = 0;
  const visit = (current: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 100_000 || depth > 32) throw stableError("IPC_PAYLOAD_INVALID", `${label} exceeds the structural limit.`);
    if (typeof current === "string") {
      stringBytes += current.length;
      if (stringBytes > 8 * 1024 * 1024) throw stableError("IPC_PAYLOAD_TOO_LARGE", `${label} exceeds the size limit.`);
      return;
    }
    if (current === null || current === undefined || ["boolean", "number", "bigint"].includes(typeof current)) return;
    if (typeof current === "function" || typeof current === "symbol") {
      throw stableError("IPC_PAYLOAD_INVALID", `${label} contains a non-transferable value.`);
    }
    if (current instanceof Date) {
      if (Number.isNaN(current.getTime())) throw stableError("IPC_PAYLOAD_INVALID", `${label} contains an invalid date.`);
      return;
    }
    if (current instanceof ArrayBuffer || ArrayBuffer.isView(current)) return;
    if (typeof current !== "object") return;
    if (seen.has(current)) throw stableError("IPC_PAYLOAD_INVALID", `${label} contains a cycle.`);
    seen.add(current);
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(current)) {
      throw stableError("IPC_PAYLOAD_INVALID", `${label} contains an unsupported object type.`);
    }
    for (const item of Array.isArray(current) ? current : Object.values(current as Record<string, unknown>)) visit(item, depth + 1);
    seen.delete(current);
  };
  visit(value, 0);
}

function requestDeduplicationKey(channel: string, args: unknown[]): string | null {
  const first = args[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const record = first as Record<string, unknown>;
  const id = record.idempotencyKey ?? record.requestId;
  return typeof id === "string" && id.trim() ? `${channel}:${id.trim()}` : null;
}

function auditSafely(callback: SecureIpcOptions["audit"], event: DesktopIpcAuditEvent): void {
  try {
    void Promise.resolve(callback?.(event)).catch(() => undefined);
  } catch {
    // Audit failures must never change the protected operation's outcome.
  }
}

export function isTrustedDesktopIpcSender(
  event: DesktopIpcInvokeEvent,
  trusted: DesktopIpcWebContents | null | undefined,
  allowDevelopmentUrl?: (url: string) => boolean,
): boolean {
  try {
    if (!trusted || trusted.isDestroyed() || event.sender !== trusted || event.sender.isDestroyed()) return false;
    const frameUrl = event.senderFrame?.url;
    if (!frameUrl) return false;
    if (frameUrl === trusted.getURL()) return true;
    return allowDevelopmentUrl?.(frameUrl) === true;
  } catch {
    return false;
  }
}

export function createSecureIpcHandle(options: SecureIpcOptions): DesktopIpcRegistrar["handle"] {
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<unknown>>();
  const completed = new Map<string, { expiresAt: number; result: unknown }>();
  return (channel, handler) => {
    if (!/^desktop:[a-z0-9][a-z0-9-]*$/.test(channel)) {
      throw new DesktopIpcBoundaryError("IPC_CHANNEL_INVALID", "Desktop IPC channel is invalid.");
    }
    options.registrar.handle(channel, async (event, ...args) => {
      const startedAt = now();
      const base = { channel, durationMs: 0, argumentCount: args.length };
      if (!isTrustedDesktopIpcSender(event, options.getTrustedWebContents(), options.allowDevelopmentUrl)) {
        auditSafely(options.audit, { ...base, outcome: "blocked", errorCode: "IPC_CALLER_UNTRUSTED" });
        throw new DesktopIpcBoundaryError("IPC_CALLER_UNTRUSTED", "Blocked untrusted desktop IPC caller.");
      }
      const policy = options.policyForChannel?.(channel);
      try {
        assertDesktopIpcValue(args, "IPC arguments");
        policy?.validateArguments?.(args);
      } catch (error) {
        const boundary = error instanceof DesktopIpcBoundaryError
          ? error
          : stableError("IPC_ARGUMENT_SCHEMA_INVALID", sanitizeErrorMessage(error));
        auditSafely(options.audit, { ...base, outcome: "blocked", errorCode: boundary.code });
        throw boundary;
      }
      auditSafely(options.audit, { ...base, outcome: "started" });
      for (const [key, entry] of completed) {
        if (entry.expiresAt <= now()) completed.delete(key);
      }
      while (completed.size > 1_000) completed.delete(completed.keys().next().value!);
      const deduplicationKey = policy?.deduplicate === false ? null : requestDeduplicationKey(channel, args);
      const cached = deduplicationKey ? completed.get(deduplicationKey) : undefined;
      if (cached && cached.expiresAt > now()) {
        auditSafely(options.audit, { ...base, outcome: "succeeded", durationMs: Math.max(0, now() - startedAt) });
        return cached.result;
      }
      if (cached) completed.delete(deduplicationKey!);
      const duplicate = deduplicationKey ? inFlight.get(deduplicationKey) : undefined;
      if (duplicate) {
        try {
          const result = await duplicate;
          auditSafely(options.audit, { ...base, outcome: "succeeded", durationMs: Math.max(0, now() - startedAt) });
          return result;
        } catch (error) {
          const boundary = error instanceof DesktopIpcBoundaryError
            ? error
            : stableError("IPC_HANDLER_FAILED", sanitizeErrorMessage(error));
          auditSafely(options.audit, { ...base, outcome: "failed", durationMs: Math.max(0, now() - startedAt), errorCode: boundary.code });
          throw boundary;
        }
      }

      const execute = async (): Promise<unknown> => {
        const controller = new AbortController();
        const timeoutMs = policy?.timeoutMs ?? options.defaultTimeoutMs ?? 5 * 60_000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const operation = executionContext.run(
          { signal: controller.signal, channel },
          () => Promise.resolve(handler(event, ...args)),
        );
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort(stableError("IPC_OPERATION_TIMEOUT", "Desktop operation timed out."));
            reject(stableError("IPC_OPERATION_TIMEOUT", "Desktop operation timed out."));
          }, Math.max(1, timeoutMs));
        });
        try {
          const result = await Promise.race([operation, timeout]);
          assertDesktopIpcValue(result, "IPC result");
          policy?.validateResult?.(result);
          if (deduplicationKey) completed.set(deduplicationKey, {
            expiresAt: now() + (options.deduplicationWindowMs ?? 30_000),
            result,
          });
          return result;
        } finally {
          if (timer) clearTimeout(timer);
        }
      };
      const pending = execute();
      if (deduplicationKey) inFlight.set(deduplicationKey, pending);
      try {
        const result = await pending;
        auditSafely(options.audit, { ...base, outcome: "succeeded", durationMs: Math.max(0, now() - startedAt) });
        return result;
      } catch (error) {
        const boundary = error instanceof DesktopIpcBoundaryError
          ? error
          : stableError("IPC_HANDLER_FAILED", sanitizeErrorMessage(error));
        auditSafely(options.audit, {
          ...base,
          outcome: "failed",
          durationMs: Math.max(0, now() - startedAt),
          errorCode: boundary.code,
        });
        throw boundary;
      } finally {
        if (deduplicationKey && inFlight.get(deduplicationKey) === pending) inFlight.delete(deduplicationKey);
      }
    });
  };
}
import { AsyncLocalStorage } from "node:async_hooks";
