export type TranscriptRepairRisk = "none" | "meaning_change" | "sensitive_value" | "command_or_code";

export interface TranscriptRepairPolicyResult {
  autoAccept: boolean;
  risk: TranscriptRepairRisk;
  reasons: string[];
}

export interface TranscriptRepairPolicyInput {
  originalText: string;
  suggestedText: string;
  confidence: number;
  minimumAutoAcceptConfidence?: number;
}

export function evaluateTranscriptRepairPolicy(input: TranscriptRepairPolicyInput): TranscriptRepairPolicyResult {
  const reasons: string[] = [];
  const threshold = input.minimumAutoAcceptConfidence ?? 0.96;
  const originalProtected = protectedSemanticTokens(input.originalText);
  const suggestedProtected = protectedSemanticTokens(input.suggestedText);
  const commandOrCode = looksLikeCommandOrCode(input.originalText) || looksLikeCommandOrCode(input.suggestedText);
  const sensitiveChanged = !sameTokens(originalProtected.sensitive, suggestedProtected.sensitive);
  const meaningChanged = !sameTokens(originalProtected.meaning, suggestedProtected.meaning);

  if (input.confidence < threshold) reasons.push("confidence_below_threshold");
  if (sensitiveChanged) reasons.push("sensitive_value_changed");
  if (meaningChanged) reasons.push("meaning_token_changed");
  if (commandOrCode) reasons.push("command_or_code_requires_review");
  const risk: TranscriptRepairRisk = commandOrCode
    ? "command_or_code"
    : sensitiveChanged
      ? "sensitive_value"
      : meaningChanged
        ? "meaning_change"
        : "none";
  return { autoAccept: reasons.length === 0, risk, reasons };
}

function protectedSemanticTokens(text: string): { sensitive: string[]; meaning: string[] } {
  const normalized = text.normalize("NFKC").toLocaleLowerCase();
  const sensitive = normalized.match(/(?:\b\d+(?:[.,:]\d+)*\b|[$¥￥€£]\s*\d+(?:[.,]\d+)*|(?:[a-z]:\\|\/)[^\s]+|https?:\/\/[^\s]+)/giu) ?? [];
  const chineseMeaning = normalized.match(/不|没|无|勿|禁止|不要|不能|可以|必须/gu) ?? [];
  const englishMeaning = normalized.match(/\b(?:not|no|never|don't|do not|must|may)\b/giu) ?? [];
  const meaning = [...chineseMeaning, ...englishMeaning];
  return { sensitive: sensitive.sort(), meaning: meaning.sort() };
}

function looksLikeCommandOrCode(text: string): boolean {
  return /```|`[^`]+`|(?:^|\n)\s*(?:[$>#]|npm\s|pnpm\s|git\s|python\s|powershell\s|cmd\s|rm\s|del\s)/iu.test(text);
}

function sameTokens(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}
