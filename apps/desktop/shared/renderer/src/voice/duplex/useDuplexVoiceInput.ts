import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { DesktopDuplexVoiceEvent } from "../../../../api/desktopApi";
import { desktopApi } from "../../desktopApi";
import workletModuleUrl from "./duplexPcmCapture.worklet.js?url";
import { DuplexCaptureController, type DuplexCaptureConstraintReport, type DuplexCaptureState } from "./captureController";
import type { DuplexVadSignal } from "./localVad";
import { BrowserPcmPlaybackSink } from "./browserPcmPlaybackSink";
import { DuplexPlaybackController, type DuplexPlaybackSnapshot } from "./playbackController";
import { DuplexBargeInCoordinator, type DuplexActiveResponse } from "./bargeInCoordinator";
import { classifyDuplexSpeechIntent, shouldCommitBargeIn } from "./bargeInPolicy";
import { initialDuplexTurnState, reduceDuplexTurn } from "./duplexTurnReducer";
import { DuplexTranscriptProjection, type DuplexHistoryMessage } from "./transcriptProjection";
import { DuplexToolBridge, type DuplexToolApprovalGate, type DuplexToolExecutor, type DuplexToolStatus } from "./toolBridge";

export type DuplexVoiceInputPhase = "idle" | "starting" | "active" | "stopping" | "recovering" | "failed";
export interface UseDuplexVoiceInputOptions { threadId?: string; deviceId: string; languageHint?: string; voice?: string; instructions?: string; enableToolCalling?: boolean; toolExecutor?: DuplexToolExecutor; toolApproval?: DuplexToolApprovalGate }
const EMPTY_PLAYBACK: DuplexPlaybackSnapshot = { responseId: null, bufferedAudioMs: 0, playedAudioMs: 0, started: false, underruns: 0, dropped: 0 };

export function useDuplexVoiceInput(options: UseDuplexVoiceInputOptions) {
  const [phase, setPhase] = useState<DuplexVoiceInputPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [constraints, setConstraints] = useState<DuplexCaptureConstraintReport | null>(null);
  const [vad, setVad] = useState<DuplexVadSignal | null>(null);
  const [inputTranscript, setInputTranscript] = useState("");
  const [flowControl, setFlowControl] = useState({ paused: false, bufferedAudioMs: 0 });
  const [playback, setPlayback] = useState<DuplexPlaybackSnapshot>(EMPTY_PLAYBACK);
  const [turn, dispatchTurn] = useReducer(reduceDuplexTurn, initialDuplexTurnState);
  const [history, setHistory] = useState<DuplexHistoryMessage[]>([]);
  const [outputTranscript, setOutputTranscript] = useState("");
  const [queuedManualText, setQueuedManualText] = useState<string[]>([]);
  const [toolStatuses, setToolStatuses] = useState<Record<string, { status: DuplexToolStatus; detail?: string }>>({});
  const [usageWarning, setUsageWarning] = useState<string | null>(null);
  const optionsRef = useRef(options); optionsRef.current = options;
  const sessionRef = useRef<string | null>(null); const captureRef = useRef<DuplexCaptureController | null>(null); const playbackRef = useRef<DuplexPlaybackController | null>(null); const coordinatorRef = useRef<DuplexBargeInCoordinator | null>(null); const projectionRef = useRef<DuplexTranscriptProjection | null>(null); const toolBridgeRef = useRef<DuplexToolBridge | null>(null); const activeResponseRef = useRef<DuplexActiveResponse | null>(null); const localSpeechMsRef = useRef(0); const providerSpeechRef = useRef(false); const phaseRef = useRef(phase); phaseRef.current = phase;

  const releaseCapture = useCallback(async (): Promise<void> => { const capture = captureRef.current; captureRef.current = null; await capture?.dispose(); }, []);
  const releasePlayback = useCallback(async (): Promise<void> => { const controller = playbackRef.current; playbackRef.current = null; await controller?.dispose(); setPlayback(EMPTY_PLAYBACK); }, []);
  const fail = useCallback(async (message: string): Promise<void> => { setError(message); setPhase("failed"); await Promise.all([releaseCapture(), releasePlayback()]); const sessionId = sessionRef.current; sessionRef.current = null; if (sessionId) await desktopApi.cancelDuplexVoiceSession(sessionId).catch(() => false); }, [releaseCapture, releasePlayback]);
  const commitInterrupt = useCallback(async (reason: "user_speech" | "manual" | "stop_intent"): Promise<boolean> => {
    const active = activeResponseRef.current; const coordinator = coordinatorRef.current; if (!active || !coordinator) return false;
    dispatchTurn({ type: "interrupt", reason });
    const accepted = await coordinator.interrupt(active, reason);
    if (!accepted) dispatchTurn({ type: "terminal", terminal: "failed" });
    return accepted;
  }, []);

  useEffect(() => desktopApi.onDuplexVoiceEvents((events: DesktopDuplexVoiceEvent[]) => {
    const sessionId = sessionRef.current; if (!sessionId) return;
    for (const event of events) {
      if (event.sessionId !== sessionId) continue;
      if (projectionRef.current?.apply(event)) {
        const projected = projectionRef.current.messages;
        setHistory((current) => { const merged = new Map(current.map((message) => [message.id, message])); for (const message of projected) merged.set(message.id, message); return [...merged.values()]; });
        setOutputTranscript([...projectionRef.current.outputDrafts.values()].join(""));
        if (optionsRef.current.threadId && ["input_transcript_completed", "response_transcript_completed", "interrupted"].includes(event.type)) {
          void desktopApi.appendDuplexVoiceHistory({ threadId: optionsRef.current.threadId, messages: projected.map((message) => ({ id: message.id, role: message.role, content: message.content, ...(message.interrupted ? { statusContent: `Heard: ${message.heardContent || "(not fully played)"}` } : {}) })) }).catch(() => setError("Realtime transcript history could not be persisted."));
        }
      }
      if (event.type === "flow_control" && event.direction === "uplink") setFlowControl({ paused: event.paused, bufferedAudioMs: event.bufferedAudioMs });
      else if (event.type === "session_started") dispatchTurn({ type: "session_ready" });
      else if (event.type === "input_speech_started") { providerSpeechRef.current = true; dispatchTurn({ type: "speech_started" }); }
      else if (event.type === "input_speech_stopped") { providerSpeechRef.current = false; dispatchTurn({ type: "speech_stopped" }); }
      else if (event.type === "response_started") { playbackRef.current?.beginResponse(event.responseId); activeResponseRef.current = null; dispatchTurn({ type: "response_started", responseId: event.responseId }); setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK); }
      else if (event.type === "response_audio_delta") { try { activeResponseRef.current = { sessionId, responseId: event.delta.responseId, itemId: event.delta.itemId, contentIndex: event.delta.contentIndex }; dispatchTurn({ type: "response_audio", responseId: event.delta.responseId, itemId: event.delta.itemId, contentIndex: event.delta.contentIndex }); playbackRef.current?.enqueue(event.delta); setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK); } catch (playbackError) { void fail(playbackError instanceof Error ? playbackError.message : String(playbackError)); } }
      else if (event.type === "response_audio_completed") { playbackRef.current?.finishResponse(event.responseId); dispatchTurn({ type: "response_completed", responseId: event.responseId }); setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK); }
      else if (event.type === "interrupted") { playbackRef.current?.cancelResponse(event.responseId); activeResponseRef.current = null; dispatchTurn({ type: "interrupted" }); setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK); }
      else if (event.type === "input_transcript_delta") setInputTranscript((value) => value + event.delta.text);
      else if (event.type === "input_transcript_completed") { setInputTranscript(event.text); const intent = classifyDuplexSpeechIntent(event.text); if (shouldCommitBargeIn({ intent, localSpeechMs: localSpeechMsRef.current, providerSpeechStarted: providerSpeechRef.current, playbackActive: Boolean(activeResponseRef.current && playbackRef.current?.snapshot.started) })) void commitInterrupt(intent === "stop" ? "stop_intent" : "user_speech"); localSpeechMsRef.current = 0; }
      else if (event.type === "response_transcript_completed") { /* M7 persists this stable text. */ }
      else if (event.type === "tool_call") void toolBridgeRef.current?.handle(event.call);
      else if (event.type === "usage_update") setUsageWarning(`Realtime voice has used ${Math.round(Math.max(event.inputAudioMs, event.outputAudioMs) / 1_000)} seconds of its Session budget${event.estimatedCostUsd === null ? "; Provider cost is unavailable" : `; estimated cost $${event.estimatedCostUsd.toFixed(4)}`}.`);
      else if (event.type === "diagnostic") void desktopApi.recordDiagnostic({ traceId: sessionId, component: "duplex-voice", module: "voice/duplex", operation: "voice.duplex.session", message: "Realtime voice Session metrics", domain: "app", kind: "operation", level: "info", status: "completed", visibility: "detail", attributes: event.metrics });
      else if (event.type === "completed" || event.type === "cancelled") { toolBridgeRef.current?.detach(); dispatchTurn({ type: "terminal", terminal: event.type === "completed" ? "completed" : "cancelled" }); sessionRef.current = null; activeResponseRef.current = null; void Promise.all([releaseCapture(), releasePlayback()]); setPhase("idle"); }
      else if (event.type === "failed") { toolBridgeRef.current?.detach(); dispatchTurn({ type: "terminal", terminal: "failed" }); sessionRef.current = null; activeResponseRef.current = null; void Promise.all([releaseCapture(), releasePlayback()]); setError(event.error.message); setPhase("failed"); }
    }
  }), [commitInterrupt, fail, releaseCapture, releasePlayback]);

  useEffect(() => desktopApi.onLifecycleEvent((event) => {
    if (event.reason === "suspend" || event.reason === "lock-screen") void captureRef.current?.handleLifecycle("sleep");
    else if (event.reason === "resume" || event.reason === "unlock-screen") { void captureRef.current?.handleLifecycle("resume"); void playbackRef.current?.recover().then(() => setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK)); }
  }), []);

  useEffect(() => {
    const visible = (): void => { void captureRef.current?.handleLifecycle(document.visibilityState === "visible" ? "visible" : "hidden"); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (!['idle', 'failed'].includes(phaseRef.current)) return false;
    setPhase("starting"); setError(null); setUsageWarning(null); setInputTranscript(""); setVad(null); setConstraints(null); setFlowControl({ paused: false, bufferedAudioMs: 0 });
    let sessionId: string | null = null;
    try {
      const [policy, capabilities] = await Promise.all([desktopApi.getMyDrSaiAgentModelPolicy(), desktopApi.getDuplexVoiceCapabilities()]);
      const ref = policy.effective_realtime_voice_ref ?? policy.realtime_voice_model?.ref;
      if (!ref) throw new Error("The current Agent has no explicit Realtime voice model.");
      sessionId = `voice-duplex-${crypto.randomUUID()}`;
      const voiceSessionId = sessionId;
      await desktopApi.startDuplexVoiceSession({ protocolVersion: 1, sessionId, providerId: ref.provider_id, modelId: ref.model_id, inputEncoding: "pcm_s16le", inputSampleRateHz: 24_000, outputEncoding: "pcm_s16le", outputSampleRateHz: 24_000, channels: 1, languageHint: optionsRef.current.languageHint, voice: optionsRef.current.voice, instructions: optionsRef.current.instructions, enableInputTranscription: capabilities.supportsInputTranscription, enableOutputTranscription: capabilities.supportsOutputTranscription, enableServerVad: capabilities.supportsServerVad, enableToolCalling: Boolean(optionsRef.current.enableToolCalling && capabilities.supportsToolCalling) });
      sessionRef.current = sessionId;
      projectionRef.current = new DuplexTranscriptProjection(sessionId);
      toolBridgeRef.current = new DuplexToolBridge({ executor: optionsRef.current.toolExecutor ?? { execute: async () => { throw new Error("This Realtime tool is not connected to an approved Desktop executor."); } }, approval: optionsRef.current.toolApproval ?? { decide: async () => "reject" }, isSessionActive: () => sessionRef.current === voiceSessionId, submitResult: (callId, output) => desktopApi.submitDuplexVoiceToolResult({ sessionId: voiceSessionId, callId, output }), onStatus: (callId, status, detail) => setToolStatuses((current) => ({ ...current, [callId]: { status, ...(detail ? { detail } : {}) } })) });
      playbackRef.current = new DuplexPlaybackController(new BrowserPcmPlaybackSink());
      coordinatorRef.current = new DuplexBargeInCoordinator({ stopLocalPlayback: (responseId) => playbackRef.current?.cancelResponse(responseId) ?? 0, clearQueuedOutput: (responseId) => { playbackRef.current?.cancelResponse(responseId); }, interruptProvider: (request) => desktopApi.interruptDuplexVoiceSession(request) });
      const capture = new DuplexCaptureController({ mediaDevices: navigator.mediaDevices, createAudioContext: () => new AudioContext(), createWorkletNode: (context, name, nodeOptions) => new AudioWorkletNode(context, name, nodeOptions), now: () => performance.now(), workletModuleUrl }, {
        sessionId, deviceId: optionsRef.current.deviceId, targetSampleRateHz: 24_000,
        onChunk: (chunk) => desktopApi.sendDuplexVoiceAudioChunk(chunk), onState: (state: DuplexCaptureState) => { if (state === "recovering") setPhase("recovering"); },
        onError: (captureError) => { void fail(captureError.message); }, onDevices: setDevices, onConstraints: setConstraints, onVadSignal: (signal) => { setVad(signal); localSpeechMsRef.current = signal.speechCandidate ? localSpeechMsRef.current + 40 : 0; if (localSpeechMsRef.current >= 500 && activeResponseRef.current && playbackRef.current?.snapshot.started) void commitInterrupt("user_speech"); },
        onRecoveryRequired: () => { setPhase("recovering"); },
      });
      captureRef.current = capture;
      if (!await capture.startFromUserGesture()) throw new Error("Microphone permission or audio capture initialization failed.");
      setPhase("active"); return true;
    } catch (startError) {
      await Promise.all([releaseCapture(), releasePlayback()]); if (sessionId) await desktopApi.cancelDuplexVoiceSession(sessionId).catch(() => false); sessionRef.current = null;
      setError(startError instanceof Error ? startError.message : String(startError)); setPhase("failed"); return false;
    }
  }, [commitInterrupt, fail, releaseCapture, releasePlayback]);

  const stop = useCallback(async (): Promise<boolean> => { const sessionId = sessionRef.current; if (!sessionId) return false; toolBridgeRef.current?.detach(); setPhase("stopping"); dispatchTurn({ type: "stop" }); coordinatorRef.current?.manualOverride(); if (activeResponseRef.current) await desktopApi.interruptDuplexVoiceSession({ ...activeResponseRef.current, playedAudioMs: Math.floor(playbackRef.current?.playedAudioMs ?? 0), reason: "manual" }).catch(() => false); await Promise.all([releaseCapture(), releasePlayback()]); return desktopApi.stopDuplexVoiceSession(sessionId); }, [releaseCapture, releasePlayback]);
  const cancel = useCallback(async (): Promise<boolean> => { const sessionId = sessionRef.current; if (!sessionId) return false; toolBridgeRef.current?.detach(); await Promise.all([releaseCapture(), releasePlayback()]); const result = await desktopApi.cancelDuplexVoiceSession(sessionId); sessionRef.current = null; setPhase("idle"); return result; }, [releaseCapture, releasePlayback]);
  const queueManualText = useCallback((text: string): boolean => { const projection = projectionRef.current; if (!projection || !sessionRef.current) return false; if (projection.queueManualText(text, true) === "empty") return false; setQueuedManualText((current) => [...current, text.trim()]); return true; }, []);

  useEffect(() => () => { void releaseCapture(); void releasePlayback(); const sessionId = sessionRef.current; if (sessionId) void desktopApi.disposeDuplexVoiceSession(sessionId); }, [releaseCapture, releasePlayback]);
  return { phase, error, devices, constraints, vad, inputTranscript, outputTranscript, history, queuedManualText, toolStatuses, usageWarning, flowControl, playback, turn, start, stop, cancel, interrupt: commitInterrupt, queueManualText };
}
