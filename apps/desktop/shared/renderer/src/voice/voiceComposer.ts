export interface VoiceTextSelection {
  end: number;
  start: number;
}

export interface VoiceTranscriptInsertion {
  cursor: number;
  value: string;
}

export function insertVoiceTranscript(
  input: string,
  transcript: string,
  selection: VoiceTextSelection,
): VoiceTranscriptInsertion {
  const start = clampSelectionIndex(selection.start, input.length);
  const end = Math.max(start, clampSelectionIndex(selection.end, input.length));
  return {
    cursor: start + transcript.length,
    value: `${input.slice(0, start)}${transcript}${input.slice(end)}`,
  };
}

function clampSelectionIndex(index: number, length: number): number {
  return Math.min(length, Math.max(0, Number.isFinite(index) ? Math.trunc(index) : length));
}
