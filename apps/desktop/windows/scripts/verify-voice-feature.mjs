import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Voice feature verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const api = read("src/shared/desktopApi.ts");
const preload = read("src/preload/index.ts");
const main = read("src/main/index.ts");
const voice = read("src/main/voice.ts");
const chatWorkspace = read("src/renderer/src/components/ChatWorkspace.tsx");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const plan = read("docs/voice/voice-feature-plan.md");
const checklist = read("docs/chatbar-capability-checklist.md");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(packageJson.includes('"verify:voice-feature": "node scripts/verify-voice-feature.mjs"'), "package script is not registered");

assert(api.includes("DesktopVoiceTranscriptionRequest"), "shared API omits voice transcription request");
assert(api.includes("DesktopVoiceTranscriptionResult"), "shared API omits voice transcription result");
assert(api.includes("DesktopVoiceTranscriptHandoffRequest"), "shared API omits voice handoff request");
assert(api.includes("DesktopVoiceTranscriptHandoffResult"), "shared API omits voice handoff result");
assert(api.includes("transcribeVoiceRecording("), "desktop API omits transcribeVoiceRecording");
assert(api.includes("writeVoiceTranscriptHandoff("), "desktop API omits writeVoiceTranscriptHandoff");

assert(preload.includes("desktop:voice-transcribe"), "preload omits voice transcribe IPC bridge");
assert(preload.includes("desktop:voice-handoff-write"), "preload omits voice handoff IPC bridge");
assert(main.includes("desktop:voice-transcribe"), "main process omits voice transcribe handler");
assert(main.includes("desktop:voice-handoff-write"), "main process omits voice handoff handler");
assert(main.includes("isAllowedOpenPath(workspacePath)"), "main process omits registered workspace guard");

assert(voice.includes("MAX_VOICE_RECORDING_BYTES"), "voice module omits recording byte bound");
assert(voice.includes("MAX_VOICE_RECORDING_SECONDS"), "voice module omits duration bound");
assert(voice.includes("mock-local"), "voice module omits mock local runtime");
assert(voice.includes("no network request, provider upload, or raw-audio persistence"), "voice module omits provider safety disclosure");
assert(voice.includes("DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH"), "voice module omits workspace-local handoff path");
assert(voice.includes("lstatSync(parent).isSymbolicLink()"), "voice module omits handoff symlink guard");
assert(voice.includes('adapterId: "voice-input"'), "voice handoff does not route through voice-input adapter");

assert(chatWorkspace.includes("window.openDrSai.transcribeVoiceRecording"), "composer does not call typed voice API");
assert(chatWorkspace.includes("blobToBase64"), "composer does not serialize recording for typed API");
assert(chatWorkspace.includes("Transcription runtime is not connected yet"), "composer fallback placeholder is missing");

assert(mock.includes("transcribeVoiceRecording: async"), "mock desktop API omits voice transcription");
assert(mock.includes("writeVoiceTranscriptHandoff: async"), "mock desktop API omits voice handoff");
assert(mock.includes("Mock-local transcription is active"), "mock voice transcript omits local runtime disclosure");

assert(plan.includes("Stage 2 status: implemented for typed mock-local IPC"), "voice plan omits Stage 2 status");
assert(checklist.includes("voice-ipc-handoff-agent"), "checklist omits this run's voice agent record");
assert(roadmap.includes("typed mock-local voice transcription IPC"), "roadmap omits voice IPC evidence");

console.log("Voice feature verification passed.");
