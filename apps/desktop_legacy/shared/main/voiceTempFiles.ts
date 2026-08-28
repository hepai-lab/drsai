import { readdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VOICE_TEMP_FILE_PATTERN = /^opendrsai-voice-[0-9a-f-]+\.(webm|ogg|wav|m4a|mp3|audio)$/i;
const VOICE_TEMP_TTL_MS = 15 * 60_000;

export function cleanupExpiredVoiceTempFiles(now = Date.now()): number {
  return cleanupVoiceTempFiles((path) => now - statSync(path).mtimeMs > VOICE_TEMP_TTL_MS);
}

export function cleanupAllVoiceTempFiles(): number {
  return cleanupVoiceTempFiles(() => true);
}

function cleanupVoiceTempFiles(shouldRemove: (path: string) => boolean): number {
  let removed = 0;
  for (const name of readdirSync(tmpdir())) {
    if (!VOICE_TEMP_FILE_PATTERN.test(name)) continue;
    const path = join(tmpdir(), name);
    try {
      if (shouldRemove(path)) {
        unlinkSync(path);
        removed += 1;
      }
    } catch {
      // Best effort cleanup; an active task may still own the file.
    }
  }
  return removed;
}
