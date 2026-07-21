import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("src/shared/desktopApi.ts");
const preload = read("src/preload/index.ts");
const main = read("src/main/index.ts");
for (const channel of [
  "voice-transcription-start",
  "voice-transcription-cancel",
  "voice-runtime-status",
  "voice-transcription-event",
  "voice-streaming-capabilities",
  "voice-streaming-start",
  "voice-streaming-stop",
  "voice-streaming-cancel",
  "voice-streaming-audio-port",
  "voice-streaming-transcription-event",
  "voice-synthesis-start",
  "voice-synthesis-cancel",
  "voice-synthesis-runtime-status",
  "voice-synthesis-event",
]) {
  if (!`${api}\n${preload}\n${main}`.includes(channel)) throw new Error(`Voice IPC verification failed: ${channel}`);
}
if (!api.includes("audioData?: Uint8Array")) throw new Error("Voice IPC verification failed: binary audio contract");
if (!api.includes("DesktopStreamingVoiceAudioChunk") || !api.includes("sendStreamingVoiceAudioChunk")) {
  throw new Error("Voice IPC verification failed: streaming binary audio contract");
}
if (!preload.includes("new MessageChannel()") || !preload.includes("ipcRenderer.postMessage")) {
  throw new Error("Voice IPC verification failed: dedicated MessagePort bridge");
}
if (!main.includes("attachStreamingVoiceAudioPort(event.sender, sessionId, port)")) {
  throw new Error("Voice IPC verification failed: Main audio port ownership binding");
}
if (!main.includes("cancelStreamingVoiceSessionsForSender(mainWindow.webContents)")) {
  throw new Error("Voice IPC verification failed: app quit streaming cleanup");
}
if (api.includes("audioBase64")) throw new Error("Voice IPC verification failed: base64 contract remains");
if (!api.includes("DesktopVoiceSynthesisResult") || !api.includes("audioData: Uint8Array")) {
  throw new Error("Voice IPC verification failed: binary synthesis result contract");
}
console.log("Voice IPC verification passed.");
