export function prepareTextForSpeech(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function selectSpeechVoice(
  voices: SpeechSynthesisVoice[],
  language: "zh" | "en",
  preferredName = "",
): SpeechSynthesisVoice | null {
  const prefix = language === "zh" ? "zh" : "en";
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
  return matching.find((voice) => voice.name === preferredName)
    ?? matching.find((voice) => voice.localService && voice.default)
    ?? matching.find((voice) => voice.localService)
    ?? matching.find((voice) => voice.default)
    ?? matching[0]
    ?? null;
}
