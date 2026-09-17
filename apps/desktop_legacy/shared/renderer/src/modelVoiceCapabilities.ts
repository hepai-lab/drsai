import type { MyDrSaiModelCapability, MyDrSaiModelModality } from "@shared/desktopApi";

export interface KnownVoiceModelCapabilities {
  inputModalities: MyDrSaiModelModality[];
  outputModalities: MyDrSaiModelModality[];
  capabilities: MyDrSaiModelCapability[];
  kind: "realtime" | "speech_to_text" | "text_to_speech";
}

function leafModelId(modelId: string): string {
  return modelId.trim().toLowerCase().split("/").at(-1) ?? "";
}

/**
 * Supplies conservative defaults for well-known voice model families when a
 * Provider discovery response contains IDs but omits capability metadata.
 * Explicit metadata remains editable in Settings; these defaults prevent a
 * newly discovered Realtime model from silently becoming text-only.
 */
export function knownVoiceModelCapabilities(modelId: string): KnownVoiceModelCapabilities | null {
  const id = leafModelId(modelId);
  if (id.startsWith("gpt-realtime")) {
    return {
      inputModalities: ["text", "audio"],
      outputModalities: ["text", "audio"],
      capabilities: ["chat", "tool_calling"],
      kind: "realtime",
    };
  }
  if (id === "whisper-1") {
    return {
      inputModalities: ["audio"],
      outputModalities: ["text"],
      capabilities: ["speech_to_text"],
      kind: "speech_to_text",
    };
  }
  if (id === "tts-1") {
    return {
      inputModalities: ["text"],
      outputModalities: ["audio"],
      capabilities: ["text_to_speech"],
      kind: "text_to_speech",
    };
  }
  return null;
}

export function mergeKnownVoiceModalities(
  modelId: string,
  input: readonly MyDrSaiModelModality[],
  output: readonly MyDrSaiModelModality[],
): { input: MyDrSaiModelModality[]; output: MyDrSaiModelModality[] } {
  const known = knownVoiceModelCapabilities(modelId);
  if (!known) return { input: [...input], output: [...output] };
  return {
    input: [...new Set([...input, ...known.inputModalities])],
    output: [...new Set([...output, ...known.outputModalities])],
  };
}
