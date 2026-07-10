import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  DesktopVoiceTranscriptHandoffRequest,
  DesktopVoiceTranscriptHandoffResult,
  DesktopVoiceTranscriptionRequest,
  DesktopVoiceTranscriptionResult,
} from "../shared/desktopApi";

const MAX_VOICE_RECORDING_BYTES = 10 * 1024 * 1024;
const MAX_VOICE_RECORDING_SECONDS = 120;
const MAX_VOICE_TRANSCRIPT_CHARS = 12_000;
const DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH = ".drsai/voice-context.json";

interface VoiceTranscriptRecord {
  id: string;
  title: string;
  speaker: string;
  language?: string;
  transcript: string;
  durationSeconds?: number;
  sourceId?: string;
  runtimeId?: string;
  capturedAt: string;
  createdAt: string;
}

interface VoiceTranscriptStore {
  version: 1;
  transcripts: VoiceTranscriptRecord[];
}

export function transcribeVoiceRecording(
  request: DesktopVoiceTranscriptionRequest,
): DesktopVoiceTranscriptionResult {
  const workspacePath = resolveWorkspacePath(request.workspacePath);
  const durationSeconds = clampDuration(request.durationSeconds);
  const mimeType = clampSingleLine(request.mimeType, 120, "Voice MIME type is required.");
  const audioBytes = decodeAudioLength(request.audioBase64);
  const language = clampOptionalSingleLine(request.languageHint, 32);
  const sourceLabel =
    clampOptionalSingleLine(request.sourceLabel, 160) || "Desktop voice recording";
  const createdAt = new Date().toISOString();
  const sourceId = `voice-${createHash("sha256")
    .update(`${workspacePath}:${createdAt}:${audioBytes}:${durationSeconds}:${mimeType}`)
    .digest("hex")
    .slice(0, 16)}`;
  const mockTranscript = clampMultiline(
    request.mockTranscriptText ||
      [
        "[Voice recording captured]",
        `Source: ${sourceLabel}.`,
        `Duration: ${formatDuration(durationSeconds)}.`,
        `Audio bytes: ${audioBytes}.`,
        "Mock-local transcription is active; no audio left this machine.",
      ].join("\n"),
    MAX_VOICE_TRANSCRIPT_CHARS,
  );

  return {
    ok: true,
    transcript: mockTranscript,
    language,
    durationSeconds,
    confidence: request.mockTranscriptText ? 1 : undefined,
    runtimeId: "mock-local",
    sourceId,
    createdAt,
    truncated:
      (request.mockTranscriptText?.length ?? 0) > MAX_VOICE_TRANSCRIPT_CHARS ||
      audioBytes >= MAX_VOICE_RECORDING_BYTES,
    providerDisclosure:
      "Voice transcription used the local mock runtime; no network request, provider upload, or raw-audio persistence occurred.",
    message:
      "Voice recording was normalized into reviewed text. Configure a gateway or local Whisper runtime to replace mock-local transcription.",
  };
}

export function writeVoiceTranscriptHandoff(
  request: DesktopVoiceTranscriptHandoffRequest,
): DesktopVoiceTranscriptHandoffResult {
  const workspacePath = resolveWorkspacePath(request.workspacePath);
  const transcript = clampMultiline(
    request.transcript,
    MAX_VOICE_TRANSCRIPT_CHARS,
    "Voice transcript text is required.",
  );
  const transcriptPath = resolveInsideWorkspace(
    workspacePath,
    DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH,
  );
  ensureWritableHandoffPath(workspacePath, transcriptPath);
  const now = new Date().toISOString();
  const store = readVoiceTranscriptStore(transcriptPath);
  const record: VoiceTranscriptRecord = {
    id: `voice-${randomUUID()}`,
    title: clampOptionalSingleLine(request.title, 160) || "Desktop voice transcript",
    speaker: clampOptionalSingleLine(request.speaker, 80) || "desktop-user",
    language: clampOptionalSingleLine(request.language, 32),
    transcript,
    durationSeconds:
      typeof request.durationSeconds === "number"
        ? Math.max(0, Math.min(MAX_VOICE_RECORDING_SECONDS, Math.round(request.durationSeconds)))
        : undefined,
    sourceId: clampOptionalSingleLine(request.sourceId, 120),
    runtimeId: clampOptionalSingleLine(request.runtimeId, 80),
    capturedAt: clampOptionalSingleLine(request.capturedAt, 80) || now,
    createdAt: now,
  };
  const nextStore: VoiceTranscriptStore = {
    version: 1,
    transcripts: [record, ...store.transcripts].slice(0, 50),
  };
  writeFileSync(transcriptPath, `${JSON.stringify(nextStore, null, 2)}\n`, "utf8");
  return {
    ok: true,
    transcriptPath,
    relativePath: DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH,
    recordId: record.id,
    itemCount: nextStore.transcripts.length,
    importRequest: {
      adapterId: "voice-input",
      workspacePath,
      voiceTranscriptPath: DEFAULT_VOICE_TRANSCRIPT_RELATIVE_PATH,
      limit: 1,
    },
    message:
      "Voice transcript handoff was written inside the workspace for explicit Channels review.",
  };
}

function decodeAudioLength(audioBase64?: string): number {
  if (!audioBase64) return 0;
  if (audioBase64.length > Math.ceil((MAX_VOICE_RECORDING_BYTES * 4) / 3) + 64) {
    throw new Error("Voice recording exceeds the 10 MB desktop limit.");
  }
  const normalized = audioBase64.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Voice recording must be base64 encoded.");
  }
  return Buffer.byteLength(Buffer.from(normalized, "base64"));
}

function clampDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Voice recording duration is required.");
  }
  if (value > MAX_VOICE_RECORDING_SECONDS) {
    throw new Error("Voice recording exceeds the 120 second desktop limit.");
  }
  return Math.round(value);
}

function readVoiceTranscriptStore(transcriptPath: string): VoiceTranscriptStore {
  if (!existsSync(transcriptPath)) return { version: 1, transcripts: [] };
  const stats = statSync(transcriptPath);
  if (!stats.isFile() || stats.size > 1024 * 1024) {
    throw new Error("Existing voice handoff is not a bounded file.");
  }
  try {
    const parsed = JSON.parse(readFileSync(transcriptPath, "utf8")) as Partial<VoiceTranscriptStore>;
    const transcripts = Array.isArray(parsed.transcripts)
      ? parsed.transcripts.filter(isVoiceTranscriptRecord)
      : [];
    return { version: 1, transcripts };
  } catch {
    return { version: 1, transcripts: [] };
  }
}

function ensureWritableHandoffPath(workspacePath: string, transcriptPath: string): void {
  const parent = dirname(transcriptPath);
  if (existsSync(parent) && lstatSync(parent).isSymbolicLink()) {
    throw new Error("Voice handoff directory cannot be a symlink.");
  }
  mkdirSync(parent, { recursive: true });
  if (existsSync(transcriptPath) && lstatSync(transcriptPath).isSymbolicLink()) {
    throw new Error("Voice handoff file cannot be a symlink.");
  }
  resolveInsideWorkspace(workspacePath, transcriptPath);
}

function resolveWorkspacePath(rawWorkspacePath: string): string {
  const workspacePath = clampSingleLine(rawWorkspacePath, 2048, "Workspace path is required.");
  if (!existsSync(workspacePath)) throw new Error("Workspace path does not exist.");
  return realpathSync.native(resolve(workspacePath));
}

function resolveInsideWorkspace(workspacePath: string, rawPath: string): string {
  const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(workspacePath, rawPath);
  const rel = relative(workspacePath, target);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel) && !rel.split(sep).includes(".."))) {
    return target;
  }
  throw new Error("Voice handoff path must stay inside the workspace.");
}

function isVoiceTranscriptRecord(value: unknown): value is VoiceTranscriptRecord {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as VoiceTranscriptRecord).id === "string" &&
    typeof (value as VoiceTranscriptRecord).transcript === "string"
  );
}

function clampSingleLine(value: unknown, maxLength: number, fallback?: string): string {
  const normalized =
    typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
  if (!normalized) {
    if (fallback) throw new Error(fallback);
    return "";
  }
  return normalized.slice(0, maxLength);
}

function clampOptionalSingleLine(value: unknown, maxLength: number): string | undefined {
  return clampSingleLine(value, maxLength) || undefined;
}

function clampMultiline(value: unknown, maxLength: number, fallback?: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    if (fallback) throw new Error(fallback);
    return "";
  }
  return normalized.slice(0, maxLength);
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}
