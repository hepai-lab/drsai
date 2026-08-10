import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../shared/renderer/src/components/ChatWorkspace.tsx", import.meta.url), "utf8");
const controller = readFileSync(new URL("../../shared/renderer/src/voice/voiceCaptureController.ts", import.meta.url), "utf8");
const hook = readFileSync(new URL("../../shared/renderer/src/voice/useVoiceCapture.ts", import.meta.url), "utf8");
const transcriptionHook = readFileSync(new URL("../../shared/renderer/src/voice/useVoiceTranscription.ts", import.meta.url), "utf8");
const meter = readFileSync(new URL("../../shared/renderer/src/voice/useVoiceLevelMeter.ts", import.meta.url), "utf8");
const checks = [
  ["capture extracted from workspace", source.includes("useVoiceCapture(") && !source.includes("new MediaRecorder(")],
  ["concurrent start guard", controller.includes("this.disposed || this.isActive")],
  ["capture generation guard", controller.includes("this.isCurrent(generation)")],
  ["stale stream release", controller.includes("stopTracks(stream)")],
  ["device disconnect handling", controller.includes("track.addEventListener(\"ended\"")],
  ["device list change handling", hook.includes("\"devicechange\"")],
  ["initial device enumeration", hook.includes("void refreshDevices()")],
  ["recorder handler cleanup", controller.includes("recorder.ondataavailable = null") && controller.includes("recorder.onstop = null")],
  ["timer cleanup", controller.includes("this.environment.clearInterval(this.timer)")],
  ["analyzer cleanup", meter.includes("window.cancelAnimationFrame(animationFrameRef.current)")],
  ["audio context cleanup", meter.includes("audioContext.close()")],
  ["meter unmount cleanup", meter.includes("useEffect(() => stop, [stop])")],
  ["capture controller initialized in effect", hook.includes("const controller = new VoiceCaptureController") && hook.includes("controllerRef.current = controller")],
  ["capture StrictMode remount safety", hook.includes("if (controllerRef.current === controller) controllerRef.current = null") && hook.includes("controller.dispose()")],
  ["transcription StrictMode remount safety", transcriptionHook.includes("if (controllerRef.current === controller) controllerRef.current = null") && transcriptionHook.includes("controller.dispose()")],
];
const failed = checks.filter(([, passed]) => !passed);
if (failed.length) throw new Error(`Voice capture safety verification failed: ${failed.map(([name]) => name).join(", ")}`);
console.log(`Voice capture safety verification passed (${checks.length} checks).`);
