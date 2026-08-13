export type DuplexSpeechIntent = "none" | "acknowledgement" | "barge_in" | "correction" | "stop";
const ACK = /^(嗯+|唔+|对+|好的?|继续|ok(?:ay)?|yes|yeah|uh[ -]?huh|mm+h?m*)[。.!！]?$/iu;
const STOP = /^(停(?:止)?|别说了|不用说了|闭嘴|stop|quiet|shut up|cancel)[。.!！]?$/iu;
const CORRECTION = /^(?:(?:不对|不是|我说的是|纠正|更正)|(?:no[,，]? i (?:said|meant)|actually)[\s,，:：])/iu;

export function classifyDuplexSpeechIntent(transcript: string): DuplexSpeechIntent {
  const value = transcript.trim(); if (!value) return "none";
  if (STOP.test(value)) return "stop";
  if (ACK.test(value)) return "acknowledgement";
  if (CORRECTION.test(value)) return "correction";
  return "barge_in";
}

export function shouldCommitBargeIn(input: { intent: DuplexSpeechIntent; localSpeechMs: number; providerSpeechStarted: boolean; playbackActive: boolean }): boolean {
  if (!input.playbackActive || input.intent === "none" || input.intent === "acknowledgement") return false;
  if (input.intent === "stop") return true;
  return input.providerSpeechStarted && input.localSpeechMs >= 160 || input.localSpeechMs >= 320;
}

export interface DuplexSemanticExample { transcript: string; expected: DuplexSpeechIntent }
export function scoreDuplexSemanticGate(examples: DuplexSemanticExample[]): { accuracy: number; perIntent: Record<DuplexSpeechIntent, { total: number; correct: number; accuracy: number }>; passed: boolean } {
  const intents: DuplexSpeechIntent[] = ["none", "acknowledgement", "barge_in", "correction", "stop"];
  const counts = Object.fromEntries(intents.map((intent) => [intent, { total: 0, correct: 0, accuracy: 1 }])) as Record<DuplexSpeechIntent, { total: number; correct: number; accuracy: number }>;
  let correct = 0;
  for (const example of examples) { const predicted = classifyDuplexSpeechIntent(example.transcript); counts[example.expected].total += 1; if (predicted === example.expected) { correct += 1; counts[example.expected].correct += 1; } }
  for (const value of Object.values(counts)) value.accuracy = value.total ? value.correct / value.total : 1;
  const accuracy = examples.length ? correct / examples.length : 0;
  const gatedIntents: DuplexSpeechIntent[] = ["acknowledgement", "barge_in", "correction", "stop"];
  const passed = examples.length >= 20 && accuracy >= 0.9 && gatedIntents.every((intent) => counts[intent].total >= 3 && counts[intent].accuracy >= 0.9);
  return { accuracy, perIntent: counts, passed };
}
