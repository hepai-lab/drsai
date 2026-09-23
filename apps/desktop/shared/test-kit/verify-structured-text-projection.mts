import assert from "node:assert/strict";
import { projectStructuredText } from "../renderer/src/structuredTextProjection";
import type { StructuredTurnState } from "../api/structuredConversation";

function state(texts: string[], reasoning: string[] = [], final = true, turnId = "t"): StructuredTurnState {
  return { turnId, parts: [...texts.map((markdown, i) => ({ id: `m${i}`, kind: "markdown", markdown, final, channel: "answer" })), { id: "r", kind: "reasoning", segments: reasoning.map(text => ({ text })) }] } as StructuredTurnState;
}
let previous = state(["first", "tail"], ["think"]);
projectStructuredText(previous);
for (const next of [state(["first", "tail++"], ["thinking"]), state(["edited", "tail++"], ["replacement"]), state(["a", "b", "c"], ["one", "two"]), state(["hidden"], [], false), state(["new turn"], [], true, "other")]) {
  const projected = projectStructuredText(next, previous);
  const markdown = next.parts.filter(p => p.kind === "markdown" && p.final && p.channel === "answer").map(p => p.kind === "markdown" ? p.markdown : "").join("\n\n");
  const reasoning = next.parts.flatMap(p => p.kind === "reasoning" ? p.segments.map(s => s.text) : []).join("");
  assert.deepEqual(projected, { content: markdown, reasoningContent: reasoning });
  assert.deepEqual(projectStructuredText(next), projected);
  previous = next;
}
for (let i = 0; i < 1000; i++) {
  const next = state(["x".repeat(i)], ["y".repeat(i)]);
  assert.deepEqual(projectStructuredText(next, previous), { content: "x".repeat(i), reasoningContent: "y".repeat(i) });
  previous = next;
}
console.log("STRUCTURED_TEXT_PROJECTION_OK");
