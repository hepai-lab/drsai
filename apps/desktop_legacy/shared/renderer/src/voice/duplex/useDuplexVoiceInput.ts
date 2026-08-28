import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DesktopDuplexVoiceEvent, DesktopDuplexVoiceOccupancy } from "../../../../api/desktopApi";
import { desktopApi } from "../../desktopApi";
import workletModuleUrl from "./duplexPcmCapture.worklet.js?url&no-inline";
import { DuplexCaptureController, type DuplexCaptureConstraintReport, type DuplexCaptureState } from "./captureController";
import type { DuplexCaptureQualitySnapshot } from "./captureQuality";
import { runDuplexStartupStage, runDuplexStartupTransaction, type DuplexVoiceStartupStage } from "./startupTransaction";
import { classifyDuplexStartupFailure, type DuplexVoiceFailure } from "./startupFailure";
import type { DuplexVadSignal } from "./localVad";
import { BrowserPcmPlaybackSink } from "./browserPcmPlaybackSink";
import { DuplexPlaybackController, type DuplexPlaybackSnapshot } from "./playbackController";
import { DuplexBargeInCoordinator, type DuplexActiveResponse } from "./bargeInCoordinator";
import { classifyDuplexSpeechIntent, shouldCommitBargeIn } from "./bargeInPolicy";
import { duplexLifecycleAction } from "./lifecyclePolicy";
import { DuplexBargeInCandidate, type DuplexBargeInCandidateSnapshot } from "./bargeInCandidate";
import { initialDuplexTurnState, reduceDuplexTurn } from "./duplexTurnReducer";
import { DuplexTranscriptProjection, type DuplexHistoryMessage } from "./transcriptProjection";
import { DuplexToolBridge, summarizeToolArguments, type DuplexToolApprovalGate, type DuplexToolExecutor, type DuplexToolStatus } from "./toolBridge";
import { buildDuplexSessionContext } from "./sessionContext";
import { DuplexTextInputScheduler, type DuplexPendingText, type DuplexTextSendStrategy } from "./textInputScheduler";
import { DesktopDuplexToolApprovalGate } from "./desktopToolApprovalGate";
import { buildDuplexSloSnapshot } from "./sloProjection";
import { DuplexTemporaryDiagnostics } from "./temporaryDiagnostics";
import { DuplexStableHistoryWriter } from "./stableHistoryWriter";
import { claimWasGranted, initialDuplexSessionState, reduceDuplexSession, type DuplexSessionEvent, type DuplexSessionState } from "./duplexSessionReducer";

export type DuplexVoiceInputPhase = "idle" | "starting" | "active" | "stopping" | "recovering" | "failed";
export type { DuplexVoiceStartupStage } from "./startupTransaction";
export interface UseDuplexVoiceInputOptions { threadId?: string; deviceId: string; outputDeviceId?: string; volume?: number; autoRecovery?: boolean; onOutputDeviceFallback?: () => void; languageHint?: string; voice?: string; instructions?: string; enableToolCalling?: boolean; toolExecutor?: DuplexToolExecutor; toolApproval?: DuplexToolApprovalGate }
const EMPTY_PLAYBACK: DuplexPlaybackSnapshot = { responseId: null, bufferedAudioMs: 0, playedAudioMs: 0, started: false, underruns: 0, dropped: 0, gaps: 0, jitterBufferTargetMs: 80, jitterMs: 0, networkQuality: "stable", sinkId: "", volume: 1, ducked: false, outputState: "running", outputReferenceLevel: 0 };

export function useDuplexVoiceInput(options: UseDuplexVoiceInputOptions) {
  const [sessionState, dispatchSessionState] = useReducer(reduceDuplexSession, initialDuplexSessionState);
  const phase: DuplexVoiceInputPhase = sessionState.phase === "ending" ? "stopping" : sessionState.phase;
  const startupStage = sessionState.startupStage;
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<DuplexVoiceFailure | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [constraints, setConstraints] = useState<DuplexCaptureConstraintReport | null>(null);
  const [quality, setQuality] = useState<DuplexCaptureQualitySnapshot | null>(null);
  const [vad, setVad] = useState<DuplexVadSignal | null>(null);
  const [inputTranscript, setInputTranscript] = useState("");
  const [flowControl, setFlowControl] = useState({ paused: false, bufferedAudioMs: 0 });
  const [playbackFlowControl, setPlaybackFlowControl] = useState({ paused: false, bufferedAudioMs: 0 });
  const [playback, setPlayback] = useState<DuplexPlaybackSnapshot>(EMPTY_PLAYBACK);
  const [turn, dispatchTurn] = useReducer(reduceDuplexTurn, initialDuplexTurnState);
  const [history, setHistory] = useState<DuplexHistoryMessage[]>([]);
  const [outputTranscript, setOutputTranscript] = useState("");
  const [toolStatuses, setToolStatuses] = useState<Record<string, { status: DuplexToolStatus; detail?: string }>>({});
  const [pendingText, setPendingText] = useState<DuplexPendingText | null>(null);
  const [usageWarning, setUsageWarning] = useState<string | null>(null);
  const [occupancy, setOccupancy] = useState<DesktopDuplexVoiceOccupancy | null>(null);
  const [deviceSwitching, setDeviceSwitching] = useState(false); const [deviceSwitchError, setDeviceSwitchError] = useState<string | null>(null);
  const [playbackDegradation, setPlaybackDegradation] = useState<string | null>(null);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const [reconnectCountdownSeconds, setReconnectCountdownSeconds] = useState(0);
  const [sessionUpdate, setSessionUpdate] = useState<{ updateId: string; status: "pending" | "applied" | "rejected" | "rolled_back" | "requires_restart"; changedFields: string[]; reason?: string } | null>(null);
  const [runtimeMetrics, setRuntimeMetrics] = useState<{ ttfaMs: number | null; reconnects: number; inputAudioMs: number; outputAudioMs: number } | null>(null);
  const [providerUsage, setProviderUsage] = useState<{ inputAudioMs: number; outputAudioMs: number; estimatedCostUsd: number | null } | null>(null);
  const [interruptStats, setInterruptStats] = useState({ attempts: 0, accepted: 0 });
  const [stopLatencyMs, setStopLatencyMs] = useState<number | null>(null);
  const [temporaryDiagnosticsExpiresAt, setTemporaryDiagnosticsExpiresAt] = useState<number | null>(null);
  const [microphonePaused, setMicrophonePaused] = useState(false);
  const [outputDeviceSwitching, setOutputDeviceSwitching] = useState(false); const [outputDeviceError, setOutputDeviceError] = useState<string | null>(null); const [playbackRecovery, setPlaybackRecovery] = useState<string | null>(null);
  const optionsRef = useRef(options); optionsRef.current = options;
  const failureRef = useRef<DuplexVoiceFailure | null>(null);
  const historyWriteRef = useRef<Promise<void>>(Promise.resolve());
  const stableHistoryWriterRef = useRef<DuplexStableHistoryWriter | null>(null);
  const sessionStateRef = useRef<DuplexSessionState>(initialDuplexSessionState); sessionStateRef.current = sessionState;
  const startRequestRef = useRef<import("../../../../api/desktopApi").DesktopDuplexVoiceSessionStartRequest | null>(null);
  const stopStartedAtRef = useRef<number | null>(null);
  const temporaryDiagnosticsRef = useRef(new DuplexTemporaryDiagnostics());
  const temporaryDiagnosticsTimerRef = useRef<number | null>(null);
  const toolRevisionRef = useRef(new Map<string, number>());
  const sessionRef = useRef<string | null>(null); const captureRef = useRef<DuplexCaptureController | null>(null); const playbackRef = useRef<DuplexPlaybackController | null>(null); const coordinatorRef = useRef<DuplexBargeInCoordinator | null>(null); const projectionRef = useRef<DuplexTranscriptProjection | null>(null); const toolBridgeRef = useRef<DuplexToolBridge | null>(null); const toolApprovalGateRef = useRef<DesktopDuplexToolApprovalGate | null>(null); const textSchedulerRef = useRef<DuplexTextInputScheduler | null>(null); const activeResponseRef = useRef<DuplexActiveResponse | null>(null); const localSpeechMsRef = useRef(0); const providerSpeechRef = useRef(false); const asrPrefixRef = useRef(""); const candidateRef = useRef(new DuplexBargeInCandidate());

  const dispatchSession = useCallback((event: DuplexSessionEvent): { previous: DuplexSessionState; next: DuplexSessionState } => {
    const previous = sessionStateRef.current; const next = reduceDuplexSession(previous, event); sessionStateRef.current = next; dispatchSessionState(event); return { previous, next };
  }, []);

  const releaseCapture = useCallback(async (): Promise<void> => { const capture = captureRef.current; captureRef.current = null; await capture?.dispose(); }, []);
  const releasePlayback = useCallback(async (): Promise<void> => { const controller = playbackRef.current; playbackRef.current = null; await controller?.dispose(); setPlayback(EMPTY_PLAYBACK); }, []);
  const flushStableHistory = useCallback(async (): Promise<boolean> => { const writer = stableHistoryWriterRef.current; return writer ? writer.flush(2) : true; }, []);
  const fail = useCallback(async (failureValue: DuplexVoiceFailure): Promise<void> => {
    const message = failureValue.message; const sessionId = sessionRef.current ?? sessionStateRef.current.sessionId;
    failureRef.current = failureValue;
    if (sessionId) dispatchSession({ type: "terminal", sessionId, terminal: "failed" });
    setError(message); setFailure(failureValue); toolApprovalGateRef.current?.dispose(); textSchedulerRef.current?.cancel();
    let historySaved = true;
    if (sessionId) { const claim = dispatchSession({ type: "claim_history_flush", sessionId }); if (claimWasGranted(claim.previous, claim.next, "historyFlushClaimed")) historySaved = await flushStableHistory(); }
    if (!historySaved) setError(`${message} Completed Realtime transcript history could not be persisted.`);
    if (sessionId) { const claim = dispatchSession({ type: "claim_cleanup", sessionId }); if (claimWasGranted(claim.previous, claim.next, "cleanupClaimed")) await Promise.all([releaseCapture(), releasePlayback()]); }
    sessionRef.current = null; stableHistoryWriterRef.current = null; if (sessionId) await desktopApi.cancelDuplexVoiceSession(sessionId).catch(() => false);
  }, [dispatchSession, flushStableHistory, releaseCapture, releasePlayback]);
  const commitInterrupt = useCallback(async (reason: "user_speech" | "manual" | "stop_intent"): Promise<boolean> => {
    const active = activeResponseRef.current; const coordinator = coordinatorRef.current; if (!active || !coordinator) return false;
    setInterruptStats((value) => ({ ...value, attempts: value.attempts + 1 })); dispatchTurn({ type: "interrupt", reason });
    const accepted = await coordinator.interrupt(active, reason);
    if (accepted) setInterruptStats((value) => ({ ...value, accepted: value.accepted + 1 }));
    if (!accepted) dispatchTurn({ type: "terminal", terminal: "failed" });
    return accepted;
  }, []);
  const applyCandidate = useCallback((candidate: DuplexBargeInCandidateSnapshot): void => { const controller = playbackRef.current; const active = activeResponseRef.current; const coordinator = coordinatorRef.current; if (!controller || !active || !coordinator || !controller.snapshot.started) return; if (candidate.action === "commit_stop") { void desktopApi.recordDiagnostic({ traceId: sessionRef.current ?? active.sessionId, component: "duplex-voice", module: "voice/duplex/barge-in", operation: "voice.duplex.fast-stop", message: "Realtime voice fast stop decision", domain: "app", kind: "operation", level: "info", status: "completed", attributes: { responseId: active.responseId, decisionLatencyMs: candidate.stopDecisionLatencyMs, echoRisk: candidate.echoRisk, localSpeechMs: candidate.localSpeechMs } }); void commitInterrupt("stop_intent"); } else if (candidate.action === "duck" || candidate.action === "await_transcript") coordinator.candidate(active); else coordinator.revokeCandidate(active); setPlayback(controller.snapshot); }, [commitInterrupt]);

  useEffect(() => desktopApi.onDuplexVoiceEvents((events: DesktopDuplexVoiceEvent[]) => {
    const sessionId = sessionRef.current; if (!sessionId) return;
    for (const event of events) {
      if (event.sessionId !== sessionId) continue;
      if (projectionRef.current?.apply(event)) {
        const projected = projectionRef.current.messages;
        setHistory((current) => { const merged = new Map(current.map((message) => [message.id, message])); for (const message of projected) merged.set(message.id, message); return [...merged.values()]; });
        setOutputTranscript([...projectionRef.current.outputDrafts.values()].join(""));
        if (["input_transcript_completed", "response_transcript_completed", "interrupted"].includes(event.type)) { const writer = stableHistoryWriterRef.current; if (writer) void writer.enqueue().then((saved) => { if (!saved) setError("Realtime transcript history could not be persisted; it will be retried before the Session closes."); }); }
      }
      if (event.type === "uplink_credit") { captureRef.current?.updateUplinkCredit(event.credit); setFlowControl((current) => ({ paused: event.credit.frames === 0 || event.credit.bytes === 0 || event.credit.audioMs === 0, bufferedAudioMs: current.bufferedAudioMs })); }
      else if (event.type === "connection_state" && event.state === "reconnecting") { setReconnectCountdownSeconds(Math.max(1, Math.ceil((event.retryAfterMs ?? 0) / 1_000))); setConnectionNotice(`Realtime voice is reconnecting. Up to ${Math.ceil(event.lostAudioMs ?? 0)} ms of unconfirmed speech may be missing; audio recorded while disconnected is not replayed.`); }
      else if (event.type === "connection_state" && (event.state === "reconnected" || event.state === "connected")) { setReconnectCountdownSeconds(0); if (event.state === "reconnected") setConnectionNotice(`Realtime voice reconnected in segment ${(event.segmentId ?? 0) + 1}. Please repeat anything spoken during the interruption.`); }
      else if (event.type === "flow_control" && event.direction === "uplink") setFlowControl({ paused: event.paused, bufferedAudioMs: event.bufferedAudioMs });
      else if (event.type === "flow_control" && event.direction === "playback") setPlaybackFlowControl({ paused: event.paused, bufferedAudioMs: event.bufferedAudioMs });
      else if (event.type === "session_started") dispatchTurn({ type: "session_ready" });
      else if (event.type === "session_update_ack") setSessionUpdate({ updateId: event.updateId, status: event.status, changedFields: event.changedFields, ...(event.reason ? { reason: event.reason } : {}) });
      else if (event.type === "input_speech_started") { providerSpeechRef.current = true; applyCandidate(candidateRef.current.setProviderSpeech(true)); dispatchTurn({ type: "speech_started" }); }
      else if (event.type === "input_speech_stopped") { providerSpeechRef.current = false; applyCandidate(candidateRef.current.setProviderSpeech(false)); dispatchTurn({ type: "speech_stopped" }); }
      else if (event.type === "response_started") { candidateRef.current.reset(); playbackRef.current?.beginResponse(event.responseId, event.firstAudioSequence); activeResponseRef.current = null; dispatchTurn({ type: "response_started", responseId: event.responseId }); setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK); }
      else if (event.type === "response_audio_delta") { try { activeResponseRef.current = { sessionId, responseId: event.delta.responseId, itemId: event.delta.itemId, contentIndex: event.delta.contentIndex }; dispatchTurn({ type: "response_audio", responseId: event.delta.responseId, itemId: event.delta.itemId, contentIndex: event.delta.contentIndex }); playbackRef.current?.enqueue(event.delta); const snapshot = playbackRef.current?.snapshot ?? EMPTY_PLAYBACK; candidateRef.current.setPlayback(snapshot.started, snapshot.outputReferenceLevel); setPlayback(snapshot); } catch (playbackError) { void fail({ code: "audio", message: playbackError instanceof Error ? playbackError.message : String(playbackError), retryable: true }); } }
      else if (event.type === "response_audio_completed") { playbackRef.current?.finishResponse(event.responseId, event.finalSequence); activeResponseRef.current = null; dispatchTurn({ type: "response_completed", responseId: event.responseId }); setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK); void textSchedulerRef.current?.flush(); }
      else if (event.type === "interrupted") { candidateRef.current.reset(); playbackRef.current?.cancelResponse(event.responseId); activeResponseRef.current = null; dispatchTurn({ type: "interrupted" }); setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK); void textSchedulerRef.current?.flush(); }
      else if (event.type === "input_transcript_delta") { asrPrefixRef.current += event.delta.text; setInputTranscript((value) => value + event.delta.text); applyCandidate(candidateRef.current.observeAsrPrefix(asrPrefixRef.current)); }
      else if (event.type === "input_transcript_completed") { setInputTranscript(event.text); const intent = classifyDuplexSpeechIntent(event.text); const candidate = candidateRef.current.snapshot(); if (intent === "acknowledgement") playbackRef.current?.restoreVolume(); if (shouldCommitBargeIn({ intent, localSpeechMs: candidate.localSpeechMs, providerSpeechStarted: candidate.providerSpeech, candidateConfidence: candidate.confidence, playbackActive: Boolean(activeResponseRef.current && playbackRef.current?.snapshot.started) })) void commitInterrupt(intent === "stop" ? "stop_intent" : "user_speech"); localSpeechMsRef.current = 0; asrPrefixRef.current = ""; candidateRef.current.completeUtterance(); }
      else if (event.type === "response_transcript_completed") { /* M7 persists this stable text. */ }
      else if (event.type === "tool_call") void toolBridgeRef.current?.handle(event.call);
      else if (event.type === "usage_update") { setProviderUsage({ inputAudioMs: event.inputAudioMs, outputAudioMs: event.outputAudioMs, estimatedCostUsd: event.estimatedCostUsd }); setUsageWarning(`Realtime voice has used ${Math.round(Math.max(event.inputAudioMs, event.outputAudioMs) / 1_000)} seconds of its Session budget${event.estimatedCostUsd === null ? "; Provider cost is unavailable" : `; estimated cost $${event.estimatedCostUsd.toFixed(4)}`}.`); }
      else if (event.type === "diagnostic") { setRuntimeMetrics(event.metrics); temporaryDiagnosticsRef.current.record({ metrics: event.metrics }); void desktopApi.recordDiagnostic({ traceId: sessionId, component: "duplex-voice", module: "voice/duplex", operation: "voice.duplex.session", message: "Realtime voice Session metrics", domain: "app", kind: "operation", level: "info", status: "completed", visibility: "detail", attributes: event.metrics }); }
      else if (event.type === "completed" || event.type === "cancelled") {
        const terminal = event.type === "completed" ? "completed" : "cancelled"; const transition = dispatchSession({ type: "terminal", sessionId, terminal }); if (transition.previous.terminal) continue;
        if (stopStartedAtRef.current !== null) { setStopLatencyMs(Math.max(0, performance.now() - stopStartedAtRef.current)); stopStartedAtRef.current = null; }
        toolBridgeRef.current?.detach(); toolApprovalGateRef.current?.dispose(); textSchedulerRef.current?.cancel(); dispatchTurn({ type: "terminal", terminal });
        void (async () => { const historyClaim = dispatchSession({ type: "claim_history_flush", sessionId }); const historySaved = claimWasGranted(historyClaim.previous, historyClaim.next, "historyFlushClaimed") ? await flushStableHistory() : true; if (!historySaved) setError("Completed Realtime transcript history could not be persisted. Retry from the conversation before closing it."); if (sessionRef.current === sessionId) sessionRef.current = null; stableHistoryWriterRef.current = null; activeResponseRef.current = null; const cleanupClaim = dispatchSession({ type: "claim_cleanup", sessionId }); if (claimWasGranted(cleanupClaim.previous, cleanupClaim.next, "cleanupClaimed")) await Promise.all([releaseCapture(), releasePlayback()]); setMicrophonePaused(false); dispatchSession({ type: "reset" }); })();
      }
      else if (event.type === "failed") {
        const transition = dispatchSession({ type: "terminal", sessionId, terminal: "failed" }); if (transition.previous.terminal) continue;
        temporaryDiagnosticsRef.current.record({ reasonCode: event.error.code, metrics: { retryable: event.error.retryable } }); toolBridgeRef.current?.detach(); toolApprovalGateRef.current?.dispose(); textSchedulerRef.current?.cancel(); dispatchTurn({ type: "terminal", terminal: "failed" });
        void (async () => { const historyClaim = dispatchSession({ type: "claim_history_flush", sessionId }); const historySaved = claimWasGranted(historyClaim.previous, historyClaim.next, "historyFlushClaimed") ? await flushStableHistory() : true; if (sessionRef.current === sessionId) sessionRef.current = null; stableHistoryWriterRef.current = null; activeResponseRef.current = null; const cleanupClaim = dispatchSession({ type: "claim_cleanup", sessionId }); if (claimWasGranted(cleanupClaim.previous, cleanupClaim.next, "cleanupClaimed")) await Promise.all([releaseCapture(), releasePlayback()]); setFailure(event.error); setError(historySaved ? event.error.message : `${event.error.message} Completed Realtime transcript history could not be persisted.`); })();
      }
    }
  }), [applyCandidate, commitInterrupt, dispatchSession, fail, flushStableHistory, releaseCapture, releasePlayback]);

  useEffect(() => desktopApi.onLifecycleEvent((event) => {
    if (event.reason === "suspend" || event.reason === "lock-screen") void captureRef.current?.handleLifecycle("sleep");
    else if (event.reason === "resume" || event.reason === "unlock-screen") { void captureRef.current?.handleLifecycle("resume"); void playbackRef.current?.recover().then((recovered) => { setPlaybackRecovery(recovered ? null : "Audio output could not resume. Choose another output device or retry."); setPlayback(playbackRef.current?.snapshot ?? EMPTY_PLAYBACK); }); }
  }), []);

  useEffect(() => {
    const visible = (): void => { void captureRef.current?.handleLifecycle(document.visibilityState === "visible" ? "visible" : "hidden"); };
    const offline = (): void => { if (duplexLifecycleAction("offline") === "mark_offline") { captureRef.current?.updateUplinkCredit({ frames: 0, bytes: 0, audioMs: 0, acknowledgedSequence: -1 }); setConnectionNotice("Realtime voice is offline. Speech during the interruption will not be replayed; wait for reconnection, then repeat it."); } };
    const online = (): void => { if (duplexLifecycleAction("online") === "mark_online") setConnectionNotice("Network restored. Realtime voice is reconnecting…"); };
    const pagehide = (): void => { if (duplexLifecycleAction("pagehide") !== "dispose_session") return; const sessionId = sessionRef.current; void flushStableHistory().finally(() => { void releaseCapture(); void releasePlayback(); if (sessionId) void desktopApi.disposeDuplexVoiceSession(sessionId); }); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("offline", offline); window.addEventListener("online", online); window.addEventListener("pagehide", pagehide);
    return () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("offline", offline); window.removeEventListener("online", online); window.removeEventListener("pagehide", pagehide); };
  }, [flushStableHistory, releaseCapture, releasePlayback]);
  useEffect(() => {
    const refresh = async (): Promise<void> => {
      const outputs = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((device) => device.kind === "audiooutput"); setOutputDevices(outputs);
      const selected = optionsRef.current.outputDeviceId ?? "";
      if (selected && !outputs.some((device) => device.deviceId === selected) && playbackRef.current) {
        const recovered = await playbackRef.current.switchOutputDevice("");
        if (recovered) optionsRef.current.onOutputDeviceFallback?.();
        setOutputDeviceError(recovered ? "The selected output disconnected; Realtime voice moved to the system default output." : "The selected output disconnected and the system default output could not be activated.");
        setPlayback(playbackRef.current.snapshot);
      }
    };
    const changed = (): void => { void refresh(); }; navigator.mediaDevices.addEventListener?.("devicechange", changed); void refresh();
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", changed);
  }, []);

  useEffect(() => { playbackRef.current?.setVolume(options.volume ?? 1); if (playbackRef.current) setPlayback(playbackRef.current.snapshot); }, [options.volume]);
  useEffect(() => { if (reconnectCountdownSeconds <= 0) return; const timer = window.setTimeout(() => setReconnectCountdownSeconds((value) => Math.max(0, value - 1)), 1_000); return () => window.clearTimeout(timer); }, [reconnectCountdownSeconds]);

  useEffect(() => {
    if (phase !== "active" && phase !== "recovering") return;
    const timer = window.setInterval(() => {
      const sessionId = sessionRef.current; const controller = playbackRef.current;
      if (!sessionId || !controller) return;
      desktopApi.sendDuplexVoicePlaybackAck(controller.acknowledgement(sessionId));
      const snapshot = controller.snapshot; if (snapshot.outputState === "suspended") setPlaybackRecovery("Audio output is paused. Retry playback or choose another output device."); setPlayback(snapshot);
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  const start = useCallback(async (takeoverSessionId?: string): Promise<boolean> => {
    if (!['idle', 'failed'].includes(sessionStateRef.current.phase)) return false;
    const voiceSessionId = `voice-duplex-${crypto.randomUUID()}`; dispatchSession({ type: "start_requested", sessionId: voiceSessionId });
    setError(null); setFailure(null); failureRef.current = null; setDeviceSwitchError(null); setOutputDeviceError(null); setPlaybackRecovery(null); setPlaybackDegradation(null); setUsageWarning(null); setRuntimeMetrics(null); setProviderUsage(null); setInterruptStats({ attempts: 0, accepted: 0 }); setStopLatencyMs(null); setSessionUpdate(null); setInputTranscript(""); setVad(null); setQuality(null); setConstraints(null); setFlowControl({ paused: false, bufferedAudioMs: 0 }); setPlaybackFlowControl({ paused: false, bufferedAudioMs: 0 });
    try {
      const occupied = await desktopApi.getDuplexVoiceOccupancy();
      if (occupied.occupied && !occupied.ownedByCaller && !takeoverSessionId) {
        setOccupancy(occupied);
        throw new Error(`Realtime conversation is active in ${occupied.ownerLabel ?? "another window"}.`);
      }
      const [policy, readiness, threadSnapshot] = await runDuplexStartupStage("checking_readiness", () => Promise.all([desktopApi.getMyDrSaiAgentModelPolicy(), desktopApi.getDuplexVoiceReadiness(), optionsRef.current.threadId ? desktopApi.getThreadSnapshot(optionsRef.current.threadId).catch(() => null) : Promise.resolve(null)]));
      if (!readiness.available || !readiness.capabilities) throw new Error(readiness.message);
      const capabilities = readiness.capabilities;
      const ref = policy.effective_realtime_voice_ref ?? policy.realtime_voice_model?.ref;
      if (!ref) throw new Error("The current Agent has no explicit Realtime voice model.");
      if (ref.provider_id !== readiness.providerId || ref.model_id !== readiness.modelId) throw new Error("Realtime voice model binding changed. Check readiness again.");
      const sessionContext = buildDuplexSessionContext(optionsRef.current.instructions, threadSnapshot);
      const startRequest = { protocolVersion: 2 as const, sessionId: voiceSessionId, providerId: ref.provider_id, modelId: ref.model_id, inputEncoding: "pcm_s16le" as const, inputSampleRateHz: 24_000, outputEncoding: "pcm_s16le" as const, outputSampleRateHz: 24_000, channels: 1 as const, languageHint: optionsRef.current.languageHint, voice: optionsRef.current.voice, instructions: sessionContext.instructions, enableInputTranscription: capabilities.supportsInputTranscription, enableOutputTranscription: capabilities.supportsOutputTranscription, enableServerVad: capabilities.supportsServerVad, enableToolCalling: Boolean(optionsRef.current.enableToolCalling && capabilities.supportsToolCalling), autoRecovery: optionsRef.current.autoRecovery !== false };
      startRequestRef.current = startRequest;
      const capture = new DuplexCaptureController({ mediaDevices: navigator.mediaDevices, createAudioContext: () => new AudioContext(), createWorkletNode: (context, name, nodeOptions) => new AudioWorkletNode(context, name, nodeOptions), now: () => performance.now(), workletModuleUrl }, {
        sessionId: voiceSessionId, deviceId: optionsRef.current.deviceId, targetSampleRateHz: 24_000, initialUplinkCredit: { frames: 0, bytes: 0, audioMs: 0, acknowledgedSequence: -1 },
        onChunk: (chunk) => desktopApi.sendDuplexVoiceAudioChunk(chunk), onState: (state: DuplexCaptureState) => { setDeviceSwitching(state === "switching_device"); if (state === "recovering") dispatchSession({ type: "recovering", sessionId: voiceSessionId }); },
        onError: (captureError) => { void fail(captureError); }, onDevices: setDevices, onConstraints: setConstraints, onQuality: setQuality, onVadSignal: (signal) => { setVad(signal); localSpeechMsRef.current = signal.speechCandidate ? localSpeechMsRef.current + 40 : 0; const playbackSnapshot = playbackRef.current?.snapshot; candidateRef.current.setPlayback(Boolean(activeResponseRef.current && playbackSnapshot?.started), playbackSnapshot?.outputReferenceLevel ?? 0); applyCandidate(candidateRef.current.observeLocal(signal, 40)); },
        onDeviceSwitchError: (switchError) => setDeviceSwitchError(switchError.message),
        onRecoveryRequired: () => { dispatchSession({ type: "recovering", sessionId: voiceSessionId }); },
      });
      captureRef.current = capture;
      await runDuplexStartupTransaction({
        prepareCapture: () => capture.prepareFromUserGesture(),
        preparePlayback: async () => {
          setOutputDevices((await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((device) => device.kind === "audiooutput"));
          playbackRef.current = new DuplexPlaybackController(new BrowserPcmPlaybackSink(), { onGap: (gap) => { const message = `Realtime audio skipped missing frame${gap.fromSequence === gap.toSequence ? "" : "s"} ${gap.fromSequence}-${gap.toSequence}.`; setPlaybackDegradation(message); void desktopApi.recordDiagnostic({ traceId: voiceSessionId, component: "duplex-voice", module: "voice/duplex", operation: "voice.duplex.playback-gap", message, domain: "app", kind: "operation", level: "warn", status: "completed", visibility: "detail", attributes: { responseId: gap.responseId, fromSequence: gap.fromSequence, toSequence: gap.toSequence } }); } });
          playbackRef.current.setVolume(optionsRef.current.volume ?? 1, 0);
          if (optionsRef.current.outputDeviceId && !await playbackRef.current.switchOutputDevice(optionsRef.current.outputDeviceId)) { setOutputDeviceError("The selected output is unavailable; Realtime voice is using the system default output."); optionsRef.current.onOutputDeviceFallback?.(); }
          const recovered = await playbackRef.current.recover();
          if (!recovered) setPlaybackRecovery("Audio output is paused. Retry playback or choose another output device.");
          return recovered;
        },
        startProvider: () => takeoverSessionId ? desktopApi.takeOverDuplexVoiceSession({ expectedSessionId: takeoverSessionId, session: startRequest }) : desktopApi.startDuplexVoiceSession(startRequest),
        activateCapture: async (started) => {
          setOccupancy(null); sessionRef.current = voiceSessionId; projectionRef.current = new DuplexTranscriptProjection(voiceSessionId); stableHistoryWriterRef.current = optionsRef.current.threadId ? new DuplexStableHistoryWriter({ threadId: optionsRef.current.threadId, projection: projectionRef.current, append: (request) => desktopApi.appendDuplexVoiceHistory(request) }) : null;
          const approvalGate = optionsRef.current.toolApproval ?? new DesktopDuplexToolApprovalGate(desktopApi, voiceSessionId); toolApprovalGateRef.current = approvalGate instanceof DesktopDuplexToolApprovalGate ? approvalGate : null;
          toolBridgeRef.current = new DuplexToolBridge({ executor: optionsRef.current.toolExecutor ?? { execute: async () => { throw new Error("This Realtime tool is not connected to an approved Desktop executor."); } }, approval: approvalGate, isSessionActive: () => sessionRef.current === voiceSessionId, submitResult: (callId, output) => desktopApi.submitDuplexVoiceToolResult({ sessionId: voiceSessionId, callId, output }), onStatus: (call, status, detail) => {
            setToolStatuses((current) => ({ ...current, [call.callId]: { status, ...(detail ? { detail } : {}) } }));
            const threadId = optionsRef.current.threadId; if (!threadId) return;
            const id = `duplex:${voiceSessionId}:assistant:tool:${call.callId}`; const expectedRevision = toolRevisionRef.current.get(id) ?? 0; const revision = expectedRevision + 1; toolRevisionRef.current.set(id, revision);
            const partStatus = status === "waiting_approval" ? "pending" : status === "running" ? "running" : status === "completed" ? "completed" : status === "cancelled" || status === "rejected" || status === "detached" ? "cancelled" : "error";
            const eventStatus = status === "waiting_approval" ? "started" : status === "running" ? "running" : status === "completed" ? "completed" : "failed";
            const timestamp = new Date().toISOString(); const argumentSummary = summarizeToolArguments(call.arguments); const event = { id: call.callId, kind: "tool_call" as const, title: call.name, status: eventStatus as "started" | "running" | "completed" | "failed", content: `${argumentSummary}${detail ? `\n${detail}` : ""}`, toolName: call.name, timestamp };
            historyWriteRef.current = historyWriteRef.current.catch(() => undefined).then(async () => { await desktopApi.appendDuplexVoiceHistory({ threadId, messages: [{ id, role: "assistant", content: "", revision, expectedRevision, statusContent: detail, toolTimeline: [event], parts: [{ id: `tool:${call.callId}`, type: "tool", event, status: partStatus }] }] }); }).catch(() => { setError("Realtime tool timeline could not be persisted; the tool result remains isolated from transcript content."); });
          } });
          coordinatorRef.current = new DuplexBargeInCoordinator({ duckLocalPlayback: () => playbackRef.current?.duck(0.25, 100), restoreLocalPlayback: () => playbackRef.current?.restoreVolume(100), stopLocalPlayback: (responseId) => playbackRef.current?.cancelResponse(responseId) ?? 0, clearQueuedOutput: (responseId) => { playbackRef.current?.cancelResponse(responseId); }, interruptProvider: (request) => desktopApi.interruptDuplexVoiceSession(request), onTransaction: (transaction) => { void desktopApi.recordDiagnostic({ traceId: transaction.interruptId, component: "duplex-voice", module: "voice/duplex/barge-in", operation: "voice.duplex.interrupt", message: "Realtime voice interrupt transaction", domain: "app", kind: "operation", level: transaction.outcome === "timeout" || transaction.outcome === "rejected" ? "warn" : "info", status: ["committed", "reverted", "rejected", "timeout", "superseded"].includes(transaction.outcome) ? "completed" : "running", attributes: { responseId: transaction.responseId, outcome: transaction.outcome, reason: transaction.reason, playedAudioMs: transaction.playedAudioMs } }); } });
          textSchedulerRef.current = new DuplexTextInputScheduler({ isResponseActive: () => Boolean(activeResponseRef.current), interrupt: () => commitInterrupt("manual"), send: (item) => desktopApi.submitDuplexVoiceTextInput({ sessionId: voiceSessionId, itemId: item.id, text: item.text }), onPendingChange: setPendingText });
          capture.updateUplinkCredit(started.uplinkCredit); return capture.activate();
        },
        releaseCapture,
        releasePlayback,
        cancelProvider: () => desktopApi.cancelDuplexVoiceSession(voiceSessionId),
        onStage: (stage) => { dispatchSession({ type: "startup_stage", sessionId: voiceSessionId, stage }); },
      });
      setMicrophonePaused(false); dispatchSession({ type: "started", sessionId: voiceSessionId }); return true;
    } catch (startError) {
      toolBridgeRef.current?.detach(); toolBridgeRef.current = null; toolApprovalGateRef.current?.dispose(); toolApprovalGateRef.current = null; coordinatorRef.current = null; projectionRef.current = null; stableHistoryWriterRef.current = null; activeResponseRef.current = null;
      await Promise.all([releaseCapture(), releasePlayback()]); sessionRef.current = null;
      const existingFailure = failureRef.current;
      const startupFailure = existingFailure ?? classifyDuplexStartupFailure(sessionStateRef.current.startupStage ?? "checking_readiness", startError, voiceSessionId);
      failureRef.current = startupFailure;
      dispatchSession({ type: "startup_failed", sessionId: voiceSessionId }); setFailure(startupFailure); setError(startupFailure.message); return false;
    }
  }, [applyCandidate, commitInterrupt, dispatchSession, fail, releaseCapture, releasePlayback]);
  const takeOver = useCallback(async (): Promise<boolean> => {
    const expectedSessionId = occupancy?.sessionId;
    if (!expectedSessionId) return false;
    return start(expectedSessionId);
  }, [occupancy?.sessionId, start]);
  const declineTakeOver = useCallback((): void => { setOccupancy(null); setError(null); dispatchSession({ type: "reset" }); }, [dispatchSession]);

  const stop = useCallback(async (): Promise<boolean> => { const sessionId = sessionRef.current; if (!sessionId) return false; stopStartedAtRef.current = performance.now(); dispatchSession({ type: "end_requested", sessionId }); dispatchTurn({ type: "stop" }); coordinatorRef.current?.manualOverride(); await captureRef.current?.pause(); setMicrophonePaused(true); return desktopApi.stopDuplexVoiceSession(sessionId); }, [dispatchSession]);
  const cancel = useCallback(async (): Promise<boolean> => { const sessionId = sessionRef.current; if (!sessionId) return false; const terminal = dispatchSession({ type: "terminal", sessionId, terminal: "cancelled" }); if (terminal.previous.terminal) return terminal.previous.terminal === "cancelled"; toolBridgeRef.current?.detach(); toolApprovalGateRef.current?.dispose(); textSchedulerRef.current?.cancel(); const historyClaim = dispatchSession({ type: "claim_history_flush", sessionId }); const historySaved = claimWasGranted(historyClaim.previous, historyClaim.next, "historyFlushClaimed") ? await flushStableHistory() : true; const cleanupClaim = dispatchSession({ type: "claim_cleanup", sessionId }); if (claimWasGranted(cleanupClaim.previous, cleanupClaim.next, "cleanupClaimed")) await Promise.all([releaseCapture(), releasePlayback()]); const result = await desktopApi.cancelDuplexVoiceSession(sessionId); sessionRef.current = null; stableHistoryWriterRef.current = null; setMicrophonePaused(false); dispatchSession({ type: "reset" }); if (!historySaved) setError("Completed Realtime transcript history could not be persisted."); return result; }, [dispatchSession, flushStableHistory, releaseCapture, releasePlayback]);
  const finishTurn = useCallback(async (): Promise<boolean> => { const sessionId = sessionRef.current; if (!sessionId || microphonePaused) return false; return desktopApi.finishDuplexVoiceTurn(sessionId); }, [microphonePaused]);
  const pauseMicrophone = useCallback(async (): Promise<boolean> => { const paused = await captureRef.current?.pause() ?? false; if (paused) setMicrophonePaused(true); return paused; }, []);
  const resumeMicrophone = useCallback(async (): Promise<boolean> => { const resumed = await captureRef.current?.resumePaused() ?? false; if (resumed) setMicrophonePaused(false); return resumed; }, []);
  const sendText = useCallback(async (text: string, strategy: DuplexTextSendStrategy = "after_response"): Promise<boolean> => { if (!sessionRef.current || sessionStateRef.current.phase !== "active") return false; return textSchedulerRef.current?.submit(text, strategy) ?? false; }, []);
  const updateInstructions = useCallback(async (instructions: string): Promise<boolean> => { const current = startRequestRef.current; if (!current || sessionStateRef.current.phase !== "active" || typeof instructions !== "string" || instructions.length > 32_000) return false; const updateId = `update-${crypto.randomUUID()}`; setSessionUpdate({ updateId, status: "pending", changedFields: ["instructions"] }); const next = { ...current, updateId, instructions }; const sent = await desktopApi.updateDuplexVoiceSession(next); if (sent) startRequestRef.current = next; else setSessionUpdate({ updateId, status: "rejected", changedFields: ["instructions"], reason: "The active Session rejected the update request." }); return sent; }, []);
  const cancelPendingText = useCallback((): string | null => textSchedulerRef.current?.cancel()?.text ?? null, []);
  const switchInputDevice = useCallback(async (deviceId: string): Promise<boolean> => { const capture = captureRef.current; if (!capture || sessionStateRef.current.phase !== "active") return false; setDeviceSwitchError(null); setDeviceSwitching(true); try { return await capture.switchDevice(deviceId); } finally { setDeviceSwitching(false); } }, []);
  const switchOutputDevice = useCallback(async (sinkId: string): Promise<boolean> => { const controller = playbackRef.current; if (!controller || sessionStateRef.current.phase !== "active") return false; setOutputDeviceError(null); setOutputDeviceSwitching(true); try { const switched = await controller.switchOutputDevice(sinkId); if (!switched) setOutputDeviceError("The selected audio output could not be activated; the previous output remains in use."); setPlayback(controller.snapshot); return switched; } finally { setOutputDeviceSwitching(false); } }, []);
  const retryPlayback = useCallback(async (): Promise<boolean> => { const controller = playbackRef.current; if (!controller) return false; const recovered = await controller.recover(); setPlaybackRecovery(recovered ? null : "Audio output could not resume. Choose another output device or retry."); setPlayback(controller.snapshot); return recovered; }, []);
  const setVolume = useCallback((volume: number): void => { playbackRef.current?.setVolume(volume); if (playbackRef.current) setPlayback(playbackRef.current.snapshot); }, []);
  const enableTemporaryDiagnostics = useCallback((durationMs = 10 * 60_000): number => { const expiresAt = temporaryDiagnosticsRef.current.enable(durationMs); if (temporaryDiagnosticsTimerRef.current !== null) window.clearTimeout(temporaryDiagnosticsTimerRef.current); temporaryDiagnosticsTimerRef.current = window.setTimeout(() => { temporaryDiagnosticsRef.current.disable(); temporaryDiagnosticsTimerRef.current = null; setTemporaryDiagnosticsExpiresAt(null); }, durationMs); setTemporaryDiagnosticsExpiresAt(expiresAt); return expiresAt; }, []);
  const disableTemporaryDiagnostics = useCallback((): void => { if (temporaryDiagnosticsTimerRef.current !== null) window.clearTimeout(temporaryDiagnosticsTimerRef.current); temporaryDiagnosticsTimerRef.current = null; temporaryDiagnosticsRef.current.disable(); setTemporaryDiagnosticsExpiresAt(null); }, []);
  const exportTemporaryDiagnostics = useCallback(() => temporaryDiagnosticsRef.current.export(), []);
  const slo = useMemo(() => buildDuplexSloSnapshot({ metrics: runtimeMetrics, stopLatencyMs, interruptAttempts: interruptStats.attempts, interruptAccepted: interruptStats.accepted, underruns: playback.underruns, usage: providerUsage }), [interruptStats, playback.underruns, providerUsage, runtimeMetrics, stopLatencyMs]);

  useEffect(() => () => { if (temporaryDiagnosticsTimerRef.current !== null) window.clearTimeout(temporaryDiagnosticsTimerRef.current); temporaryDiagnosticsRef.current.disable(); toolApprovalGateRef.current?.dispose(); void releaseCapture(); void releasePlayback(); const sessionId = sessionRef.current; if (sessionId) void desktopApi.disposeDuplexVoiceSession(sessionId); }, [releaseCapture, releasePlayback]);
  return { phase, startupStage, error, failure, occupancy, devices, outputDevices, constraints, quality, deviceSwitching, deviceSwitchError, outputDeviceSwitching, outputDeviceError, playbackRecovery, playbackDegradation, connectionNotice, reconnectCountdownSeconds, sessionUpdate, microphonePaused, vad, inputTranscript, outputTranscript, history, toolStatuses, pendingText, usageWarning, flowControl, playbackFlowControl, playback, turn, slo, temporaryDiagnosticsExpiresAt, start, takeOver, declineTakeOver, finishTurn, stop, cancel, pauseMicrophone, resumeMicrophone, interrupt: commitInterrupt, sendText, cancelPendingText, updateInstructions, switchInputDevice, switchOutputDevice, retryPlayback, setVolume, enableTemporaryDiagnostics, disableTemporaryDiagnostics, exportTemporaryDiagnostics };
}
