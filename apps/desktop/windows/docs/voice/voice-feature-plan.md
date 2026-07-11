# Windows App Voice Feature Plan

Last updated: 2026-07-11

## Goal

Build the Windows desktop voice feature in four incremental stages:

1. Voice-to-text input in the chat composer.
2. Main-process voice APIs and transcript handoff integration.
3. Configurable transcription runtime.
4. Assistant text-to-speech playback.

The first useful product target is "voice turns into reviewed text input", not a full duplex voice assistant. This keeps the feature aligned with the existing channel/context/attachment architecture and preserves the current explicit review boundary before anything enters chat.

## Current Implementation Snapshot

The Windows app already has a voice input skeleton:

- `voice-input` channel adapter exists in `src/main/channelAdapters.ts`.
- Local transcript handoff is supported through workspace-local `.drsai/voice-context.json`, explicit `voiceTranscriptPath`, plain text transcript files, and timed transcript files such as `.srt` and `.vtt`.
- Imported voice records become `voice_transcript` channel context items and are recorded as reviewed inbound events.
- Attach/Route to chat remains explicit; transcript content does not enter the composer or model call silently.
- Audio file metadata import exists for `.wav`, `.mp3`, `.flac`, `.m4a`, and `.ogg`, but it only reads bounded local headers.
- User-triggered composer microphone recording exists and routes to typed mock-local transcription when the desktop bridge is available. Device selection, provider/local-Whisper transcription runtime, cancellable provider calls, transcript chips, and TTS are not implemented.

Important existing files:

- `src/main/channelAdapters.ts`: voice adapter, transcript import, audio metadata summaries.
- `src/shared/desktopApi.ts`: shared channel adapter and context item contracts.
- `src/preload/index.ts`: renderer-to-main API bridge.
- `src/renderer/src/components/ChatWorkspace.tsx`: composer, attachment chips, file/folder input controls.
- `src/main/chat.ts`: chat request validation, attachment context assembly, gateway request.
- `docs/smart-chat-bar-roadmap.md`: current voice status and follow-up gaps.
- `docs/chatbar-capability-checklist.md`: verification checklist and supported media boundaries.

## Stage 1: Composer Recording and Voice-To-Text Input

Stage 1 status: implemented on 2026-07-11. The composer places microphone and send controls to the right of the Thinking selector, records only after explicit user action, and replaces the text area with a live recording strip while capturing. Its waveform uses `AudioContext` and `AnalyserNode` time-domain samples: a noise gate keeps silence flat, RMS/peak amplitude controls bar height, and each new sample enters on the right while history moves left. The synthetic CSS pulse animation has been removed. Recorded audio continues through the typed Stage 2 transcription bridge, with the current mock-local runtime clearly disclosed until Stage 3 connects a real transcription engine.

Objective: Add a visible microphone entry point in the chat composer that records user speech, transcribes it, and inserts reviewed text into the input.

Scope:

- Add a Mic button to `ChatWorkspace`.
- Use `navigator.mediaDevices.getUserMedia({ audio: true })` and `MediaRecorder` in the renderer for the first implementation.
- Track recording states: `idle`, `requesting_permission`, `recording`, `processing`, `failed`.
- Support click-to-record and stop-to-transcribe first; push-to-talk can follow after the basic flow is stable.
- Show duration, cancel, retry, and error states.
- Render a live, amplitude-driven waveform only when microphone input exceeds the noise floor; append new samples on the right so history moves from right to left.
- After transcription, insert text into the composer by default.
- Offer an optional path to attach the transcript as a reviewed context chip instead of directly inserting text.

Implementation notes:

- Keep recording user-triggered only. No background wake word or passive listening.
- Stop all `MediaStreamTrack`s on cancel, finish, navigation, unmount, and app blur where appropriate.
- Keep UI controls compact and consistent with the existing composer controls.
- Prefer `Mic`, `MicOff`, `CircleStop`, or similar lucide icons.
- Add renderer feature detection for `mediaDevices` and `MediaRecorder` with a graceful unavailable state.

Acceptance criteria:

- User can start and stop a recording from the composer.
- Permission denial is shown clearly without crashing the composer.
- Cancelled recordings are discarded.
- Successful transcription fills the composer or creates a visible transcript chip.
- No recording occurs before explicit user action.

## Stage 2: Main-Process Voice API and Transcript Handoff

Stage 2 status: implemented for typed mock-local IPC on 2026-07-10 and tightened on 2026-07-11. The renderer/preload/main contract now exposes `transcribeVoiceRecording` and `writeVoiceTranscriptHandoff`, the composer resolves transcription through the injected callback or `window.openDrSai.transcribeVoiceRecording`, validates registered workspace access in the main process, bounds recording bytes/duration/transcript size, uses a local mock transcription runtime with explicit no-network/no-provider disclosure, and writes successful transcripts to the existing workspace-local `.drsai/voice-context.json` handoff for `voice-input` review. Real gateway/provider or local Whisper transcription remains Stage 3 work.

Objective: Add typed desktop voice APIs that connect the renderer recording flow to a main-process transcription service while reusing the existing `voice-input` handoff model.

Scope:

- Add shared API types in `src/shared/desktopApi.ts`, for example:
  - `DesktopVoiceTranscriptionRequest`
  - `DesktopVoiceTranscriptionResult`
  - `DesktopVoiceTranscriptHandoffResult`
- Add preload bridge methods in `src/preload/index.ts`, for example:
  - `transcribeVoiceRecording(request)`
  - `writeVoiceTranscriptHandoff(request)`
- Add main IPC handlers in `src/main/index.ts`.
- Add a focused `src/main/voice.ts` module instead of expanding `channelAdapters.ts`.
- Persist successful transcript records into `.drsai/voice-context.json` or return a transcript object that can be converted into the same reviewed `voice_transcript` shape.
- Reuse `importChannelContext({ adapterId: "voice-input" })` where practical, so Channels and composer behavior stay consistent.

Data contract:

- Inputs should include audio bytes or a temporary recording reference, MIME type, duration, language hint, workspace path, and user-visible source label.
- Outputs should include transcript text, language, duration, confidence when available, source path or in-memory source id, provider/runtime id, created time, and truncation flags.
- Handoff records should be bounded and workspace-local.

Security and privacy:

- Reject paths outside the workspace when reading or writing handoff artifacts.
- Avoid symlink traversal.
- Cap recording duration and upload size.
- Do not store raw audio by default after transcription unless the user enables it or the transcript handoff needs a reviewed local artifact.
- Include provider/runtime disclosure in UI before transcription if audio leaves the machine.

Acceptance criteria:

- Renderer can call a typed preload API for transcription.
- Main process validates request shape, workspace path, size, and duration.
- Successful transcript can be imported through the existing `voice-input` channel path.
- Failed transcription returns a user-actionable error without losing typed composer state.

## Stage 3: Transcription Runtime

Objective: Provide a practical transcription backend first, then make room for offline transcription.

Recommended MVP:

- Add a gateway-backed transcription endpoint, such as `/v1/audio/transcriptions`, or an OpenAI/HepAI-compatible provider bridge behind existing authentication/configuration.
- Reuse existing auth and gateway readiness checks where possible.
- Keep runtime choice explicit in settings or model/provider config.
- Return normalized transcript output to the Stage 2 API.

Follow-up offline option:

- Evaluate whisper.cpp or faster-whisper as a local runtime after the online/provider MVP works.
- Plan model download, versioning, storage location, GPU/CPU selection, cancellation, and packaging size.
- Add a runtime health check and clear unavailable states.

Runtime policy:

- Provider runtime: fast MVP, smaller app footprint, requires network/provider availability.
- Local runtime: better privacy and offline use, but higher packaging and performance complexity.
- The app should expose which runtime will process audio before the first transcription in a session.

Acceptance criteria:

- MVP runtime can transcribe a short recording into Chinese and English text.
- Runtime errors are separated into permission, network, auth, size, unsupported format, timeout, and provider failure where possible.
- Transcription requests are cancellable from the UI.
- Verification covers typed API, mock runtime, and at least one fixture path without requiring live network in normal CI.

## Stage 4: Text-To-Speech Playback

Objective: Add assistant response playback after voice-to-text is stable.

Scope:

- Add per-message "read aloud" controls for assistant messages.
- Add stop/pause/resume controls.
- Add optional "auto-read assistant replies" setting.
- Start with browser/system `speechSynthesis` where acceptable.
- Later add provider TTS for higher quality voices and consistent cross-machine behavior.

Playback behavior:

- Do not auto-play by default in the MVP.
- Cancel current playback when the user starts a new playback, edits input, or leaves the thread.
- For streaming assistant responses, wait for message completion in the first implementation.
- Preserve language-aware voice selection when available.

Acceptance criteria:

- User can play and stop an assistant message.
- Playback state is visible and does not block typing or sending.
- Auto-read is opt-in.
- TTS unavailable state is graceful on systems without usable voices.

## Cross-Cutting Design Rules

- The microphone must never start without explicit user action.
- The app must show recording and processing state clearly.
- The user should know whether transcription is local or provider-backed.
- Transcript content should remain visible and editable before chat submission.
- Reuse existing `voice-input`, channel inbound event, context chip, and attachment context paths.
- Keep raw audio retention opt-in or short-lived.
- Bound duration, bytes, transcript length, and handoff file size.
- Preserve current workspace-local and no-symlink safety posture.

## Suggested Verification

Stage 1:

- `npm run typecheck:web`
- `npm run verify:voice-feature`
- `npm run build`
- Renderer mock test or visual verifier covering disabled, recording, processing, and error states.

Stage 2:

- `npm run typecheck:node`
- `npm run typecheck:web`
- Add verifier assertions for new desktop API types, preload bridge, IPC handler, and voice handoff shape.

Stage 3:

- Mock transcription runtime verifier.
- Fixture-based transcription response normalization test.
- Gateway/provider live smoke test should be optional, not required for standard CI.

Stage 4:

- Renderer state tests for play/stop/auto-read disabled states.
- Mock `speechSynthesis` verifier for unavailable and successful playback paths.

Existing related verifiers to keep green:

- `npm run verify:channel-adapters`
- `npm run verify:channel-adapter-runtime-fixtures`
- `npm run verify:chatbar-checklist`
- `npm run verify:ui`
- `npm run verify:visual`

## Proposed Implementation Order

1. Document and type the target API contracts.
2. Add mock transcription behavior in `mockDesktopApi.ts` so UI can be developed without a runtime.
3. Build the composer Mic UI and recording state machine.
4. Add main/preload IPC and `src/main/voice.ts`.
5. Wire the mock runtime to return transcripts and handoff records.
6. Add provider/gateway transcription runtime.
7. Route successful transcripts into composer insertion and optional reviewed context chips.
8. Add TTS controls after STT is reliable.

## Current Problem Analysis (2026-07-11)

The current implementation proves microphone capture and desktop IPC, but it is not yet an end-to-end speech feature. The primary gap is intentional: `src/main/voice.ts` always returns `runtimeId: "mock-local"`. It validates recording metadata and generates placeholder text, but it never decodes or recognizes the recorded audio. This explains the common symptom where recording and the waveform work while the inserted composer text does not match what the user said.

Related limitations that will surface as the feature moves beyond the mock runtime:

- The entire recording is converted to base64 in the renderer and copied over IPC. Base64 adds roughly one third to the payload size and creates extra renderer/main-process memory copies.
- The request is tied to a registered `workspacePath`, although dictation is fundamentally a composer capability and should also work before a folder is selected.
- There is no transcription request ID or cancellation API. Stopping capture does not let the user cancel an in-flight provider or local inference task.
- `MediaRecorder` output varies by Chromium/Windows codec support. A provider may reject WebM/Opus even though recording succeeded, so normalization or an explicit accepted-format contract is required.
- The UI has no microphone selector, input-level diagnostic, transcript review state, retry action, or distinction between capture failure and transcription failure.
- Runtime settings and health are absent. Users cannot see whether audio will be processed by a provider or locally, whether the runtime is ready, or whether a local model is installed.
- The current verifiers prove wiring through source assertions. They do not feed deterministic audio into a real decoder/transcriber or test cancellation and timeout behavior.

If the reported problem is different from placeholder or incorrect transcript text, capture the exact visible error, whether the waveform reacts, the selected workspace state, Windows microphone privacy state, and the result of a five-second recording. Those observations separate capture, codec, IPC, runtime, and UI-state failures.

## Complete Voice Architecture

Use one lifecycle across capture, transcription, review, and playback:

`idle -> requesting_permission -> recording -> encoding -> transcribing -> reviewing -> inserted`

Failure and control transitions:

- `recording -> cancelled -> idle`
- `encoding/transcribing -> cancelling -> idle`
- any active state -> `failed`, preserving the recording temporarily for retry when privacy policy allows it
- `failed -> retrying` without asking the user to record again when the audio is still valid

Ownership boundaries:

- Renderer: device selection, capture controls, live waveform, elapsed time, review/edit UI, and playback controls.
- Preload/shared API: typed request IDs, progress events, cancellation, runtime status, device-safe settings, and normalized error codes.
- Main process: temporary-file lifecycle, request registry, size/duration validation, codec probing/normalization, runtime selection, cancellation, and provider credential isolation.
- `VoiceRuntime` adapters: `gateway-provider`, `local-whisper`, and deterministic `fixture` runtime for tests. The existing `mock-local` adapter remains development-only.
- Existing channel handoff: optional persistence of reviewed transcript text only. Raw audio is deleted by default and never written into the workspace unless explicitly requested.

Recommended contracts:

- `startVoiceTranscription(request) -> { requestId }`
- `onVoiceTranscriptionEvent(event)` with `accepted`, `progress`, `partial`, `completed`, `failed`, and `cancelled`
- `cancelVoiceTranscription(requestId)`
- `getVoiceRuntimeStatus()` returning runtime, readiness, disclosure, supported MIME types, languages, and local-model state
- `getVoiceSettings()` / `saveVoiceSettings()` for runtime, language mode, microphone device ID, retention, and TTS preferences

Prefer a main-process-owned temporary audio file or streamed chunk channel over base64 for production. The renderer should transfer bounded binary chunks, then release its Blob after the main process acknowledges ownership. Keep the file under the application temp directory with a random name, restrictive access, a short TTL, and startup cleanup for abandoned files.

## Delivery Plan

### Phase A: Capture Hardening

Deliverables:

- Extract capture and waveform behavior from `ChatWorkspace` into `useVoiceCapture` and focused UI components.
- Add explicit cancel, retry, permission help, maximum-duration stop, device-disconnected handling, and selected microphone support.
- Detect the actual MIME type and expose it to the runtime before recording; reject unsupported combinations early.
- Preserve existing typed composer content while recording and insert the reviewed transcript at the current selection.
- Add `ResizeObserver`-backed waveform sampling density if the CSS-only responsive distribution is insufficient at extreme widths.

Exit criteria:

- Real-device tests pass for permission allow/deny, silence, normal speech, device removal, 120-second cutoff, stop, cancel, and repeated recordings.
- No microphone track, animation frame, timer, Blob, or `AudioContext` remains after every terminal state.

### Phase B: Production STT Runtime

Detailed implementation plan: [Phase B Development Plan](./phase-b-development-plan.md).

Deliverables:

- Introduce the `VoiceRuntime` interface and runtime registry in `src/main/voice/`.
- Implement an authenticated gateway/provider adapter using the existing credential and gateway configuration path. Confirm the server endpoint and accepted multipart formats before coding the adapter.
- Add request IDs, progress events, cancellation via `AbortController`, timeout, bounded retries for transient failures, and normalized errors.
- Normalize provider responses into transcript, detected language, duration, confidence when available, segments when available, runtime ID, and disclosure.
- Add an optional media normalization step only when the chosen runtime cannot consume Chromium's recorded format.

Exit criteria:

- Fixed Chinese, English, mixed-language, silence, noisy, and unsupported-format fixtures produce expected normalized outcomes.
- A gated live smoke test transcribes a short recording; standard CI remains network-independent.
- Cancelling during upload or inference terminates work and removes temporary audio.

### Phase C: Review and Product Completion

Deliverables:

- Show partial text only if the runtime supports it; otherwise show clear transcription progress without invented percentages.
- Present the final transcript in an editable review state with Insert, Replace selection, Retry, and Discard actions.
- Add language Auto/Chinese/English control and a visible local/provider disclosure before first use and in settings.
- Make workspace handoff optional and write only user-confirmed transcript text.
- Add structured diagnostics with request ID, stage, runtime, MIME type, duration, byte size, latency, and error code; never log audio or transcript text by default.

Exit criteria:

- Users can recover from permission, auth, network, timeout, codec, empty-audio, and runtime-unavailable errors without losing existing composer text.
- Accessibility covers keyboard operation, focus restoration, status announcements, and non-color state indicators.

### Phase D: Offline STT and TTS

Deliverables:

- Add `local-whisper` behind the same runtime contract, including model download verification, storage quota, CPU/GPU capability detection, warm-up, progress, and cancellation.
- Let users select provider, local, or automatic fallback with an explicit privacy policy.
- Add per-assistant-message TTS with play, pause, resume, stop, speed, and voice selection.
- Start with Windows/browser system voices; add provider TTS only through a separate adapter with the same disclosure and cancellation rules.

Exit criteria:

- Offline transcription works after model installation with the network disabled.
- TTS never auto-plays unless enabled, stops on navigation or a new playback request, and handles missing voices gracefully.

## Test Matrix and Release Gates

Unit tests:

- RMS/peak normalization, noise gate, waveform history direction, duration limits, MIME selection, error normalization, response parsing, temp-file TTL, and settings migration.

Integration tests:

- Renderer -> preload -> main request lifecycle, event ordering, cancellation race conditions, renderer reload, app shutdown, workspace-free dictation, and transcript insertion at the selection.

Fixture tests:

- Short WAV fixtures for Chinese, English, mixed speech, silence, clipped audio, background noise, and corrupt files. WebM/Opus fixtures cover the real Chromium path.

Visual and accessibility tests:

- Compact, narrow, and wide composer layouts for every state; long localized errors; keyboard-only capture/review; screen-reader live regions; high-DPI and reduced-motion behavior.

Manual Windows matrix:

- Windows 10 and 11, built-in microphone, USB headset, Bluetooth headset, device switching, privacy permission disabled, sleep/resume, and packaged application behavior.

Release gates:

- `npm run typecheck`
- `npm run verify:voice-feature`
- focused voice unit and integration suites
- `npm run verify:ui`
- `npm run verify:visual`
- `npm run build`
- optional provider live smoke and packaged Windows microphone smoke

## Recommended Next Slice

Implement Phase B before adding more visual polish. The first slice should establish `VoiceRuntime`, a fixture runtime, request IDs/events/cancellation, and the real gateway adapter behind a feature flag. This changes the current result from "recorded audio produced a placeholder" to "recorded audio produced recognized, reviewable text" while keeping local Whisper and TTS independent follow-up work.
