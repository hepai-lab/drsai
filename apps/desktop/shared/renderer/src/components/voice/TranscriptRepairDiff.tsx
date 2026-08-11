import type { TranscriptRepairCandidate } from "../../voice/streaming/contextualTranscriptRepair";

export function TranscriptRepairDiff({ candidate, onAccept, onReject, onUndo, accepted }: {
  candidate: TranscriptRepairCandidate;
  onAccept: () => void;
  onReject: () => void;
  onUndo: () => void;
  accepted: boolean;
}): React.JSX.Element {
  const changes = findChangedRange(candidate.originalText, candidate.suggestedText);
  return (
    <section className="transcript-repair-diff" aria-label="Contextual transcript repair" data-testid="transcript-repair-diff">
      <div className="transcript-repair-versions">
        <p><strong>Original</strong> {renderChangedText(candidate.originalText, changes.originalStart, changes.originalEnd)}</p>
        <p><strong>Suggestion</strong> {renderChangedText(candidate.suggestedText, changes.suggestedStart, changes.suggestedEnd)}</p>
      </div>
      <small>
        Confidence {Math.round(candidate.confidence * 100)}%
        {candidate.sources.length ? ` · ${candidate.sources.map(({ type, label }) => label || type).join(", ")}` : ""}
        {candidate.policy.reasons.length ? ` · Review required: ${candidate.policy.reasons.join(", ")}` : ""}
      </small>
      <div className="transcript-repair-actions">
        {accepted ? <button type="button" onClick={onUndo}>Undo repair</button> : (
          <>
            <button type="button" onClick={onReject}>Keep original</button>
            <button type="button" className="primary" onClick={onAccept}>Use suggestion</button>
          </>
        )}
      </div>
    </section>
  );
}

function renderChangedText(text: string, start: number, end: number): React.JSX.Element {
  return <>{text.slice(0, start)}<mark>{text.slice(start, end)}</mark>{text.slice(end)}</>;
}

function findChangedRange(original: string, suggested: string): {
  originalStart: number; originalEnd: number; suggestedStart: number; suggestedEnd: number;
} {
  let start = 0;
  while (start < original.length && start < suggested.length && original[start] === suggested[start]) start += 1;
  let originalEnd = original.length;
  let suggestedEnd = suggested.length;
  while (originalEnd > start && suggestedEnd > start && original[originalEnd - 1] === suggested[suggestedEnd - 1]) {
    originalEnd -= 1;
    suggestedEnd -= 1;
  }
  return { originalStart: start, originalEnd, suggestedStart: start, suggestedEnd };
}
