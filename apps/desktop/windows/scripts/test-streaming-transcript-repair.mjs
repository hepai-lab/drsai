import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const bundlePath = join(tmpdir(), `opendrsai-streaming-repair-${process.pid}-${Date.now()}.mjs`);
await build({
  entryPoints: [new URL("../../shared/renderer/src/voice/streaming/contextualTranscriptRepair.ts", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))],
  outfile: bundlePath,
  bundle: true,
  format: "esm",
  platform: "node",
});
const {
  acceptTranscriptRepair,
  buildContextualTranscriptRepair,
  createTranscriptRepairState,
  proposeTranscriptRepair,
  rejectTranscriptRepair,
  undoTranscriptRepair,
} = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
const { evaluateTranscriptRepairPolicy } = await import("../../shared/renderer/src/voice/streaming/transcriptRepairPolicy.ts");

const safe = evaluateTranscriptRepairPolicy({ originalText: "检查留是语音模块", suggestedText: "检查流式语音模块", confidence: 0.99 });
assert.deepEqual(safe, { autoAccept: true, risk: "none", reasons: [] });

for (const testCase of [
  { originalText: "金额是 100 元", suggestedText: "金额是 1000 元", risk: "sensitive_value" },
  { originalText: "不要删除文件", suggestedText: "删除文件", risk: "meaning_change" },
  { originalText: "运行 `git reset --hard`", suggestedText: "运行 git reset --hard", risk: "command_or_code" },
  { originalText: "打开 C:\\safe\\a.txt", suggestedText: "打开 C:\\safe\\b.txt", risk: "sensitive_value" },
]) {
  const result = evaluateTranscriptRepairPolicy({ ...testCase, confidence: 1 });
  assert.equal(result.autoAccept, false);
  assert.equal(result.risk, testCase.risk);
}
assert.equal(evaluateTranscriptRepairPolicy({ originalText: "流是", suggestedText: "流式", confidence: 0.8 }).autoAccept, false);

const contextualCandidate = buildContextualTranscriptRepair({
  transcript: "检查留是语音和 open dr sai",
  revision: 4,
  glossary: [
    { canonical: "流式语音", aliases: ["留是语音"], source: { type: "workspace_term", label: "Voice architecture" } },
    { canonical: "OpenDrSai", aliases: ["open dr sai"], source: { type: "user_dictionary", label: "Product names" } },
  ],
});
assert.equal(contextualCandidate?.suggestedText, "检查流式语音和 OpenDrSai");
assert.equal(contextualCandidate?.confidence, 0.97);
assert.equal(contextualCandidate?.sources.length, 2);
assert.equal(buildContextualTranscriptRepair({ transcript: "无需修复", revision: 1, glossary: [] }), null);

let state = createTranscriptRepairState("检查留是语音模块");
state = proposeTranscriptRepair(state, {
  id: "candidate-1",
  revision: 1,
  originalText: state.originalText,
  suggestedText: "检查流式语音模块",
  confidence: 0.99,
  sources: [{ type: "workspace_term", label: "Streaming Voice" }],
});
assert.equal(state.status, "accepted");
assert.equal(state.acceptedText, "检查流式语音模块");
assert.equal(undoTranscriptRepair(state).acceptedText, "检查留是语音模块");

let risky = createTranscriptRepairState("不要删除 10 个文件");
risky = proposeTranscriptRepair(risky, {
  id: "candidate-2",
  revision: 1,
  originalText: risky.originalText,
  suggestedText: "删除 100 个文件",
  confidence: 0.999,
  sources: [{ type: "conversation_summary" }],
});
assert.equal(risky.status, "review");
assert.equal(risky.acceptedText, risky.originalText);
assert.equal(acceptTranscriptRepair(risky).acceptedText, "删除 100 个文件");
assert.equal(rejectTranscriptRepair(risky).acceptedText, risky.originalText);
assert.equal(undoTranscriptRepair(acceptTranscriptRepair(risky)).acceptedText, risky.originalText);

const stale = proposeTranscriptRepair(risky, {
  id: "stale",
  revision: 0,
  originalText: risky.originalText,
  suggestedText: "stale",
  confidence: 1,
  sources: [{ type: "later_speech" }],
});
assert.equal(stale, risky);

console.log("Streaming transcript repair tests passed (safe correction, protected semantics, confidence, source metadata, stale revision, accept/reject, and byte-exact undo).");
rmSync(bundlePath, { force: true });
