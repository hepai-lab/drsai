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
const api = read("../shared/api/desktopApi.ts");
const preload = read("../shared/main/preload.ts");
const main = read("src/main/index.ts");
const voice = read("../shared/main/voice.ts");
const voiceValidation = read("../shared/main/voiceValidation.ts");
const chatWorkspace = read("../shared/renderer/src/components/ChatWorkspace.tsx");
const app = read("../shared/renderer/src/App.tsx");
const voiceAudio = read("../shared/renderer/src/voice/voiceAudio.ts");
const voiceMode = read("../shared/renderer/src/voice/voiceMode.ts");
const voicePreferences = read("../shared/renderer/src/voice/useVoicePreferences.ts");
const voiceLevelMeter = read("../shared/renderer/src/voice/useVoiceLevelMeter.ts");
const voiceTranscriptionHook = read("../shared/renderer/src/voice/useVoiceTranscription.ts");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const plan = read("../../../docs/voice/voice-feature-plan.md");
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
assert(api.includes('DesktopVoiceInteractionMode = "serial" | "streaming"'), "shared API omits dual voice modes");
assert(api.includes("DesktopStreamingVoiceCapabilities"), "shared API omits streaming runtime capabilities");
assert(api.includes("DesktopStreamingVoiceAudioChunk"), "shared API omits streaming PCM chunks");
assert(api.includes("DesktopStreamingVoiceAudioAck"), "shared API omits streaming audio acknowledgements");
assert(api.includes("DesktopStreamingVoiceTranscriptionEvent"), "shared API omits partial/final transcription events");
assert(api.includes("DesktopStreamingVoiceTtsAudioSegment"), "shared API omits ordered TTS audio segments");
assert(api.includes("writeVoiceTranscriptHandoff("), "desktop API omits writeVoiceTranscriptHandoff");

assert(preload.includes("desktop:voice-transcription-start"), "preload omits voice start IPC bridge");
assert(preload.includes("desktop:voice-transcription-cancel"), "preload omits voice cancel IPC bridge");
assert(preload.includes("desktop:voice-transcription-event"), "preload omits voice event IPC bridge");
assert(preload.includes("desktop:voice-handoff-write"), "preload omits voice handoff IPC bridge");
assert(main.includes("desktop:voice-transcription-start"), "main process omits voice start handler");
assert(main.includes("desktop:voice-runtime-status"), "main process omits voice runtime status handler");
assert(main.includes("desktop:voice-handoff-write"), "main process omits voice handoff handler");
assert(main.includes("cancelVoiceTranscriptionsForSender(mainWindow.webContents)"), "app quit does not cancel active STT");
assert(main.includes("cancelVoiceSynthesisForSender(mainWindow.webContents)"), "app quit does not cancel active TTS");
assert(main.includes("cancelStreamingVoiceSessionsForSender(mainWindow.webContents)"), "app quit does not cancel active streaming voice sessions");
assert(main.includes("await desktopDiagnostics.clear()"), "all-local-data cleanup does not clear retained voice diagnostics");
assert(main.includes("isAllowedOpenPath(workspacePath)"), "main process omits registered workspace guard");

assert(voiceValidation.includes("MAX_VOICE_RECORDING_BYTES"), "voice module omits recording byte bound");
assert(voiceValidation.includes("MAX_VOICE_RECORDING_SECONDS"), "voice module omits duration bound");
assert(voice.includes("activeVoiceTasks"), "voice module omits request registry");
assert(voice.includes("AbortController"), "voice module omits cancellation controller");
assert(voice.includes("writeTemporaryVoiceAudio"), "voice module omits temporary audio storage");
assert(voice.includes("cleanupExpiredVoiceTempFiles"), "voice module omits temp TTL cleanup");
assert(voice.includes("/v1/audio/transcriptions"), "voice module omits gateway provider runtime");
assert(!voice.includes("Mock-local transcription is active"), "production voice module still returns mock text");
assert(voice.includes("DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH"), "voice module omits workspace-local handoff path");
assert(voice.includes("lstatSync(parent).isSymbolicLink()"), "voice module omits handoff symlink guard");
assert(voice.includes('adapterId: "voice-input"'), "voice handoff does not route through voice-input adapter");

assert(chatWorkspace.includes("useVoiceTranscription"), "composer does not use the transcription controller hook");
assert(voiceTranscriptionHook.includes("desktopApi.startVoiceTranscription"), "transcription hook does not start typed async voice task");
assert(voiceTranscriptionHook.includes("desktopApi.cancelVoiceTranscription"), "transcription hook does not cancel voice task");
assert(chatWorkspace.includes("VoiceReviewBar"), "streaming voice omits transcript review UI");
assert(chatWorkspace.includes("ThreadActivityBubble"), "serial transcription does not reuse the conversation runtime indicator");
assert(chatWorkspace.includes('dispatchVoiceTurn({ type: "transcript_inserted", requestId });'), "confirmed serial transcription does not return to an ordinary composer draft");
assert(!chatWorkspace.includes("blobToBase64"), "composer still serializes audio as base64");
assert(voiceLevelMeter.includes("createMediaStreamSource(stream)"), "voice level meter omits live microphone analysis");
assert(voiceLevelMeter.includes("getFloatTimeDomainData(samples)"), "voice level meter waveform is not driven by audio samples");
assert(voiceLevelMeter.includes("[...current.slice(1), level]"), "voice level meter does not move samples right-to-left");
assert(voiceAudio.includes("VOICE_NOISE_FLOOR"), "voice waveform omits silence gating");
assert(!chatWorkspace.includes("composer-voice-wave-pulse"), "composer still uses a synthetic waveform animation");
assert(chatWorkspace.includes('data-testid="composer-voice-mode"'), "composer omits the voice mode selector");
assert(app.includes('data-testid="voice-interaction-mode"'), "voice settings omit the interaction mode selector");
assert(voiceMode.includes('DEFAULT_VOICE_MODE: DesktopVoiceInteractionMode = "serial"'), "serial is not the explicit default voice mode");
assert(voiceMode.includes("canSwitchVoiceMode"), "voice mode switching omits active-turn protection");
assert(voiceMode.includes("getVoiceModeAvailability"), "voice mode switching omits runtime capability gating");
assert(voicePreferences.includes("VOICE_PREFERENCES_SCHEMA_VERSION = 5"), "voice preferences schema was not advanced for transcript confirmation by default");
assert(voicePreferences.includes('interactionMode: "serial"'), "voice preferences do not default to serial");
assert(voicePreferences.includes("confirmBeforeSend: true"), "serial voice does not default to transcript confirmation");

assert(mock.includes("startVoiceTranscription: async"), "mock desktop API omits fixture voice task");
assert(mock.includes("writeVoiceTranscriptHandoff: async"), "mock desktop API omits voice handoff");
assert(mock.includes("Fixture transcription is active"), "mock voice runtime omits fixture disclosure");

assert(backendGateway.includes('@app.post("/v1/audio/transcriptions")'), "bundled gateway omits transcription endpoint");
assert(backendGateway.includes("httpx.AsyncClient"), "gateway transcription endpoint omits provider client");
assert(backendGateway.includes("10 * 1024 * 1024"), "gateway transcription endpoint omits byte bound");

assert(plan.includes("Phase B 开发方案"), "voice plan omits Phase B implementation link");
assert(plan.includes("流式语音交互完整开发方案"), "voice plan omits the streaming voice implementation link");
assert(checklist.includes("voice-ipc-handoff-agent"), "checklist omits this run's voice agent record");
assert(checklist.includes("voice-status-reconciliation-agent"), "checklist omits voice status reconciliation record");
assert(checklist.includes("gateway-provider transcription runtime"), "checklist omits gateway-provider runtime evidence");
assert(checklist.includes("device selection, MediaRecorder capture, live waveform sampling"), "checklist omits local voice capture evidence");
assert(checklist.includes("offline Whisper/local STT packaging"), "checklist omits updated voice remaining gap");
assert(roadmap.includes("typed voice transcription IPC"), "roadmap omits voice IPC evidence");
assert(roadmap.includes("gateway-provider transcription runtime"), "roadmap omits gateway-provider runtime evidence");
assert(roadmap.includes("input device selection, MediaRecorder capture, live waveform sampling"), "roadmap omits local voice capture evidence");

console.log("Voice feature verification passed.");
