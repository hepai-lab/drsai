import type { IpcMain, IpcMainEvent, WebContents } from "electron";
import type { DesktopDuplexVoiceInterruptRequest, DesktopDuplexVoiceSessionStartRequest, DesktopDuplexVoiceToolResultRequest, DesktopStreamingVoiceStartRequest } from "../../../../shared/api";
import { isTrustedDesktopIpcSender } from "../../../../shared/main/secureIpc";
import { cancelVoiceTranscription, getVoiceRuntimeStatus, startVoiceTranscription, writeVoiceTranscriptHandoff } from "../../../../shared/main/voice";
import { attachDuplexVoiceAudioPort, cancelDuplexVoiceSession, disposeDuplexVoiceSession, getDuplexVoiceCapabilities, interruptDuplexVoiceSession, startDuplexVoiceSession, stopDuplexVoiceSession, submitDuplexVoiceToolResult, updateDuplexVoiceSession } from "../../../../shared/main/voice/duplex/controller";
import { cancelVoiceSynthesis, getVoiceSynthesisRuntimeStatus, startVoiceSynthesis } from "../../../../shared/main/voiceTts";
import { attachStreamingVoiceAudioPort, cancelStreamingVoiceTranscription, getStreamingVoiceCapabilities, startStreamingVoiceTranscription, stopStreamingVoiceTranscription } from "../../../../shared/main/voiceStreaming";

export interface MacosVoiceIpcDependencies {
  getTrustedWebContents(): WebContents | undefined;
  allowDevelopmentRendererUrl(url: string): boolean;
}

export function registerMacosVoiceIpc(
  ipcMain: Pick<IpcMain, "handle">,
  rawIpcMain: Pick<IpcMain, "on">,
  dependencies: MacosVoiceIpcDependencies,
): void {
  ipcMain.handle("desktop:voice-transcription-start", (event, request) => startVoiceTranscription(event.sender, request));
  ipcMain.handle("desktop:voice-transcription-cancel", (_event, requestId) => cancelVoiceTranscription(requestId));
  ipcMain.handle("desktop:voice-runtime-status", () => getVoiceRuntimeStatus());
  ipcMain.handle("desktop:voice-streaming-capabilities", () => getStreamingVoiceCapabilities());
  ipcMain.handle("desktop:voice-duplex-capabilities", () => getDuplexVoiceCapabilities());
  ipcMain.handle("desktop:voice-duplex-start", (event, request: DesktopDuplexVoiceSessionStartRequest) => startDuplexVoiceSession(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-update", (event, request: DesktopDuplexVoiceSessionStartRequest) => updateDuplexVoiceSession(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-interrupt", (event, request: DesktopDuplexVoiceInterruptRequest) => interruptDuplexVoiceSession(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-tool-result", (event, request: DesktopDuplexVoiceToolResultRequest) => submitDuplexVoiceToolResult(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-stop", (event, sessionId: string) => stopDuplexVoiceSession(event.sender, typeof sessionId === "string" ? sessionId : ""));
  ipcMain.handle("desktop:voice-duplex-cancel", (event, sessionId: string) => cancelDuplexVoiceSession(event.sender, typeof sessionId === "string" ? sessionId : ""));
  ipcMain.handle("desktop:voice-duplex-dispose", (event, sessionId: string) => disposeDuplexVoiceSession(event.sender, typeof sessionId === "string" ? sessionId : ""));
  ipcMain.handle("desktop:voice-streaming-start", (event, request: DesktopStreamingVoiceStartRequest) => startStreamingVoiceTranscription(event.sender, request));
  ipcMain.handle("desktop:voice-streaming-stop", (event, sessionId: string, reason?: "provider" | "local_vad" | "manual") => stopStreamingVoiceTranscription(event.sender, typeof sessionId === "string" ? sessionId : "", reason === "provider" || reason === "local_vad" ? reason : "manual"));
  ipcMain.handle("desktop:voice-streaming-cancel", (event, sessionId: string) => cancelStreamingVoiceTranscription(event.sender, typeof sessionId === "string" ? sessionId : ""));
  rawIpcMain.on("desktop:voice-streaming-audio-port", (event: IpcMainEvent, request: unknown) => {
    const trusted = isTrustedDesktopIpcSender(event as unknown as Parameters<typeof isTrustedDesktopIpcSender>[0], dependencies.getTrustedWebContents(), dependencies.allowDevelopmentRendererUrl);
    const sessionId = request && typeof request === "object" && typeof (request as { sessionId?: unknown }).sessionId === "string" ? (request as { sessionId: string }).sessionId.trim() : "";
    const port = event.ports[0];
    if (!trusted || !sessionId || !port) { port?.close(); return; }
    attachStreamingVoiceAudioPort(event.sender, sessionId, port);
  });
  rawIpcMain.on("desktop:voice-duplex-audio-port", (event: IpcMainEvent, request: unknown) => {
    const trusted = isTrustedDesktopIpcSender(event as unknown as Parameters<typeof isTrustedDesktopIpcSender>[0], dependencies.getTrustedWebContents(), dependencies.allowDevelopmentRendererUrl);
    const sessionId = request && typeof request === "object" && typeof (request as { sessionId?: unknown }).sessionId === "string" ? (request as { sessionId: string }).sessionId.trim() : "";
    const port = event.ports[0];
    if (!trusted || !sessionId || !port) { port?.close(); return; }
    attachDuplexVoiceAudioPort(event.sender, sessionId, port);
  });
  ipcMain.handle("desktop:voice-synthesis-start", (event, request) => startVoiceSynthesis(event.sender, request));
  ipcMain.handle("desktop:voice-synthesis-cancel", (_event, requestId) => cancelVoiceSynthesis(requestId));
  ipcMain.handle("desktop:voice-synthesis-runtime-status", () => getVoiceSynthesisRuntimeStatus());
  ipcMain.handle("desktop:voice-handoff-write", (_event, request) => writeVoiceTranscriptHandoff(request));
}
