import assert from "node:assert/strict";
const { BrowserStreamingAudioAdapter } = await import("../../shared/renderer/src/voice/streaming/browserStreamingAudioAdapter.ts");
const audios = [];
const revoked = [];
const adapter = new BrowserStreamingAudioAdapter({
  createUrl: (blob) => { assert.equal(blob.type, "audio/wav"); return `blob:${blob.size}`; },
  revokeUrl: (url) => revoked.push(url),
  createAudio: (url) => { const audio = { url, currentTime: 4, preload: "", onended: null, onerror: null, pauses: 0, plays: 0, loads: 0, load() { this.loads += 1; }, pause() { this.pauses += 1; }, async play() { this.plays += 1; } }; audios.push(audio); return audio; },
});
let ended = 0; let errors = 0;
const segment = { sessionId: "s", turnId: "t", messageId: "m", segmentId: "seg", segmentIndex: 0, mimeType: "audio/wav", audioData: new Uint8Array([1, 2, 3]), final: true };
adapter.prepare(segment);
assert.equal(audios[0].preload, "auto"); assert.equal(audios[0].loads, 1);
const handle = adapter.play(segment, () => { ended += 1; }, () => { errors += 1; });
await Promise.resolve();
assert.equal(audios.length, 1, "play must reuse the preloaded audio object");
assert.equal(audios[0].plays, 1);
handle.pause(); assert.equal(audios[0].pauses, 1);
handle.resume(); await Promise.resolve(); assert.equal(audios[0].plays, 2);
audios[0].onended(); assert.equal(ended, 1); assert.deepEqual(revoked, ["blob:3"]);
handle.stop(); assert.equal(audios[0].currentTime, 0); assert.equal(revoked.length, 1, "object URL must be revoked exactly once");

const errorHandle = adapter.play(segment, () => {}, () => { errors += 1; });
audios[1].onerror(); assert.equal(errors, 1); errorHandle.stop(); assert.equal(revoked.length, 2);

console.log("Browser streaming audio adapter tests passed (Blob handoff, play, pause/resume, stop, error, current-time reset, and exact URL cleanup).");
