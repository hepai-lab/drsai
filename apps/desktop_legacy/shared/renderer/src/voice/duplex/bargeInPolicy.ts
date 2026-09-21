import { isFastStopPrefix } from "./bargeInCandidate";

export type DuplexSpeechIntent = "none" | "acknowledgement" | "stop" | "correction" | "addendum" | "new_question";
const ACK = /^(?:嗯|嗯哼|哦|噢|对|对的|好的?|行|可以|继续|明白|知道了|ok(?:ay)?|yes|yeah|yep|right|go on|continue|uh[ -]?huh|mm+h?m*)[\s,.!?，。！？]*$/iu;
const CORRECTION = /^(?:(?:不对|不是|我说的是|我的意思是|纠正|更正|应该是)|(?:no[,，]?\s*i (?:said|meant)|actually[,，]?|correction[:：]?))\s*/iu;
const ADDENDUM = /^(?:(?:我还想|我再|再|另外|还有|补充|顺便|对了)(?:补充|加|说|问|一点|一个)?|(?:also|and also|one more thing|i(?:'d| would) like to add|by the way))/iu;
const QUESTION = /(?:[?？]\s*$)|^(?:为什么|怎么|如何|什么|谁|哪里|哪一个|能不能|可以吗|请问|what|why|how|who|where|when|which|can you|could you|would you)/iu;

export function classifyDuplexSpeechIntent(transcript: string): DuplexSpeechIntent {
  const value = normalize(transcript); if (!value) return "none";
  if (isFastStopPrefix(value)) return "stop";
  if (ACK.test(value)) return "acknowledgement";
  if (CORRECTION.test(value)) return "correction";
  if (ADDENDUM.test(value)) return "addendum";
  if (QUESTION.test(value)) return "new_question";
  return "new_question";
}

export function shouldCommitBargeIn(input: { intent: DuplexSpeechIntent; localSpeechMs: number; providerSpeechStarted: boolean; playbackActive: boolean; candidateConfidence?: number }): boolean {
  if (!input.playbackActive || input.intent === "none" || input.intent === "acknowledgement") return false;
  if (input.intent === "stop") return true;
  const confidence = input.candidateConfidence ?? (input.providerSpeechStarted ? 0.75 : 0.5);
  if (input.intent === "correction") return confidence >= 0.55 && (input.providerSpeechStarted && input.localSpeechMs >= 120 || input.localSpeechMs >= 240);
  if (input.intent === "addendum") return confidence >= 0.6 && (input.providerSpeechStarted && input.localSpeechMs >= 180 || input.localSpeechMs >= 320);
  return confidence >= 0.65 && (input.providerSpeechStarted && input.localSpeechMs >= 200 || input.localSpeechMs >= 360);
}

export interface DuplexSemanticExample { transcript: string; expected: DuplexSpeechIntent }
export function scoreDuplexSemanticGate(examples: DuplexSemanticExample[]): { accuracy: number; perIntent: Record<DuplexSpeechIntent, { total: number; correct: number; accuracy: number }>; passed: boolean } {
  const intents: DuplexSpeechIntent[] = ["none", "acknowledgement", "stop", "correction", "addendum", "new_question"];
  const counts = Object.fromEntries(intents.map((intent) => [intent, { total: 0, correct: 0, accuracy: 1 }])) as Record<DuplexSpeechIntent, { total: number; correct: number; accuracy: number }>;
  let correct = 0;
  for (const example of examples) { const predicted = classifyDuplexSpeechIntent(example.transcript); counts[example.expected].total += 1; if (predicted === example.expected) { correct += 1; counts[example.expected].correct += 1; } }
  for (const value of Object.values(counts)) value.accuracy = value.total ? value.correct / value.total : 1;
  const accuracy = examples.length ? correct / examples.length : 0; const gated = intents.filter((intent) => intent !== "none");
  return { accuracy, perIntent: counts, passed: examples.length >= 30 && accuracy >= 0.9 && gated.every((intent) => counts[intent].total >= 4 && counts[intent].accuracy >= 0.85) };
}

function normalize(value: string): string { return value.normalize("NFKC").trim().toLocaleLowerCase(); }
