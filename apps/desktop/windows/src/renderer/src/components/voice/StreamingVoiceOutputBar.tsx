import { Pause, Play, Square } from "lucide-react";
import type { StreamingVoiceOutputState } from "../../voice/streaming/useStreamingVoiceOutput";

export function StreamingVoiceOutputBar({ output, onStop }: { output: StreamingVoiceOutputState; onStop?: () => void }): React.JSX.Element {
  const paused = output.phase === "paused";
  const label = output.phase === "synthesizing" || output.phase === "buffering"
    ? "Preparing streaming reply audio"
    : output.phase === "playing" ? "Playing streaming reply" : output.phase;
  return (
    <div className="composer-streaming-output" role="status" aria-live="polite">
      <span>{label}</span>
      <small>{output.playedSegments}/{output.synthesizedSegments} segments</small>
      {output.deviceNotice ? <small>{output.deviceNotice}</small> : null}
      {paused ? (
        <button type="button" onClick={output.resume} aria-label="Resume streaming reply"><Play size={13} /></button>
      ) : (
        <button type="button" onClick={output.pause} disabled={output.phase !== "playing"} aria-label="Pause streaming reply"><Pause size={13} /></button>
      )}
      <button type="button" onClick={onStop ?? output.stop} aria-label="Stop streaming reply"><Square size={11} fill="currentColor" /></button>
    </div>
  );
}
