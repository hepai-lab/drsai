export interface StreamingComposerSelection {
  start: number;
  end: number;
}

export interface StreamingComposerProjectionState {
  userText: string;
  anchor: StreamingComposerSelection;
  stableVoiceText: string;
  provisionalVoiceText: string;
  revision: number;
  composing: boolean;
  pendingTranscript: StreamingComposerTranscriptUpdate | null;
  conflict: boolean;
}

export interface StreamingComposerTranscriptUpdate {
  stableVoiceText: string;
  provisionalVoiceText: string;
  revision: number;
}

export interface StreamingComposerProjectionView {
  before: string;
  stableVoiceText: string;
  provisionalVoiceText: string;
  after: string;
  text: string;
  voiceStart: number;
  voiceEnd: number;
}

export interface StreamingComposerCommit {
  cursor: number;
  value: string;
}

export function createStreamingComposerProjection(
  userText: string,
  selection: StreamingComposerSelection,
): StreamingComposerProjectionState {
  const start = clampIndex(selection.start, userText.length);
  const end = Math.max(start, clampIndex(selection.end, userText.length));
  return {
    userText,
    anchor: { start, end },
    stableVoiceText: "",
    provisionalVoiceText: "",
    revision: 0,
    composing: false,
    pendingTranscript: null,
    conflict: false,
  };
}

export function updateStreamingComposerTranscript(
  state: StreamingComposerProjectionState,
  update: StreamingComposerTranscriptUpdate,
): StreamingComposerProjectionState {
  if (update.revision < state.revision) return state;
  const normalized = normalizeUpdate(update);
  if (state.composing) return { ...state, pendingTranscript: normalized };
  return { ...state, ...normalized, pendingTranscript: null };
}

export function setStreamingComposerComposition(
  state: StreamingComposerProjectionState,
  composing: boolean,
): StreamingComposerProjectionState {
  if (composing) return { ...state, composing: true };
  const pending = state.pendingTranscript;
  return pending
    ? { ...state, ...pending, composing: false, pendingTranscript: null }
    : { ...state, composing: false };
}

export function rebaseStreamingComposerUserText(
  state: StreamingComposerProjectionState,
  nextUserText: string,
): StreamingComposerProjectionState {
  if (nextUserText === state.userText) return state;
  const change = findSingleTextChange(state.userText, nextUserText);
  const anchor = state.anchor;
  if (change.oldEnd <= anchor.start) {
    const delta = (change.newEnd - change.start) - (change.oldEnd - change.start);
    return {
      ...state,
      userText: nextUserText,
      anchor: { start: anchor.start + delta, end: anchor.end + delta },
    };
  }
  if (change.start >= anchor.end) return { ...state, userText: nextUserText };
  return { ...state, userText: nextUserText, conflict: true };
}

export function getStreamingComposerProjectionView(
  state: StreamingComposerProjectionState,
): StreamingComposerProjectionView {
  const before = state.userText.slice(0, state.anchor.start);
  const after = state.userText.slice(state.anchor.end);
  const voiceText = joinTranscript(state.stableVoiceText, state.provisionalVoiceText);
  const leftSeparator = needsWordSeparator(before, voiceText) ? " " : "";
  const rightSeparator = needsWordSeparator(voiceText, after) ? " " : "";
  const voiceStart = before.length + leftSeparator.length;
  return {
    before,
    stableVoiceText: state.stableVoiceText,
    provisionalVoiceText: state.provisionalVoiceText,
    after,
    text: `${before}${leftSeparator}${voiceText}${rightSeparator}${after}`,
    voiceStart,
    voiceEnd: voiceStart + voiceText.length,
  };
}

export function commitStreamingComposerProjection(
  state: StreamingComposerProjectionState,
): StreamingComposerCommit | null {
  if (state.conflict || state.composing || state.provisionalVoiceText) return null;
  const view = getStreamingComposerProjectionView(state);
  return { value: view.text, cursor: view.voiceEnd };
}

export function discardStreamingComposerProjection(state: StreamingComposerProjectionState): StreamingComposerCommit {
  return { value: state.userText, cursor: state.anchor.start };
}

function normalizeUpdate(update: StreamingComposerTranscriptUpdate): StreamingComposerTranscriptUpdate {
  return {
    stableVoiceText: normalizeTranscript(update.stableVoiceText),
    provisionalVoiceText: normalizeTranscript(update.provisionalVoiceText),
    revision: Math.max(0, Math.trunc(update.revision)),
  };
}

function normalizeTranscript(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function joinTranscript(stable: string, provisional: string): string {
  if (!stable) return provisional;
  if (!provisional) return stable;
  if (/\s$/u.test(stable) || /^[,.;:!?，。；：！？、]/u.test(provisional)) return `${stable}${provisional}`;
  return `${stable} ${provisional}`;
}

function needsWordSeparator(left: string, right: string): boolean {
  if (!left || !right || /\s$/u.test(left) || /^\s/u.test(right)) return false;
  return /[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right)
    && /[\u0000-\u024f]/u.test(left.at(-1) ?? "")
    && /[\u0000-\u024f]/u.test(right[0] ?? "");
}

function clampIndex(index: number, length: number): number {
  return Math.min(length, Math.max(0, Number.isFinite(index) ? Math.trunc(index) : length));
}

function findSingleTextChange(previous: string, next: string): { start: number; oldEnd: number; newEnd: number } {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  return { start, oldEnd: previousEnd, newEnd: nextEnd };
}
