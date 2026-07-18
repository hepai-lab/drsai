import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

const root = process.cwd();
const sharedSource = readFileSync(join(root, "src/shared/structuredConversation.ts"), "utf8");
const markdownSource = readFileSync(join(root, "src/renderer/src/components/ChatMessageContent.tsx"), "utf8");
const structuredRendererSource = readFileSync(join(root, "src/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
const workspaceSource = readFileSync(join(root, "src/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const adapterSource = readFileSync(join(root, "src/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
const debugStoreSource = readFileSync(join(root, "src/renderer/src/debugLogStore.ts"), "utf8");
const threadStoreSource = readFileSync(join(root, "src/main/threads.ts"), "utf8");
const styles = readFileSync(join(root, "src/renderer/src/styles.css"), "utf8");

assert.equal(markdownSource.includes("rehypeRaw"), false, "Raw HTML rendering must stay disabled.");
assert.equal(markdownSource.includes("dangerouslySetInnerHTML"), false, "Conversation content must not inject HTML.");
assert.ok(markdownSource.includes('protocol === "https:" || protocol === "http:"'));
assert.ok(markdownSource.includes("data:image\\/(?:png|jpeg|gif|webp);base64"));
assert.ok(markdownSource.includes('loading="lazy"') && markdownSource.includes('referrerPolicy="no-referrer"'));
assert.ok(workspaceSource.includes("isSafeWebUrl(part.url)"));

assert.ok(threadStoreSource.includes("const MAX_SNAPSHOT_MESSAGES = 500"));
assert.ok(threadStoreSource.includes("const MAX_MESSAGE_CHARS = 200_000"));
assert.ok(threadStoreSource.includes("const MAX_STATUS_CHARS = 80_000"));
assert.ok(sharedSource.includes("serialized.length <= 80_000"));
assert.ok(debugStoreSource.includes("const MAX_RAW_LENGTH = 256 * 1024"));

assert.ok(adapterSource.includes("pendingStructuredEventsByRequest"));
assert.ok(adapterSource.includes("window.setTimeout(flushStructuredEventDeltas, 16)"));
assert.ok(styles.includes("content-visibility:auto") && styles.includes("contain-intrinsic-block-size:auto 160px"));

assert.ok(structuredRendererSource.includes("<details") && structuredRendererSource.includes("<summary>"));
assert.ok(structuredRendererSource.includes('aria-label={`${language === "zh" ? "定位引用"'));
assert.ok(structuredRendererSource.includes("structured-citation-back"));
assert.ok(styles.includes(".structured-message-parts button:focus-visible"));
assert.ok(styles.includes(".debug-panel summary:focus-visible"));

const compiled = ts.transpileModule(sharedSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
}).outputText;
const module = { exports: {} };
new Script(compiled, { filename: "structuredConversation.ts" }).runInNewContext({
  exports: module.exports,
  module,
  require: () => { throw new Error("shared structured state must not require runtime dependencies"); },
});
const { applyStructuredConversationEvent, createStructuredTurnState } = module.exports;
const identity = {
  version: 2,
  turnId: "performance-turn",
  timestamp: "2026-07-17T00:00:00.000Z",
  source: "quality-test",
};
let state = createStructuredTurnState(identity.turnId);
state = applyStructuredConversationEvent(state, { ...identity, type: "turn.started", sequence: 1, dedupeKey: "start" });
state = applyStructuredConversationEvent(state, {
  ...identity,
  type: "part.started",
  sequence: 2,
  dedupeKey: "part",
  part: { id: "answer", kind: "markdown", status: "running", markdown: "" },
});
const startedAt = Date.now();
for (let index = 0; index < 10_000; index += 1) {
  state = applyStructuredConversationEvent(state, {
    ...identity,
    type: "part.delta",
    sequence: index + 3,
    dedupeKey: `delta:${index}`,
    partId: "answer",
    delta: { kind: "markdown.append", text: "x" },
  });
}
const elapsedMs = Date.now() - startedAt;
assert.equal(state.parts[0].markdown.length, 10_000);
assert.equal(state.seenDedupeKeys.length, 500, "Reducer dedupe memory must stay bounded.");
assert.ok(elapsedMs < 5_000, `10,000 deltas took ${elapsedMs} ms; expected under 5,000 ms.`);

console.log(`Structured quality verification passed (security, bounds, accessibility, 10k deltas in ${elapsedMs} ms).`);
