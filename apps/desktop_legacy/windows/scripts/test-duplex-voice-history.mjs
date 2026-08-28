import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const home = await mkdtemp(join(tmpdir(), "opendrsai-duplex-history-")); process.env.DRSAI_HOME = home;
try {
  const { appendDuplexVoiceHistory, createThread, deleteThread, getThreadSnapshot } = await import("../../shared/main/threads.ts");
  const user = { id: "duplex:s1:user:u1", role: "user", content: "你好", revision: 1, expectedRevision: 0, voice: { revision: 1 } };
  const assistant = { id: "duplex:s1:assistant:a1", role: "assistant", content: "你好，有什么可以帮你？", revision: 1, expectedRevision: 0, voice: { revision: 1 } };
  const first = await appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [user] }); assert.equal(first.messages.length, 1);
  const second = await appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [assistant] }); assert.equal(second.messages.length, 2, "each stable revision appends independently");
  const replay = await appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [assistant] }); assert.equal(replay.messages.length, 2, "same revision retry is idempotent");
  await assert.rejects(() => appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [{ ...assistant, content: "different payload" }] }), /revision conflict/i, "same revision cannot overwrite different content");
  const interrupted = { ...assistant, revision: 2, expectedRevision: 1, voice: { revision: 2, generatedAudioMs: 1000, playedAudioMs: 500, interruptedAt: 123, alignmentConfidence: "none" } };
  const updated = await appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [interrupted] }); assert.equal(updated.messages[1].voice.revision, 2); assert.equal(updated.messages[1].voice.heardContent, undefined);
  const toolEvent = { id: "call-1", kind: "tool_call", title: "search_thread_messages", status: "running", content: '{"query":"voice"}', toolName: "search_thread_messages", timestamp: "2026-08-14T00:00:00.000Z" };
  const tool = { id: "duplex:s1:assistant:tool:call-1", role: "assistant", content: "", revision: 1, expectedRevision: 0, statusContent: "Tool is running.", toolTimeline: [toolEvent], parts: [{ id: "tool:call-1", type: "tool", event: toolEvent, status: "running" }] };
  const toolSnapshot = await appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [tool] }); const persistedTool = toolSnapshot.messages.find((message) => message.id === tool.id); assert.equal(persistedTool.parts[0].type, "tool"); assert.equal(persistedTool.toolTimeline[0].toolName, "search_thread_messages");
  const completedEvent = { ...toolEvent, status: "completed", content: "Tool result returned to Realtime." }; const completedTool = { ...tool, revision: 2, expectedRevision: 1, statusContent: completedEvent.content, toolTimeline: [completedEvent], parts: [{ id: "tool:call-1", type: "tool", event: completedEvent, status: "completed" }] };
  const completedSnapshot = await appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [completedTool] }); assert.equal(completedSnapshot.messages.find((message) => message.id === tool.id).parts[0].status, "completed");
  await assert.rejects(() => appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [{ ...interrupted, revision: 4, expectedRevision: 3 }] }), /revision conflict/i);
  const recovered = await getThreadSnapshot("thread-voice-1"); assert.deepEqual(recovered.messages.map((message) => message.voice?.revision), [1, 2, 2]); assert.equal(recovered.messages[2].parts[0].event.status, "completed");
  await assert.rejects(() => appendDuplexVoiceHistory({ threadId: "../escape", messages: [] }), /invalid/i);
  await assert.rejects(() => appendDuplexVoiceHistory({ threadId: "thread-voice-1", messages: [{ id: "unsafe", role: "user", content: "x", revision: 1, expectedRevision: 0 }] }), /invalid/i);
  const disposable = await createThread({ kind: "chat", title: "Disposable voice" }); const canary = "VOICE-DELETION-CANARY"; await appendDuplexVoiceHistory({ threadId: disposable.id, messages: [{ id: `duplex:s2:user:delete`, role: "user", content: canary, revision: 1, expectedRevision: 0, voice: { revision: 1 } }] }); assert.equal(await deleteThread(disposable.id), true); assert.equal(await getThreadSnapshot(disposable.id), null); const files = await readdir(home, { recursive: true, withFileTypes: true }); const remaining = await Promise.all(files.filter((entry) => entry.isFile()).map((entry) => readFile(join(entry.parentPath, entry.name), "utf8").catch(() => ""))); assert.equal(remaining.some((value) => value.includes(canary)), false, "thread deletion removes voice text and metadata without a sidecar journal");
  console.log("Duplex Voice history verified (per-revision append, CAS conflict, idempotent retry, crash reload, voice evidence, and validation).");
} finally { await rm(home, { recursive: true, force: true }); }
