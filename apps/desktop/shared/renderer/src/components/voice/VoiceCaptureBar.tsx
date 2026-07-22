import { Square } from "lucide-react";
import { formatVoiceDuration, type VoiceRecordingState } from "../../voice/voiceAudio";

export function VoiceCaptureBar({
  elapsedSeconds,
  levels,
  state,
  onStop,
}: {
  elapsedSeconds: number;
  levels: number[];
  state: VoiceRecordingState;
  onStop: () => void;
}): React.JSX.Element {
  const processing = state === "processing" || state === "requesting_permission";
  return (
    <div
      className={`composer-voice-capture ${processing ? "processing" : "recording"}`}
      aria-label={processing ? "Preparing voice input" : "Recording voice input"}
    >
      <div className="composer-voice-wave" aria-hidden>
        {levels.map((level, index) => (
          <span
            className="composer-voice-wave-bar"
            key={index}
            style={{
              height: `${Math.max(2, Math.round(level * 30))}px`,
              opacity: level > 0.01 ? 1 : 0,
            }}
          />
        ))}
      </div>
      <span className="composer-voice-time">{formatVoiceDuration(elapsedSeconds)}</span>
      <button
        className="composer-voice-stop"
        type="button"
        disabled={state === "requesting_permission"}
        onClick={onStop}
        aria-label="Stop voice recording"
        title="Stop voice recording"
      >
        <Square size={11} fill="currentColor" />
      </button>
    </div>
  );
}
