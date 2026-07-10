# Windows App Voice Feature Plan

Last updated: 2026-07-10

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
- Live microphone capture, device selection, recording, transcription runtime, and TTS are not implemented.

Important existing files:

- `src/main/channelAdapters.ts`: voice adapter, transcript import, audio metadata summaries.
- `src/shared/desktopApi.ts`: shared channel adapter and context item contracts.
- `src/preload/index.ts`: renderer-to-main API bridge.
- `src/renderer/src/components/ChatWorkspace.tsx`: composer, attachment chips, file/folder input controls.
- `src/main/chat.ts`: chat request validation, attachment context assembly, gateway request.
- `docs/smart-chat-bar-roadmap.md`: current voice status and follow-up gaps.
- `docs/chatbar-capability-checklist.md`: verification checklist and supported media boundaries.

## Stage 1: Composer Recording and Voice-To-Text Input

Objective: Add a visible microphone entry point in the chat composer that records user speech, transcribes it, and inserts reviewed text into the input.

Scope:

- Add a Mic button to `ChatWorkspace`.
- Use `navigator.mediaDevices.getUserMedia({ audio: true })` and `MediaRecorder` in the renderer for the first implementation.
- Track recording states: `idle`, `requesting_permission`, `recording`, `processing`, `failed`.
- Support click-to-record and stop-to-transcribe first; push-to-talk can follow after the basic flow is stable.
- Show duration, cancel, retry, and error states.
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

Stage 2 status: implemented for typed mock-local IPC on 2026-07-10. The renderer/preload/main contract now exposes `transcribeVoiceRecording` and `writeVoiceTranscriptHandoff`, validates registered workspace access in the main process, bounds recording bytes/duration/transcript size, uses a local mock transcription runtime with explicit no-network/no-provider disclosure, and writes successful transcripts to the existing workspace-local `.drsai/voice-context.json` handoff for `voice-input` review. Real gateway/provider or local Whisper transcription remains Stage 3 work.

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
