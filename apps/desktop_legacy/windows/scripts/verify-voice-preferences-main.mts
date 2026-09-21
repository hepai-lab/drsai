import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testHome = await mkdtemp(join(tmpdir(), "opendrsai-voice-preferences-"));
process.env.DRSAI_HOME = testHome;
try {
  const store = await import("../src/main/voicePreferences");
  const initial = await store.getVoicePreferences();
  assert.equal(initial.schemaVersion, 11);
  assert.equal(initial.revision, 0);
  assert.equal(initial.realtimeOptIn, false);
  assert.equal(initial.selectedMode, "serial");

  const { revision: _revision, ...preferences } = initial;
  const first = await store.updateVoicePreferences({ expectedRevision: 0, preferences: { ...preferences, realtimeOptIn: true, selectedMode: "duplex" } });
  assert.equal(first.revision, 1);
  assert.equal(first.selectedMode, "duplex");

  const contenders = await Promise.allSettled([
    store.updateVoicePreferences({ expectedRevision: 1, preferences: { ...preferences, realtimeOptIn: true, selectedMode: "duplex" } }),
    store.updateVoicePreferences({ expectedRevision: 1, preferences: { ...preferences, realtimeOptIn: false, selectedMode: "serial" } }),
  ]);
  assert.equal(contenders.filter((item) => item.status === "fulfilled").length, 1, "exactly one concurrent writer wins the revision CAS");
  assert.equal(contenders.filter((item) => item.status === "rejected").length, 1, "stale concurrent writer is rejected");
  const final = await store.getVoicePreferences();
  assert.equal(final.revision, 2);
  assert.deepEqual(JSON.parse(await readFile(join(testHome, "desktop", "voice-preferences.json"), "utf8")), final);
  console.log("Voice preferences Main store verification passed (atomic persistence and concurrent revision CAS).");
} finally {
  await rm(testHome, { recursive: true, force: true });
}
