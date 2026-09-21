import type { DesktopApi, DesktopDuplexVoiceToolApprovalDecision } from "../../../../api/desktopApi";
import { summarizeToolArguments, type DuplexToolApprovalGate } from "./toolBridge";

export class DesktopDuplexToolApprovalGate implements DuplexToolApprovalGate {
  readonly #api: Pick<DesktopApi, "requestDuplexVoiceToolApproval" | "onDuplexVoiceToolApprovalDecision">;
  readonly #sessionId: string;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, { resolve: (decision: "allow" | "reject" | "timeout" | "cancel") => void; timer: ReturnType<typeof setTimeout> }>();
  readonly #unsubscribe: () => void;
  constructor(api: Pick<DesktopApi, "requestDuplexVoiceToolApproval" | "onDuplexVoiceToolApprovalDecision">, sessionId: string, timeoutMs = 120_000) {
    this.#api = api; this.#sessionId = sessionId; this.#timeoutMs = timeoutMs;
    this.#unsubscribe = api.onDuplexVoiceToolApprovalDecision((decision) => this.#settle(decision));
  }
  async decide(call: { callId: string; name: string; arguments: Record<string, unknown> }): Promise<"allow" | "reject" | "timeout" | "cancel"> {
    if (this.#pending.has(call.callId)) return "cancel";
    const proposal = await this.#api.requestDuplexVoiceToolApproval({ sessionId: this.#sessionId, callId: call.callId, name: call.name, argumentsSummary: summarizeToolArguments(call.arguments), scope: "Current Realtime voice Session", risk: "high" });
    if (proposal.blocked || !proposal.allowed) return "reject";
    if (!proposal.requiresApproval) return "allow";
    if (!proposal.queued || !proposal.approval) return "reject";
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.#pending.delete(call.callId); resolve("timeout"); }, this.#timeoutMs);
      this.#pending.set(call.callId, { resolve, timer });
    });
  }
  dispose(): void { this.#unsubscribe(); for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.resolve("cancel"); } this.#pending.clear(); }
  #settle(decision: DesktopDuplexVoiceToolApprovalDecision): void { if (decision.sessionId !== this.#sessionId) return; const pending = this.#pending.get(decision.callId); if (!pending) return; clearTimeout(pending.timer); this.#pending.delete(decision.callId); pending.resolve(decision.decision); }
}
