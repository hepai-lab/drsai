import type { DuplexProviderEvent } from "./providerAdapter";

export interface DuplexCapabilityProbeReport {
  schemaVersion: 1;
  providerId: string;
  modelId: string;
  status: "passed" | "failed" | "inconclusive";
  observed: {
    sessionReady: boolean;
    inputSpeech: boolean;
    inputTranscript: boolean;
    outputAudio: boolean;
    outputTranscript: boolean;
    responseCompleted: boolean;
    toolCall: boolean;
    providerError: boolean;
  };
  eventCount: number;
  errors: string[];
}

export class DuplexCapabilityProbe {
  readonly providerId: string;
  readonly modelId: string;
  #eventCount = 0;
  #errors: string[] = [];
  #observed = { sessionReady: false, inputSpeech: false, inputTranscript: false, outputAudio: false, outputTranscript: false, responseCompleted: false, toolCall: false, providerError: false };

  constructor(providerId: string, modelId: string) { this.providerId = providerId; this.modelId = modelId; }

  observe(events: readonly DuplexProviderEvent[]): void {
    for (const event of events) {
      this.#eventCount += 1;
      if (event.type === "session_ready") this.#observed.sessionReady = true;
      else if (event.type === "input_speech_started" || event.type === "input_speech_stopped") this.#observed.inputSpeech = true;
      else if (event.type === "input_transcript_delta" || event.type === "input_transcript_completed") this.#observed.inputTranscript = true;
      else if (event.type === "response_audio_delta" || event.type === "response_audio_completed") this.#observed.outputAudio = true;
      else if (event.type === "response_transcript_delta" || event.type === "response_transcript_completed") this.#observed.outputTranscript = true;
      else if (event.type === "response_completed") this.#observed.responseCompleted = true;
      else if (event.type === "tool_call") this.#observed.toolCall = true;
      else if (event.type === "provider_error") { this.#observed.providerError = true; this.#errors.push(event.error.code); }
    }
  }

  report(): DuplexCapabilityProbeReport {
    const required = this.#observed.sessionReady && this.#observed.inputSpeech && this.#observed.inputTranscript && this.#observed.outputAudio && this.#observed.outputTranscript && this.#observed.responseCompleted;
    return {
      schemaVersion: 1,
      providerId: this.providerId,
      modelId: this.modelId,
      status: this.#observed.providerError ? "failed" : required ? "passed" : "inconclusive",
      observed: { ...this.#observed },
      eventCount: this.#eventCount,
      errors: [...new Set(this.#errors)],
    };
  }
}
