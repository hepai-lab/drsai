import type { StructuredTurnState } from "@shared/structuredConversation";

interface Projection { chunks: string[]; text: string }
const cache = new WeakMap<StructuredTurnState, { markdown: Projection; reasoning: Projection }>();

function project(chunks: string[], separator: string, previous?: Projection): Projection {
  if (previous && chunks.length === previous.chunks.length) {
    let index = 0;
    while (index < chunks.length && chunks[index] === previous.chunks[index]) index += 1;
    if (index === chunks.length) return previous;
    // Only the last selected segment may be appended; replacement, insertion,
    // final-answer changes and edits of earlier parts use the canonical join.
    if (index === chunks.length - 1 && chunks[index].startsWith(previous.chunks[index])) {
      return { chunks, text: previous.text + chunks[index].slice(previous.chunks[index].length) };
    }
  }
  return { chunks, text: chunks.join(separator) };
}

/** Weak keys avoid retaining departed sessions. Reducer state remains immutable. */
export function projectStructuredText(state: StructuredTurnState, previous?: StructuredTurnState): { content: string; reasoningContent: string } {
  let value = cache.get(state);
  if (!value) {
    const prior = previous?.turnId === state.turnId ? cache.get(previous) : undefined;
    const markdown: string[] = [];
    const reasoning: string[] = [];
    for (const part of state.parts) {
      if (part.kind === "markdown" && (part.channel ?? "answer") === "answer" && part.final === true) markdown.push(part.markdown);
      if (part.kind === "reasoning") for (const segment of part.segments) reasoning.push(segment.text);
    }
    value = { markdown: project(markdown, "\n\n", prior?.markdown), reasoning: project(reasoning, "", prior?.reasoning) };
    cache.set(state, value);
  }
  return { content: value.markdown.text, reasoningContent: value.reasoning.text };
}
