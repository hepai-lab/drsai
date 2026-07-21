import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatWorkspace = await readFile(
  new URL("../src/renderer/src/components/ChatWorkspace.tsx", import.meta.url),
  "utf8",
);

const voiceButtonStart = chatWorkspace.indexOf("composer-voice-button");
assert.notEqual(voiceButtonStart, -1, "voice button must exist in the composer");

const voiceButtonMarkup = chatWorkspace.slice(voiceButtonStart, voiceButtonStart + 900);
assert.match(
  voiceButtonMarkup,
  /disabled=\{showStop \|\| voiceState === "requesting_permission" \|\| voiceState === "processing"\}/,
  "voice capture must only be disabled for conflicting voice/chat activity",
);
assert.doesNotMatch(
  voiceButtonMarkup,
  /disabled=\{!canChat/,
  "voice capture must remain actionable when chat readiness is stale so runtime errors are visible",
);

console.log("Voice entry verification passed.");
