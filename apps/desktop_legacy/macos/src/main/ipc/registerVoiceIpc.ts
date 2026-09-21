import type { IpcMain, IpcMainEvent, WebContents } from "electron";
import type { DesktopDuplexVoiceInterruptRequest, DesktopDuplexVoiceSessionStartRequest, DesktopDuplexVoiceTakeoverRequest, DesktopDuplexVoiceTextInputRequest, DesktopDuplexVoiceToolApprovalDecision, DesktopDuplexVoiceToolApprovalRequest, DesktopDuplexVoiceToolResultRequest } from "../../../../shared/api";
import type { PersistentApprovalStore } from "../../../../shared/main/approvalStore";
import { isTrustedDesktopIpcSender } from "../../../../shared/main/secureIpc";
import { cancelVoiceTranscription, getVoiceRuntimeStatus, startVoiceTranscription, writeVoiceTranscriptHandoff } from "../../../../shared/main/voice";
import { attachDuplexVoiceAudioPort, cancelDuplexVoiceSession, disposeDuplexVoiceSession, finishDuplexVoiceTurn, getDuplexVoiceCapabilities, getDuplexVoiceOccupancy, getDuplexVoiceReadiness, interruptDuplexVoiceSession, startDuplexVoiceSession, stopDuplexVoiceSession, submitDuplexVoiceTextInput, submitDuplexVoiceToolResult, takeOverDuplexVoiceSession, updateDuplexVoiceSession } from "../../../../shared/main/voice/duplex/controller";
import { cancelVoiceSynthesis, getVoiceSynthesisRuntimeStatus, startVoiceSynthesis } from "../../../../shared/main/voiceTts";

export interface MacosVoiceIpcDependencies {
  getTrustedWebContents(): WebContents | undefined;
  allowDevelopmentRendererUrl(url: string): boolean;
  approvals: Pick<PersistentApprovalStore, "propose">;
}

export function registerMacosVoiceIpc(
  ipcMain: Pick<IpcMain, "handle">,
  rawIpcMain: Pick<IpcMain, "on">,
  dependencies: MacosVoiceIpcDependencies,
): void {
  ipcMain.handle("desktop:voice-transcription-start", (event, request) => startVoiceTranscription(event.sender, request));
  ipcMain.handle("desktop:voice-transcription-cancel", (_event, requestId) => cancelVoiceTranscription(requestId));
  ipcMain.handle("desktop:voice-runtime-status", () => getVoiceRuntimeStatus());
  ipcMain.handle("desktop:voice-duplex-capabilities", () => getDuplexVoiceCapabilities());
  ipcMain.handle("desktop:voice-duplex-readiness", () => getDuplexVoiceReadiness());
  ipcMain.handle("desktop:voice-duplex-occupancy", (event) => getDuplexVoiceOccupancy(event.sender));
  ipcMain.handle("desktop:voice-duplex-start", (event, request: DesktopDuplexVoiceSessionStartRequest) => startDuplexVoiceSession(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-takeover", (event, request: DesktopDuplexVoiceTakeoverRequest) => takeOverDuplexVoiceSession(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-update", (event, request: DesktopDuplexVoiceSessionStartRequest) => updateDuplexVoiceSession(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-interrupt", (event, request: DesktopDuplexVoiceInterruptRequest) => interruptDuplexVoiceSession(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-tool-result", (event, request: DesktopDuplexVoiceToolResultRequest) => submitDuplexVoiceToolResult(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-tool-approval", async (event, request: DesktopDuplexVoiceToolApprovalRequest) => {
    const sessionId = typeof request?.sessionId === "string" ? request.sessionId.trim() : ""; const callId = typeof request?.callId === "string" ? request.callId.trim() : ""; const name = typeof request?.name === "string" ? request.name.trim() : "";
    if (!/^voice-duplex-[a-zA-Z0-9-]{8,160}$/.test(sessionId) || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(callId) || !/^[a-zA-Z0-9_.:-]{1,160}$/.test(name)) throw new Error("Realtime tool approval identifiers are invalid.");
    const notify = (decision: DesktopDuplexVoiceToolApprovalDecision["decision"]): void => { if (!event.sender.isDestroyed()) event.sender.send("desktop:voice-duplex-tool-approval-decision", { sessionId, callId, decision } satisfies DesktopDuplexVoiceToolApprovalDecision); };
    return dependencies.approvals.propose({ source: "connector", actionKind: "external.service", title: `Realtime tool: ${name}`, detail: `Approve this tool requested by the active Realtime voice Session.\nTool: ${name}\nArguments: ${String(request.argumentsSummary ?? "{}").replace(/\0/g, "").slice(0, 1_200)}`, businessAction: name, businessObject: "Realtime voice tool call", target: sessionId, scope: request.scope ?? "Current Realtime voice Session", impact: "The tool executes once and returns a redacted result to the active Realtime Session.", risk: request.risk ?? "high", idempotencyKey: `duplex-tool:${sessionId}:${callId}` }, async () => { notify("allow"); return true; }, async (approved) => { if (!approved) notify("reject"); });
  });
  ipcMain.handle("desktop:voice-duplex-text-input", (event, request: DesktopDuplexVoiceTextInputRequest) => submitDuplexVoiceTextInput(event.sender, request));
  ipcMain.handle("desktop:voice-duplex-stop", (event, sessionId: string) => stopDuplexVoiceSession(event.sender, typeof sessionId === "string" ? sessionId : ""));
  ipcMain.handle("desktop:voice-duplex-finish-turn", (event, sessionId: string) => finishDuplexVoiceTurn(event.sender, typeof sessionId === "string" ? sessionId : ""));
  ipcMain.handle("desktop:voice-duplex-cancel", (event, sessionId: string) => cancelDuplexVoiceSession(event.sender, typeof sessionId === "string" ? sessionId : ""));
  ipcMain.handle("desktop:voice-duplex-dispose", (event, sessionId: string) => disposeDuplexVoiceSession(event.sender, typeof sessionId === "string" ? sessionId : ""));
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
