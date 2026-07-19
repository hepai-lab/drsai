import { useState } from "react";

export function VoiceReviewBar({
  value,
  disclosure,
  onChange,
  onAccept,
  onRetry,
  onDiscard,
}: {
  value: string;
  disclosure: string | null;
  onChange: (value: string) => void;
  onAccept: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}): React.JSX.Element {
  const [composing, setComposing] = useState(false);
  return (
    <div className="composer-voice-review">
      <textarea
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(event) => { setComposing(false); onChange(event.currentTarget.value); }}
        aria-label="Review voice transcript"
        rows={2}
      />
      <div className="composer-voice-review-actions">
        <button type="button" onClick={onRetry}>Retry</button>
        <button type="button" onClick={onDiscard}>Discard</button>
        <button className="primary" type="button" onClick={onAccept} disabled={!value.trim() || composing}>Insert</button>
      </div>
      {disclosure ? <small>{disclosure}</small> : null}
    </div>
  );
}
