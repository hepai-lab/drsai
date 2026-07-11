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
const backendGateway = read("../../../cores/python/packages/drsai/src/drsai/backend/gateway.py");

assert(packageJson.includes('"verify:voice-feature": "node scripts/verify-voice-feature.mjs"'), "package script is not registered");

assert(api.includes("DesktopVoiceTranscriptionRequest"), "shared API omits voice transcription request");
assert(api.includes("DesktopVoiceTranscriptionResult"), "shared API omits voice transcription result");
assert(api.includes("DesktopVoiceTranscriptHandoffRequest"), "shared API omits voice handoff request");
assert(api.includes("DesktopVoiceTranscriptHandoffResult"), "shared API omits voice handoff result");
assert(api.includes("startVoiceTranscription("), "desktop API omits async voice start");
assert(api.includes("cancelVoiceTranscription("), "desktop API omits voice cancellation");
assert(api.includes("onVoiceTranscriptionEvent("), "desktop API omits voice events");
assert(api.includes("DesktopVoiceErrorCode"), "desktop API omits normalized errors");
assert(api.includes("writeVoiceTranscriptHandoff("), "desktop API omits writeVoiceTranscriptHandoff");

assert(preload.includes("desktop:voice-transcription-start"), "preload omits voice start IPC bridge");
assert(preload.includes("desktop:voice-transcription-cancel"), "preload omits voice cancel IPC bridge");
assert(preload.includes("desktop:voice-transcription-event"), "preload omits voice event IPC bridge");
assert(preload.includes("desktop:voice-handoff-write"), "preload omits voice handoff IPC bridge");
assert(main.includes("desktop:voice-transcription-start"), "main process omits voice start handler");
assert(main.includes("desktop:voice-runtime-status"), "main process omits voice runtime status handler");
assert(main.includes("desktop:voice-handoff-write"), "main process omits voice handoff handler");
assert(main.includes("isAllowedOpenPath(workspacePath)"), "main process omits registered workspace guard");

assert(voice.includes("MAX_VOICE_RECORDING_BYTES"), "voice module omits recording byte bound");
assert(voice.includes("MAX_VOICE_RECORDING_SECONDS"), "voice module omits duration bound");
assert(voice.includes("activeVoiceTasks"), "voice module omits request registry");
assert(voice.includes("AbortController"), "voice module omits cancellation controller");
assert(voice.includes("writeTemporaryVoiceAudio"), "voice module omits temporary audio storage");
assert(voice.includes("cleanupExpiredVoiceTempFiles"), "voice module omits temp TTL cleanup");
assert(voice.includes("/v1/audio/transcriptions"), "voice module omits gateway provider runtime");
assert(!voice.includes("Mock-local transcription is active"), "production voice module still returns mock text");
assert(voice.includes("DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH"), "voice module omits workspace-local handoff path");
assert(voice.includes("lstatSync(parent).isSymbolicLink()"), "voice module omits handoff symlink guard");
assert(voice.includes('adapterId: "voice-input"'), "voice handoff does not route through voice-input adapter");

assert(chatWorkspace.includes("desktopApi.startVoiceTranscription"), "composer does not start typed async voice task");
assert(chatWorkspace.includes("desktopApi.cancelVoiceTranscription"), "composer does not cancel voice task");
assert(chatWorkspace.includes("VoiceReviewBar"), "composer omits transcript review UI");
assert(!chatWorkspace.includes("blobToBase64"), "composer still serializes audio as base64");
assert(chatWorkspace.includes("createMediaStreamSource(stream)"), "composer omits live microphone analysis");
assert(chatWorkspace.includes("getFloatTimeDomainData(samples)"), "composer waveform is not driven by audio samples");
assert(chatWorkspace.includes("[...current.slice(1), level]"), "composer waveform does not move samples right-to-left");
assert(chatWorkspace.includes("VOICE_NOISE_FLOOR"), "composer waveform omits silence gating");
assert(!chatWorkspace.includes("composer-voice-wave-pulse"), "composer still uses a synthetic waveform animation");

assert(mock.includes("startVoiceTranscription: async"), "mock desktop API omits fixture voice task");
assert(mock.includes("writeVoiceTranscriptHandoff: async"), "mock desktop API omits voice handoff");
assert(mock.includes("Fixture transcription is active"), "mock voice runtime omits fixture disclosure");

assert(backendGateway.includes('@app.post("/v1/audio/transcriptions")'), "bundled gateway omits transcription endpoint");
assert(backendGateway.includes("httpx.AsyncClient"), "gateway transcription endpoint omits provider client");
assert(backendGateway.includes("10 * 1024 * 1024"), "gateway transcription endpoint omits byte bound");

assert(plan.includes("Phase B Development Plan"), "voice plan omits Phase B implementation link");
assert(checklist.includes("voice-ipc-handoff-agent"), "checklist omits this run's voice agent record");
assert(roadmap.includes("typed mock-local voice transcription IPC"), "roadmap omits voice IPC evidence");

console.log("Voice feature verification passed.");
