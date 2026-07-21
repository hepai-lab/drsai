import assert from "node:assert/strict";
import { existsSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { cleanupAllVoiceTempFiles, cleanupExpiredVoiceTempFiles } from "../src/main/voiceTempFiles.ts";

const oldVoice = join(tmpdir(), `opendrsai-voice-${randomUUID()}.webm`);
const newVoice = join(tmpdir(), `opendrsai-voice-${randomUUID()}.wav`);
const unrelated = join(tmpdir(), `opendrsai-unrelated-${randomUUID()}.wav`);

try {
  writeFileSync(oldVoice, "old");
  writeFileSync(newVoice, "new");
  writeFileSync(unrelated, "keep");
  const oldTime = new Date(Date.now() - 16 * 60_000);
  utimesSync(oldVoice, oldTime, oldTime);

  assert.equal(cleanupExpiredVoiceTempFiles(), 1);
  assert.equal(existsSync(oldVoice), false);
  assert.equal(existsSync(newVoice), true);
  assert.equal(existsSync(unrelated), true);

  assert.equal(cleanupAllVoiceTempFiles(), 1);
  assert.equal(existsSync(newVoice), false);
  assert.equal(existsSync(unrelated), true, "voice cleanup must not remove unrelated temporary files");
} finally {
  rmSync(oldVoice, { force: true });
  rmSync(newVoice, { force: true });
  rmSync(unrelated, { force: true });
}

console.log("Voice temporary file cleanup tests passed (expired, explicit, and unrelated-file safety).")
