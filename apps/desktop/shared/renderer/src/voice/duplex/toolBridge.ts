import type { DesktopDuplexVoiceToolCall } from "../../../../api/desktopApi";

export type DuplexToolStatus = "waiting_approval" | "running" | "completed" | "rejected" | "failed" | "cancelled" | "detached";
export interface DuplexToolExecutionResult { output: unknown; sideEffectCommitted?: boolean }
export interface DuplexToolExecutor { execute(call: { callId: string; name: string; arguments: Record<string, unknown> }): Promise<DuplexToolExecutionResult> }
export interface DuplexToolApprovalGate { decide(call: { callId: string; name: string; arguments: Record<string, unknown> }): Promise<"allow" | "reject" | "timeout" | "cancel"> }
export interface DuplexToolBridgeOptions {
  executor: DuplexToolExecutor; approval: DuplexToolApprovalGate;
  isSessionActive: () => boolean; submitResult: (callId: string, output: string) => Promise<boolean>;
  onStatus?: (callId: string, status: DuplexToolStatus, detail?: string) => void;
}

export class DuplexToolBridge {
  readonly #options: DuplexToolBridgeOptions;
  readonly #calls = new Map<string, Promise<DuplexToolStatus>>();
  #detached = false;
  constructor(options: DuplexToolBridgeOptions) { this.#options = options; }
  handle(call: DesktopDuplexVoiceToolCall): Promise<DuplexToolStatus> {
    const existing = this.#calls.get(call.callId); if (existing) return existing;
    const operation = this.#run(call); this.#calls.set(call.callId, operation); return operation;
  }
  detach(): void { this.#detached = true; }
  get callCount(): number { return this.#calls.size; }

  async #run(call: DesktopDuplexVoiceToolCall): Promise<DuplexToolStatus> {
    let args: Record<string, unknown>;
    try { args = parseToolArguments(call.argumentsJson); } catch (error) { return this.#terminal(call.callId, "failed", error instanceof Error ? error.message : String(error)); }
    if (requiresApproval(call.name)) {
      this.#status(call.callId, "waiting_approval", "Waiting for keyboard or pointer approval.");
      const decision = await this.#options.approval.decide({ callId: call.callId, name: call.name, arguments: args });
      if (decision !== "allow") return this.#terminal(call.callId, decision === "reject" ? "rejected" : "cancelled", `Tool approval ${decision}.`);
    }
    this.#status(call.callId, "running", "Tool is running.");
    try {
      const result = await this.#options.executor.execute({ callId: call.callId, name: call.name, arguments: args });
      if (this.#detached || !this.#options.isSessionActive()) return this.#finish(call.callId, "detached", result.sideEffectCommitted ? "Tool completed after voice detached; its side effect was not undone." : "Late result was isolated from the inactive voice Session.");
      const submitted = await this.#options.submitResult(call.callId, serializeToolResult(result.output));
      return this.#finish(call.callId, submitted ? "completed" : "detached", submitted ? "Tool result returned to Realtime." : "Tool result target was no longer active.");
    } catch (error) { return this.#terminal(call.callId, "failed", error instanceof Error ? error.message : String(error)); }
  }
  async #terminal(callId: string, status: Exclude<DuplexToolStatus, "completed" | "running" | "waiting_approval" | "detached">, detail: string): Promise<DuplexToolStatus> {
    this.#status(callId, status, detail);
    if (!this.#detached && this.#options.isSessionActive()) await this.#options.submitResult(callId, serializeToolResult({ status, error: detail })).catch(() => false);
    return status;
  }
  #finish(callId: string, status: DuplexToolStatus, detail: string): DuplexToolStatus { this.#status(callId, status, detail); return status; }
  #status(callId: string, status: DuplexToolStatus, detail?: string): void { this.#options.onStatus?.(callId, status, detail); }
}

export function parseToolArguments(value: string): Record<string, unknown> {
  if (typeof value !== "string" || value.length > 32_000) throw new Error("Realtime tool arguments exceed the safe limit.");
  const parsed: unknown = JSON.parse(value || "{}"); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Realtime tool arguments must be a JSON object.");
  validateDepth(parsed, 0); return parsed as Record<string, unknown>;
}
export function requiresApproval(name: string): boolean { return !/^(?:get|list|read|search|find|status|preview|diagnose)[_.:-]/iu.test(name); }
export function serializeToolResult(value: unknown): string {
  const seen = new WeakSet<object>();
  const text = JSON.stringify(value, (key, item) => {
    if (/token|authorization|api[_-]?key|secret|password/i.test(key)) return "[redacted]";
    if (item && typeof item === "object") { if (seen.has(item)) return "[circular]"; seen.add(item); }
    return item;
  }) ?? "null";
  return text.length <= 16_000 ? text : `${text.slice(0, 15_980)}…[truncated]`;
}
function validateDepth(value: unknown, depth: number): void { if (depth > 8) throw new Error("Realtime tool arguments are too deeply nested."); if (Array.isArray(value)) for (const item of value) validateDepth(item, depth + 1); else if (value && typeof value === "object") for (const item of Object.values(value)) validateDepth(item, depth + 1); }
