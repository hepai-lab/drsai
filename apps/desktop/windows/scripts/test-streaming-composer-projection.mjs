import assert from "node:assert/strict";

const {
  commitStreamingComposerProjection,
  createStreamingComposerProjection,
  discardStreamingComposerProjection,
  getStreamingComposerProjectionView,
  rebaseStreamingComposerUserText,
  setStreamingComposerComposition,
  updateStreamingComposerTranscript,
} = await import("../../shared/renderer/src/voice/streaming/streamingComposerProjection.ts");

let state = createStreamingComposerProjection("请检查模块", { start: 3, end: 3 });
state = updateStreamingComposerTranscript(state, { stableVoiceText: "流式", provisionalVoiceText: "语音", revision: 1 });
assert.equal(getStreamingComposerProjectionView(state).text, "请检查流式 语音模块");
assert.equal(state.userText, "请检查模块", "projection must not mutate formal composer text");
assert.equal(commitStreamingComposerProjection(state), null, "provisional text must block commit");

state = updateStreamingComposerTranscript(state, { stableVoiceText: "流式语音", provisionalVoiceText: "", revision: 2 });
assert.deepEqual(commitStreamingComposerProjection(state), { value: "请检查流式语音模块", cursor: 7 });
assert.equal(updateStreamingComposerTranscript(state, { stableVoiceText: "旧", provisionalVoiceText: "", revision: 1 }), state);

let composing = setStreamingComposerComposition(state, true);
composing = updateStreamingComposerTranscript(composing, { stableVoiceText: "流式语音功能", provisionalVoiceText: "", revision: 3 });
assert.equal(getStreamingComposerProjectionView(composing).text, "请检查流式语音模块", "IME composition must freeze visible voice updates");
composing = setStreamingComposerComposition(composing, false);
assert.equal(getStreamingComposerProjectionView(composing).text, "请检查流式语音功能模块");

let rebased = createStreamingComposerProjection("world", { start: 0, end: 0 });
rebased = updateStreamingComposerTranscript(rebased, { stableVoiceText: "hello", provisionalVoiceText: "", revision: 1 });
rebased = rebaseStreamingComposerUserText(rebased, "beautiful world");
assert.equal(rebased.anchor.start, 10);
assert.equal(getStreamingComposerProjectionView(rebased).text, "beautiful hello world");
rebased = rebaseStreamingComposerUserText(rebased, "beautiful world!");
assert.equal(rebased.conflict, false);

let conflict = createStreamingComposerProjection("replace this", { start: 8, end: 12 });
conflict = rebaseStreamingComposerUserText(conflict, "replace edited");
assert.equal(conflict.conflict, true);
assert.equal(commitStreamingComposerProjection(conflict), null);
assert.deepEqual(discardStreamingComposerProjection(conflict), { value: "replace edited", cursor: 8 });

let seed = 17;
for (let index = 0; index < 10_000; index += 1) {
  seed = (seed * 48271) % 0x7fffffff;
  const prefix = "x".repeat(seed % 24);
  const suffix = "y".repeat((seed >>> 4) % 24);
  const userText = `${prefix}${suffix}`;
  const anchor = prefix.length;
  let randomState = createStreamingComposerProjection(userText, { start: anchor, end: anchor });
  randomState = updateStreamingComposerTranscript(randomState, { stableVoiceText: `语音${index}`, provisionalVoiceText: "", revision: index + 1 });
  const view = getStreamingComposerProjectionView(randomState);
  assert.equal(view.before, prefix);
  assert.equal(view.after, suffix);
  assert.equal(randomState.userText, userText);
  assert.equal(commitStreamingComposerProjection(randomState)?.value, `${prefix}语音${index}${suffix ? " " : ""}${suffix}`);
}

console.log("Streaming composer projection tests passed (layering, revision, IME freeze, rebase, conflict, commit/discard, and 10,000 randomized cases).");
