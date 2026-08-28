import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "../..");
const roots = [resolve(desktopRoot, "shared"), resolve(desktopRoot, "windows/src"), resolve(desktopRoot, "windows/scripts")];
const deletionGateWhitelist = new Set([
  "windows/scripts/verify-voice-streaming-removal.mjs",
  "windows/scripts/verify-voice-feature.mjs",
  "windows/scripts/verify-voice-ipc.mjs",
  "windows/scripts/test-duplex-voice-contracts.mjs",
]);
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".mts"]);
const forbiddenPaths = [
  /[/\\]voice[/\\]streaming(?:[/\\]|$)/i,
  /[/\\]voiceStreaming(?:[/\\]|$)/,
  /[/\\]voice[/\\]StreamingVoice(?:Capture|Output)Bar\.tsx$/,
  /[/\\]voice[/\\](?:StreamingComposerProjectionEditor|TranscriptRepairDiff)\.tsx$/,
];
const forbiddenSource = [
  /DesktopStreamingVoice/g,
  /DesktopStreamingAudioEncoding/g,
  /DesktopTranscriptRepair/g,
  /(?:get|start|stop|cancel|send|on)StreamingVoice/g,
  /desktop:voice-streaming-/g,
  /StreamingVoice(?:Capture|Output)Bar/g,
  /useStreamingVoice(?:Input|Output)/g,
];

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", "out", "release", "test-kit"].includes(entry.name)) output.push(...await walk(path));
    else if (sourceExtensions.has(extname(entry.name))) output.push(path);
  }
  return output;
}

const files = (await Promise.all(roots.map(walk))).flat();
const violations = [];
for (const file of files) {
  const name = relative(desktopRoot, file).replaceAll("\\", "/");
  if (deletionGateWhitelist.has(name)) continue;
  if (forbiddenPaths.some((pattern) => pattern.test(file))) violations.push(`${name}: obsolete runtime module`);
  const source = await readFile(file, "utf8");
  for (const pattern of forbiddenSource) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) violations.push(`${name}: ${pattern.source}`);
  }
}

assert.deepEqual(violations, [], `Legacy streaming Voice runtime remains:\n${violations.join("\n")}`);
const packageJson = await readFile(resolve(desktopRoot, "windows/package.json"), "utf8");
assert.doesNotMatch(packageJson, /"test:voice:streaming(?:"|:)/, "legacy streaming Voice test entry remains");
assert.doesNotMatch(packageJson, /"verify:voice:streaming-(?!removal)/, "legacy streaming Voice verification alias remains");
console.log("P3-F9 Voice streaming removal gate passed (public API, IPC, UI and runtime modules absent)." );
