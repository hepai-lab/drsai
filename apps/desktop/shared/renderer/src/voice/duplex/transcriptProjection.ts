import type { DesktopDuplexVoiceAudioDelta, DesktopDuplexVoiceEvent } from "../../../../api/desktopApi";

export interface DuplexHistoryMessage { id: string; role: "user" | "assistant"; content: string; providerItemId: string; responseId?: string; heardContent?: string; interrupted?: boolean }
export interface DuplexContextProjection { summary: string; recent: DuplexHistoryMessage[]; totalMessages: number; truncated: boolean }

export class DuplexTranscriptProjection {
  readonly #sessionId: string;
  readonly #messages = new Map<string, DuplexHistoryMessage>();
  readonly #order: string[] = [];
  readonly #outputDrafts = new Map<string, string>();
  readonly #responseAudioMs = new Map<string, number>();
  readonly #seenEventSequences = new Set<number>();
  #inputDraft = "";
  #manualQueue: string[] = [];
  constructor(sessionId: string) { this.#sessionId = sessionId; }

  apply(event: DesktopDuplexVoiceEvent): boolean {
    if (event.sessionId !== this.#sessionId) return false;
    if (this.#seenEventSequences.has(event.sequence)) return false;
    this.#seenEventSequences.add(event.sequence);
    if (event.type === "input_transcript_delta") { this.#inputDraft += event.delta.text; return true; }
    if (event.type === "input_transcript_completed") { this.#commit({ id: this.#id("user", event.itemId), role: "user", content: sanitizeTranscript(event.text), providerItemId: event.itemId }); this.#inputDraft = ""; return true; }
    if (event.type === "response_transcript_delta") { const key = event.delta.responseId ?? event.delta.itemId; this.#outputDrafts.set(key, (this.#outputDrafts.get(key) ?? "") + event.delta.text); return true; }
    if (event.type === "response_audio_delta") { this.#responseAudioMs.set(event.delta.responseId, (this.#responseAudioMs.get(event.delta.responseId) ?? 0) + audioDurationMs(event.delta)); return true; }
    if (event.type === "response_transcript_completed") { this.#commit({ id: this.#id("assistant", event.itemId), role: "assistant", content: sanitizeTranscript(event.text), providerItemId: event.itemId, responseId: event.responseId }); this.#outputDrafts.delete(event.responseId); return true; }
    if (event.type === "interrupted") { this.#markInterrupted(event.responseId, event.playedAudioMs); return true; }
    return false;
  }

  queueManualText(text: string, sessionActive: boolean): "queued" | "empty" {
    const value = text.trim(); if (!value) return "empty";
    if (sessionActive) this.#manualQueue.push(value); else this.#manualQueue.unshift(value);
    return "queued";
  }
  drainManualText(): string[] { const values = [...this.#manualQueue]; this.#manualQueue = []; return values; }
  get inputDraft(): string { return this.#inputDraft; }
  get outputDrafts(): ReadonlyMap<string, string> { return this.#outputDrafts; }
  get messages(): DuplexHistoryMessage[] { return this.#order.map((id) => this.#messages.get(id)!).filter(Boolean); }

  context(maxChars = 8_000, recentCount = 12): DuplexContextProjection {
    const messages = this.messages; const recent = messages.slice(-recentCount); const older = messages.slice(0, -recent.length);
    let summary = older.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n");
    const truncated = summary.length > maxChars; if (truncated) summary = `…${summary.slice(-(maxChars - 1))}`;
    return { summary, recent, totalMessages: messages.length, truncated };
  }

  #id(role: "user" | "assistant", itemId: string): string { return `duplex:${this.#sessionId}:${role}:${itemId}`; }
  #commit(message: DuplexHistoryMessage): void {
    if (!message.content) return;
    const existing = this.#messages.get(message.id);
    this.#messages.set(message.id, existing ? { ...existing, ...message } : message);
    if (!existing) this.#order.push(message.id);
  }
  #markInterrupted(responseId: string, playedAudioMs: number): void {
    const message = this.messages.find((candidate) => candidate.responseId === responseId); if (!message) return;
    const generatedMs = this.#responseAudioMs.get(responseId) ?? 0;
    const ratio = generatedMs > 0 ? Math.max(0, Math.min(1, playedAudioMs / generatedMs)) : 0;
    const heardLength = Math.min(message.content.length, Math.floor(message.content.length * ratio));
    this.#messages.set(message.id, { ...message, interrupted: true, heardContent: message.content.slice(0, heardLength) });
  }
}

function audioDurationMs(delta: DesktopDuplexVoiceAudioDelta): number { return delta.audioData.byteLength / 2 / delta.sampleRateHz * 1_000; }
export function sanitizeTranscript(value: string): string {
  return value.replace(/\0/g, "").replace(/(authorization|api[_ -]?key|token)\s*[:=]\s*\S+/giu, "$1=[redacted]").replace(/\s+/g, " ").trim().slice(0, 20_000);
}
