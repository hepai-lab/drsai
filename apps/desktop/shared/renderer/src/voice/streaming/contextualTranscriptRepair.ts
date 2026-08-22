import { evaluateTranscriptRepairPolicy, type TranscriptRepairPolicyResult } from "./transcriptRepairPolicy";

export interface TranscriptRepairSource {
  type: "later_speech" | "conversation_summary" | "user_dictionary" | "workspace_term";
  label?: string;
}

export interface TranscriptRepairCandidate {
  id: string;
  revision: number;
  originalText: string;
  suggestedText: string;
  confidence: number;
  sources: TranscriptRepairSource[];
  policy: TranscriptRepairPolicyResult;
}

export interface TranscriptRepairState {
  originalText: string;
  acceptedText: string;
  candidate: TranscriptRepairCandidate | null;
  status: "idle" | "repairing" | "review" | "accepted" | "rejected";
}

export interface TranscriptRepairGlossaryEntry {
  canonical: string;
  aliases: string[];
  source: TranscriptRepairSource;
  confidence?: number;
}

export function buildContextualTranscriptRepair(input: {
  transcript: string;
  revision: number;
  glossary: TranscriptRepairGlossaryEntry[];
}): Omit<TranscriptRepairCandidate, "policy"> | null {
  let suggestedText = input.transcript;
  const sources: TranscriptRepairSource[] = [];
  let confidence = 1;
  for (const entry of input.glossary) {
    const canonical = entry.canonical.trim();
    if (!canonical) continue;
    for (const aliasValue of entry.aliases) {
      const alias = aliasValue.trim();
      if (!alias || alias.toLocaleLowerCase() === canonical.toLocaleLowerCase()) continue;
      const replacement = replaceContextTerm(suggestedText, alias, canonical);
      if (replacement === suggestedText) continue;
      suggestedText = replacement;
      confidence = Math.min(confidence, entry.confidence ?? defaultSourceConfidence(entry.source.type));
      if (!sources.some(({ type, label }) => type === entry.source.type && label === entry.source.label)) sources.push(entry.source);
    }
  }
  if (suggestedText === input.transcript) return null;
  return {
    id: `repair-${Math.max(0, Math.trunc(input.revision))}`,
    revision: Math.max(0, Math.trunc(input.revision)),
    originalText: input.transcript,
    suggestedText,
    confidence,
    sources,
  };
}

export function createTranscriptRepairState(originalText: string): TranscriptRepairState {
  return { originalText, acceptedText: originalText, candidate: null, status: "idle" };
}

export function proposeTranscriptRepair(
  state: TranscriptRepairState,
  candidate: Omit<TranscriptRepairCandidate, "policy">,
): TranscriptRepairState {
  if (candidate.originalText !== state.originalText || candidate.revision < (state.candidate?.revision ?? -1)) return state;
  const policy = evaluateTranscriptRepairPolicy(candidate);
  return {
    ...state,
    candidate: { ...candidate, policy },
    acceptedText: policy.autoAccept ? candidate.suggestedText : state.originalText,
    status: policy.autoAccept ? "accepted" : "review",
  };
}

export function acceptTranscriptRepair(state: TranscriptRepairState): TranscriptRepairState {
  if (!state.candidate) return state;
  return { ...state, acceptedText: state.candidate.suggestedText, status: "accepted" };
}

export function rejectTranscriptRepair(state: TranscriptRepairState): TranscriptRepairState {
  if (!state.candidate) return state;
  return { ...state, acceptedText: state.originalText, status: "rejected" };
}

export function undoTranscriptRepair(state: TranscriptRepairState): TranscriptRepairState {
  return { ...state, acceptedText: state.originalText, status: state.candidate ? "review" : "idle" };
}

function replaceContextTerm(text: string, alias: string, canonical: string): string {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const asciiWord = /^[a-z0-9_-]+$/iu.test(alias);
  return text.replace(new RegExp(asciiWord ? `\\b${escaped}\\b` : escaped, "giu"), canonical);
}

function defaultSourceConfidence(type: TranscriptRepairSource["type"]): number {
  if (type === "user_dictionary") return 0.99;
  if (type === "later_speech") return 0.98;
  if (type === "workspace_term") return 0.97;
  return 0.94;
}
