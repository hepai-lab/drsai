import type { DesktopThreadMessageSnapshot, DesktopThreadSnapshot } from "../../../../api/desktopApi";
import { sanitizeTranscript } from "./transcriptProjection";

export interface DuplexSessionContext { instructions?: string; includedMessages: number; truncated: boolean }
export function buildDuplexSessionContext(baseInstructions: string | undefined, snapshot: DesktopThreadSnapshot | null, maxChars = 8_000, maxMessages = 12): DuplexSessionContext {
  const base = sanitizeTranscript(baseInstructions ?? "").slice(0, 20_000); const candidates = (snapshot?.messages ?? []).filter((message) => message.role === "user" || message.role === "assistant").slice(-maxMessages);
  const lines = candidates.flatMap((message) => { const content = trustedContextContent(message); return content ? [`${message.role === "user" ? "User" : "Assistant"}: ${content}`] : []; });
  let context = lines.join("\n"); const truncated = context.length > maxChars; if (truncated) context = context.slice(-maxChars);
  const continuity = context ? `Stable conversation context (do not repeat hidden or unheard content):\n${context}` : ""; const instructions = [base, continuity].filter(Boolean).join("\n\n").slice(0, 30_000);
  return { ...(instructions ? { instructions } : {}), includedMessages: lines.length, truncated };
}
export function trustedContextContent(message: DesktopThreadMessageSnapshot): string { if (message.role === "assistant" && message.voice?.interruptedAt !== undefined) return message.voice.alignmentConfidence === "word_timing" ? sanitizeTranscript(message.voice.heardContent ?? "") : ""; return sanitizeTranscript(message.content); }
export function interruptedVoiceStatus(voice: DesktopThreadMessageSnapshot["voice"]): string | undefined { if (!voice?.interruptedAt) return undefined; if (voice.alignmentConfidence === "word_timing" && voice.heardContent) return `Playback was interrupted. Heard: ${voice.heardContent}`; return `Playback was interrupted after ${Math.round(voice.playedAudioMs ?? 0)} ms; exact heard text is unavailable.`; }
