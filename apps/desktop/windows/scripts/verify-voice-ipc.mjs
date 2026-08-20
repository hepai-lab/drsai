import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("../shared/api/desktopApi.ts");
const preload = read("../shared/main/preload.ts");
const main = read("src/main/index.ts");
for (const channel of [
  "voice-transcription-start",
  "voice-transcription-cancel",
  "voice-runtime-status",
  "voice-transcription-event",
  "voice-duplex-capabilities",
  "voice-duplex-start",
  "voice-duplex-stop",
  "voice-duplex-cancel",
  "voice-duplex-audio-port",
  "voice-duplex-events",
  "voice-synthesis-start",
  "voice-synthesis-cancel",
  "voice-synthesis-runtime-status",
  "voice-synthesis-event",
]) {
  if (!`${api}\n${preload}\n${main}`.includes(channel)) throw new Error(`Voice IPC verification failed: ${channel}`);
}
if (!api.includes("audioData?: Uint8Array")) throw new Error("Voice IPC verification failed: binary audio contract");
if (!api.includes("DesktopDuplexVoiceAudioChunk") || !api.includes("sendDuplexVoiceAudioChunk")) {
  throw new Error("Voice IPC verification failed: duplex binary audio contract");
}
if (!preload.includes("new MessageChannel()") || !preload.includes("ipcRenderer.postMessage")) {
  throw new Error("Voice IPC verification failed: dedicated MessagePort bridge");
}
if (!main.includes("attachDuplexVoiceAudioPort(event.sender, sessionId, port)")) {
  throw new Error("Voice IPC verification failed: Main audio port ownership binding");
}
if (!main.includes("disposeAllDuplexVoiceSessions()")) {
  throw new Error("Voice IPC verification failed: app quit duplex cleanup");
}
if (`${api}\n${preload}\n${main}`.includes("voice-streaming-")) throw new Error("Voice IPC verification failed: legacy streaming Voice channel remains");
if (api.includes("audioBase64")) throw new Error("Voice IPC verification failed: base64 contract remains");
if (!api.includes("DesktopVoiceSynthesisResult") || !api.includes("audioData: Uint8Array")) {
  throw new Error("Voice IPC verification failed: binary synthesis result contract");
}
console.log("Voice IPC verification passed.");
