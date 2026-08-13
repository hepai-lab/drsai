import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const sourcePath = join(process.cwd(), "../shared/renderer/src/chatOutputModel.ts");
const streamingMarkdownPath = join(process.cwd(), "../shared/renderer/src/streamingMarkdown.ts");
const displayBufferPath = join(process.cwd(), "../shared/renderer/src/streamingDisplayBuffer.ts");
const renderMetricsPath = join(process.cwd(), "../shared/renderer/src/streamingRenderMetrics.ts");
const smoothFollowPath = join(process.cwd(), "../shared/renderer/src/smoothFollowOutput.ts");
const streamingFadeSource = readFileSync(join(process.cwd(), "../shared/renderer/src/streamingTextFade.ts"), "utf8");
const source = readFileSync(sourcePath, "utf8");
const componentSource = readFileSync(join(process.cwd(), "../shared/renderer/src/components/ChatMessageContent.tsx"), "utf8");
const workspaceSource = readFileSync(join(process.cwd(), "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const model = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const streamingMarkdownCompiled = ts.transpileModule(readFileSync(streamingMarkdownPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const streamingMarkdown = await import(`data:text/javascript;base64,${Buffer.from(streamingMarkdownCompiled).toString("base64")}`);
async function importTranspiled(path) {
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/^import .*from "react";\r?\n/m, "");
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}
const displayBuffer = await importTranspiled(displayBufferPath);
const renderMetrics = await importTranspiled(renderMetricsPath);
const smoothFollow = await importTranspiled(smoothFollowPath);

assert.deepEqual(model.parseChatOutput("hello"), [
  { id: "text-0", type: "text", text: "hello" },
]);

const complete = model.parseChatOutput("<think>private **reasoning**</think>Final answer");
assert.equal(complete.length, 2);
assert.equal(complete[0].type, "reasoning");
assert.equal(complete[0].complete, true);
assert.equal(complete[1].text, "Final answer");
assert.equal(model.getVisibleChatText("<think>private</think>Final answer"), "Final answer");
assert.equal(
  model.getReasoningChatText("<think>first thought</think><think>second thought</think>"),
  "first thoughtsecond thought",
);

const streaming = model.parseChatOutput("prefix<think>still streaming");
assert.equal(streaming[0].type, "text");
assert.equal(streaming[1].type, "reasoning");
assert.equal(streaming[1].complete, false);

const escaped = model.parseChatOutput("&lt;think&gt;hidden&lt;/think&gt;shown");
assert.equal(escaped[0].type, "reasoning");
assert.equal(escaped[1].text, "shown");

const multiple = model.parseChatOutput("A<think>R1</think>B<think>R2</think>C");
assert.deepEqual(multiple.map((part) => part.type), ["text", "reasoning", "text", "reasoning", "text"]);
assert.equal(model.getVisibleChatText("A<think>R1</think>B<think>R2</think>C"), "ABC");

assert.equal(model.parseChatOutput("answer<thi", { streaming: true })[0].text, "answer");
assert.equal(model.parseChatOutput("answer&lt;thi", { streaming: true })[0].text, "answer");

const sequences = {};
assert.equal(model.acceptChatEventSequence(sequences, "request", 1), true);
assert.equal(model.acceptChatEventSequence(sequences, "request", 1), false);
assert.equal(model.acceptChatEventSequence(sequences, "request", 0), false);
assert.equal(model.acceptChatEventSequence(sequences, "request", 2), true);
for (let seq = 3; seq <= 10_000; seq += 1) {
  assert.equal(model.acceptChatEventSequence(sequences, "request", seq), true);
}
assert.equal(sequences.request, 10_000);

assert.deepEqual(streamingMarkdown.splitStreamingMarkdown("first paragraph\n\nsecond"), {
  stable: "first paragraph\n\n",
  tail: "second",
});
assert.deepEqual(streamingMarkdown.splitStreamingMarkdown("before\n\n```ts\nconst x = 1;\n\nstill code"), {
  stable: "before\n\n",
  tail: "```ts\nconst x = 1;\n\nstill code",
});
assert.deepEqual(streamingMarkdown.splitStreamingMarkdown("```ts\ncode\n```\n\nafter"), {
  stable: "```ts\ncode\n```\n\n",
  tail: "after",
});
assert.deepEqual(displayBuffer.splitGraphemes("A👨‍👩‍👧‍👦中"), ["A", "👨‍👩‍👧‍👦", "中"]);
assert.equal(displayBuffer.adaptiveGraphemeBudget(1), 1);
assert.equal(displayBuffer.adaptiveGraphemeBudget(10), 4);
assert.equal(displayBuffer.adaptiveGraphemeBudget(120), 40);
renderMetrics.resetStreamingRenderMetrics();
for (const value of [1, 2, 3, 4, 100]) renderMetrics.observeStreamingRenderMetric("markdown-render", value);
assert.deepEqual(renderMetrics.getStreamingRenderMetrics()["markdown-render"], { count: 5, p50Ms: 3, p95Ms: 100 });
const frames = [];
const scrollCalls = [];
const stoppedAt = [];
const controller = smoothFollow.createSmoothFollowOutputController({
  scrollToBottom: (behavior) => scrollCalls.push(behavior),
  stopScrolling: (scrollTop) => stoppedAt.push(scrollTop),
  requestFrame: (callback) => (frames.push(callback), frames.length),
  cancelFrame: () => {},
  getScrollBehavior: () => "smooth",
});
controller.handleHeightChange(100);
controller.handleHeightChange(120);
controller.handleHeightChange(140);
assert.equal(frames.length, 1, "Height growth must schedule at most one follow request per frame.");
frames.shift()(0);
assert.deepEqual(scrollCalls, ["smooth"]);
controller.handleScroll(10, 200);
assert.equal(controller.isFollowing(), true, "A native smooth-scroll event must not be mistaken for user scrolling.");
controller.handleUserScrollIntent(40);
assert.equal(controller.isFollowing(), false);
assert.deepEqual(stoppedAt, [40]);
controller.handleHeightChange(160);
assert.equal(frames.length, 0, "User-paused output must not schedule follow requests.");
controller.handleScroll(140, 140);
assert.equal(controller.isFollowing(), true);
assert.ok(streamingFadeSource.includes('child.tagName === "code" || child.tagName === "pre"'), "Code blocks must be excluded from streaming fade.");

const reasoningSection = componentSource.slice(
  componentSource.indexOf("function ReasoningPart"),
  componentSource.indexOf("export const ChatMessageContent"),
);
assert.ok(reasoningSection.includes('reasoning: "Reasoning"'));
assert.ok(reasoningSection.includes('thinking: "Thinking"'));
assert.ok(
  [...reasoningSection].every((character) => character.charCodeAt(0) < 128),
  "ReasoningPart labels must stay ASCII-only to avoid Windows console mojibake.",
);
assert.ok(
  workspaceSource.includes("content={getReasoningChatText(message.reasoningContent)}"),
  "Dedicated reasoning events must not create a nested Think renderer.",
);
assert.ok(componentSource.includes("splitStreamingMarkdown(displayedContent)"), "Streaming Markdown must isolate its active tail.");
assert.ok(componentSource.includes("useStreamingDisplayBuffer(content, streaming)"), "Streaming output must use the adaptive display buffer.");
assert.ok(componentSource.includes('observeStreamingRenderMetric("markdown-render"'), "Markdown render duration must be sampled.");
assert.ok(workspaceSource.includes('new IntersectionObserver'), "Long conversations must retain viewport virtualization.");
assert.ok(workspaceSource.includes('new ResizeObserver'), "Virtual messages must retain dynamic-height measurement.");

console.log("Chat output model verification passed.");
