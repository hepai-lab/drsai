import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseChatOutput } from "../renderer/src/chatOutputModel.ts";

const entryFile = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(import.meta.url);
const here = dirname(entryFile);
const renderer = resolve(here, "../renderer/src");
const messageContent = readFileSync(join(renderer, "components/ChatMessageContent.tsx"), "utf8");
const workspace = readFileSync(join(renderer, "components/ChatWorkspace.tsx"), "utf8");

const mixed = [
  "answer before\n",
  "<think>private reasoning\nwith two lines</think>",
  "answer after",
].join("");
assert.deepEqual(parseChatOutput(mixed), [
  { id: "text-0", type: "text", text: "answer before\n" },
  { id: "reasoning-1", type: "reasoning", text: "private reasoning\nwith two lines", complete: true },
  { id: "text-2", type: "text", text: "answer after" },
]);
assert.deepEqual(parseChatOutput("<think>still thinking", { streaming: true }), [
  { id: "reasoning-0", type: "reasoning", text: "still thinking", complete: false },
]);
assert.deepEqual(parseChatOutput("&lt;think&gt;hidden&lt;/think&gt;shown"), [
  { id: "reasoning-0", type: "reasoning", text: "hidden", complete: true },
  { id: "text-1", type: "text", text: "shown" },
]);

// A quadratic parser becomes visibly slow at this size. Keep the limit broad
// enough for shared CI runners; the contract is to stay comfortably linear.
const longContent = `${"paragraph text\n\n".repeat(8_000)}<think>${"reasoning ".repeat(8_000)}</think>end`;
const startedAt = performance.now();
const parsed = parseChatOutput(longContent);
const duration = performance.now() - startedAt;
assert.equal(parsed.length, 3);
assert.ok(duration < 500, `parseChatOutput took ${duration.toFixed(1)} ms for ${longContent.length} chars`);

assert.ok(
  workspace.includes('if (!hasStreamingMessage) {')
    && workspace.includes('scrollMessageListToLatest("auto")')
    && !workspace.includes('scrollMessageListToLatest("smooth");\n      if (finalScrollSettleTimerRef.current'),
  "Terminal follow-to-bottom must settle once without starting a smooth scroll.",
);
assert.ok(
  messageContent.includes('const timer = window.setTimeout(() => setFinalLayoutReady(true), 250);'),
  "Final Markdown layout must be deferred past the terminal commit.",
);
assert.ok(
  messageContent.includes('{open ? (') && messageContent.includes('<MarkdownContent content={text} streaming={!complete}'),
  "Collapsed reasoning must unmount its Markdown subtree.",
);
assert.ok(
  messageContent.includes('collapseTimerRef.current = window.setTimeout(() => {')
    && messageContent.includes('}, 150);'),
  "Reasoning collapse must be deferred after terminal layout.",
);

console.log(`Terminal rendering performance verified (${duration.toFixed(1)} ms parser benchmark).`);
