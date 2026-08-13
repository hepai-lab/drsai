import type { RefObject } from "react";
import { Square } from "lucide-react";
import { formatVoiceDuration } from "../../voice/voiceAudio";
import {
  getStreamingComposerProjectionView,
  type StreamingComposerProjectionState,
} from "../../voice/streaming/streamingComposerProjection";
import type { StreamingVoiceInputPhase } from "../../voice/streaming/useStreamingVoiceInput";

export function StreamingComposerProjectionEditor({
  elapsedSeconds,
  levels,
  onCompositionChange,
  onStop,
  onUserTextChange,
  phase,
  projection,
  textareaRef,
  transportMessage,
}: {
  elapsedSeconds: number;
  levels: number[];
  onCompositionChange: (composing: boolean) => void;
  onStop: () => void;
  onUserTextChange: (value: string) => void;
  phase: StreamingVoiceInputPhase;
  projection: StreamingComposerProjectionState;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  transportMessage?: string;
}): React.JSX.Element {
  const listening = phase === "streaming";
  const view = getStreamingComposerProjectionView(projection);
  return (
    <div className="composer-editor composer-streaming-projection" data-testid="streaming-composer-projection">
      <textarea
        ref={textareaRef}
        data-testid="composer-input"
        value={projection.userText}
        onChange={(event) => onUserTextChange(event.target.value)}
        onCompositionStart={() => onCompositionChange(true)}
        onCompositionEnd={() => onCompositionChange(false)}
        placeholder="Speak or type…"
        rows={1}
      />
      <div className="composer-streaming-projection-text" aria-live="polite" aria-atomic="true">
        {view.before}<span className="stable">{view.stableVoiceText}</span>
        <span className="provisional" aria-label="Interim transcript">{view.provisionalVoiceText}</span>{view.after}
        {!view.stableVoiceText && !view.provisionalVoiceText ? <span className="placeholder">Listening…</span> : null}
      </div>
      <div className="composer-streaming-projection-controls">
        <div className="composer-voice-wave" aria-hidden>
          {levels.map((level, index) => <span key={index} className="composer-voice-wave-bar" style={{ height: `${Math.max(2, Math.round(level * 22))}px`, opacity: level > 0.01 ? 1 : 0 }} />)}
        </div>
        <span>{formatVoiceDuration(elapsedSeconds)}</span>
        <button type="button" disabled={!listening} onClick={onStop} aria-label="Stop live transcription" title="Stop live transcription">
          <Square size={11} fill="currentColor" />
        </button>
      </div>
      {projection.conflict ? <small role="alert">Voice insertion overlaps a manual edit. Review is required.</small> : null}
      {transportMessage ? <small role="status">{transportMessage}</small> : null}
    </div>
  );
}
