import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const sourcePath = join(process.cwd(), "../shared/renderer/src/chatOutputModel.ts");
const source = readFileSync(sourcePath, "utf8");
const componentSource = readFileSync(join(process.cwd(), "../shared/renderer/src/components/ChatMessageContent.tsx"), "utf8");
const workspaceSource = readFileSync(join(process.cwd(), "../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const model = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

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

console.log("Chat output model verification passed.");
