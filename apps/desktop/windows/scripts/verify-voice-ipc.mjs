import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const api = read("src/shared/desktopApi.ts");
const preload = read("src/preload/index.ts");
const main = read("src/main/index.ts");
for (const channel of ["voice-transcription-start", "voice-transcription-cancel", "voice-runtime-status", "voice-transcription-event"]) {
  if (!`${api}\n${preload}\n${main}`.includes(channel)) throw new Error(`Voice IPC verification failed: ${channel}`);
}
if (!api.includes("audioData?: Uint8Array")) throw new Error("Voice IPC verification failed: binary audio contract");
if (api.includes("audioBase64")) throw new Error("Voice IPC verification failed: base64 contract remains");
console.log("Voice IPC verification passed.");
