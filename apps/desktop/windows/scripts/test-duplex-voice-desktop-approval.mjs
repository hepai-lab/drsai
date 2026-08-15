import assert from "node:assert/strict";
import { DesktopDuplexToolApprovalGate } from "../../shared/renderer/src/voice/duplex/desktopToolApprovalGate.ts";

const listeners = new Set(); const proposals = [];
const api = {
  requestDuplexVoiceToolApproval: async (request) => { proposals.push(request); return { queued: true, approval: { id: `approval:${request.callId}` }, allowed: true, requiresApproval: true, blocked: false, reason: "approval required" }; },
  onDuplexVoiceToolApprovalDecision: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
};
const emit = (decision) => { for (const listener of listeners) listener(decision); };
const gate = new DesktopDuplexToolApprovalGate(api, "voice-duplex-session-12345678", 50);
let settled = false; const allow = gate.decide({ callId: "write-1", name: "write_workspace_file", arguments: { path: "a.txt", password: "never-log" } }).then((value) => { settled = true; return value; });
await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false, "execution remains blocked before a Desktop decision"); assert.doesNotMatch(proposals[0].argumentsSummary, /never-log/); emit({ sessionId: "other-session", callId: "write-1", decision: "allow" }); await Promise.resolve(); assert.equal(settled, false, "another Session cannot grant approval"); emit({ sessionId: "voice-duplex-session-12345678", callId: "write-1", decision: "allow" }); assert.equal(await allow, "allow");
const rejected = gate.decide({ callId: "write-2", name: "delete_file", arguments: {} }); await Promise.resolve(); await Promise.resolve(); emit({ sessionId: "voice-duplex-session-12345678", callId: "write-2", decision: "reject" }); assert.equal(await rejected, "reject");
assert.equal(await gate.decide({ callId: "write-3", name: "write_file", arguments: {} }), "timeout");
const cancelled = gate.decide({ callId: "write-4", name: "write_file", arguments: {} }); await Promise.resolve(); await Promise.resolve(); gate.dispose(); assert.equal(await cancelled, "cancel"); assert.equal(listeners.size, 0);
console.log("Desktop Duplex tool approval verified (formal proposal, no pre-click execution, Session isolation, allow/reject/timeout/cancel, and argument redaction).");
