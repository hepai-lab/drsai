import assert from "node:assert/strict";
import { getAssistantSpeechText } from "../../shared/renderer/src/voice/voiceMessageText.ts";

assert.equal(getAssistantSpeechText({ content: "Final answer" }), "Final answer");
assert.equal(getAssistantSpeechText({
  content: "Private reasoning\n\nFinal answer",
  reasoningContent: "Private reasoning",
}), "Final answer");
assert.equal(getAssistantSpeechText({
  content: "ignored aggregate",
  structuredTurn: {
    turnId: "turn-1",
    status: "completed",
    parts: [
      { kind: "progress", id: "progress-1", label: "Searching private source", status: "completed" },
      { kind: "markdown", id: "markdown-1", markdown: "Visible final answer" },
      { kind: "citation", id: "citation-1", label: "Source", url: "https://example.com" },
      { kind: "markdown", id: "markdown-2", markdown: "Second visible paragraph" },
    ],
  },
}), "Visible final answer\n\nSecond visible paragraph");

console.log("Voice assistant message text tests passed (plain, reasoning, and structured final-answer filtering).");
