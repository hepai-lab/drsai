import { useEffect, useState } from "react";
import { Square } from "lucide-react";
import { formatVoiceDuration } from "../../voice/voiceAudio";
import type { StreamingVoiceInputPhase } from "../../voice/streaming/useStreamingVoiceInput";

export function StreamingVoiceCaptureBar({
  committedText,
  elapsedSeconds,
  levels,
  onStop,
  phase,
  transportMessage,
  unstableText,
}: {
  committedText: string;
  elapsedSeconds: number;
  levels: number[];
  onStop: () => void;
  phase: StreamingVoiceInputPhase;
  transportMessage?: string;
  unstableText: string;
}): React.JSX.Element {
  const listening = phase === "streaming";
  const label = listening ? "Listening with live transcription" : "Finishing live transcription";
  const [announcedTranscript, setAnnouncedTranscript] = useState("");
  useEffect(() => {
    const next = `${committedText} ${unstableText}`.trim();
    if (!next) return;
    const timer = window.setTimeout(() => setAnnouncedTranscript(next), 900);
    return () => window.clearTimeout(timer);
  }, [committedText, unstableText]);
  return (
    <div className={`composer-voice-capture streaming ${listening ? "recording" : "processing"}`} aria-label={label}>
      <div className="composer-voice-streaming-main">
        <div className="composer-voice-wave" aria-hidden>
          {levels.map((level, index) => (
            <span
              className="composer-voice-wave-bar"
              key={index}
              style={{ height: `${Math.max(2, Math.round(level * 30))}px`, opacity: level > 0.01 ? 1 : 0 }}
            />
          ))}
        </div>
        <span className="composer-voice-time">{formatVoiceDuration(elapsedSeconds)}</span>
        <button
          className="composer-voice-stop"
          type="button"
          disabled={!listening}
          onClick={onStop}
          aria-label="Stop live transcription"
          title="Stop live transcription"
        >
          <Square size={11} fill="currentColor" />
        </button>
      </div>
      <div className="composer-voice-live-transcript">
        {committedText ? <span className="committed">{committedText}</span> : null}
        {unstableText ? <span className="unstable" aria-label="Interim transcript">{unstableText}</span> : null}
        {!committedText && !unstableText ? <span className="placeholder">Speak now…</span> : null}
      </div>
      <span className="voice-sr-only" aria-live="polite" aria-atomic="true">{announcedTranscript}</span>
      {transportMessage ? <div className="composer-voice-transport-warning" role="status">{transportMessage}</div> : null}
    </div>
  );
}
