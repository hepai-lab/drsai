/**
 * The input: prompt, model picker (3.2), microphone (3.4), send/stop (3.3).
 *
 * Two details are load-bearing.
 *
 * **The client message id is generated on submit, not on send.**  It is the
 * idempotency key, so it must be stable across a retry of the same submission and
 * different for the next one.  Generating it inside the IPC layer would make
 * every retry a new key -- exactly the case the key exists to prevent.
 *
 * **The composer clears optimistically.**  The user's text reappears from the
 * event stream as a `message` item within a few hundred milliseconds, and holding
 * the textarea's content until then makes typing the next message impossible.  If
 * the send fails, the text is restored -- losing what someone just typed is the
 * one failure mode worth writing extra code to avoid.
 */

import React, { useRef, useState } from "react";
import type { ModelCatalogEntry } from "../../../../api/desktopBridge";
import { attempt, bridge, describeFailure } from "../bridge";

interface ComposerProps {
  sessionId: string | null;
  models: ModelCatalogEntry[];
  modelAlias: string | null;
  onModelChange(alias: string): void;
  /** Null when nothing is running; set means the stop button is live. */
  activeRunId: string | null;
  speechToTextReady: boolean;
  disabled: boolean;
}

export function Composer({
  sessionId,
  models,
  modelAlias,
  onModelChange,
  activeRunId,
  speechToTextReady,
  disabled,
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  const send = async (): Promise<void> => {
    const prompt = text.trim();
    if (!prompt || !sessionId || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    const { error: failure } = await attempt(
      bridge().chat.send({
        sessionId,
        prompt,
        // One key per submission, generated here so a retry reuses it.
        clientMessageId: crypto.randomUUID(),
        modelAlias,
      }),
    );
    if (failure) {
      setError(describeFailure(failure));
      setText(prompt);
    }
    setBusy(false);
  };

  const stop = async (): Promise<void> => {
    if (!activeRunId) return;
    const { error: failure } = await attempt(bridge().chat.cancel({ runId: activeRunId }));
    if (failure) setError(describeFailure(failure));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter sends, Shift+Enter breaks the line. IME composition must be exempt:
    // during Chinese or Japanese input, Enter commits the candidate and would
    // otherwise send a half-finished sentence.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const toggleRecording = async (): Promise<void> => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream);
      recorder.current = media;
      media.ondataavailable = (event) => void chunks.push(event.data);
      media.onstop = async () => {
        // Release the microphone before the upload: a hung transcription must
        // not leave the OS recording indicator on.
        for (const track of stream.getTracks()) track.stop();
        setRecording(false);
        const blob = new Blob(chunks, { type: media.mimeType || "audio/webm" });
        const { value, error: failure } = await attempt(
          bridge().voice.transcribe({
            audio: await blob.arrayBuffer(),
            filename: "recording.webm",
            mediaType: blob.type,
          }),
        );
        if (failure) {
          setError(describeFailure(failure));
          return;
        }
        // Append rather than replace: the user may have typed around the dictation.
        setText((current) => (current ? `${current} ${value.text}` : value.text));
      };
      media.start();
      setRecording(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The microphone is unavailable.");
    }
  };

  return (
    <div className="wb-composer">
      {error ? <div className="wb-composer-error">{error}</div> : null}
      <textarea
        className="wb-composer-input"
        value={text}
        placeholder={sessionId ? "Send a message" : "Select or create a conversation"}
        disabled={disabled || !sessionId}
        rows={3}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="wb-composer-controls">
        <select
          className="wb-model-picker"
          value={modelAlias ?? ""}
          onChange={(event) => onModelChange(event.target.value)}
          disabled={!models.length}
          aria-label="Model"
        >
          {models.map((model) => (
            <option key={model.alias} value={model.alias}>
              {model.display_name}
            </option>
          ))}
        </select>
        <div className="wb-composer-actions">
          {speechToTextReady ? (
            <button
              type="button"
              className="wb-button"
              data-recording={recording || undefined}
              onClick={() => void toggleRecording()}
            >
              {recording ? "Stop recording" : "Dictate"}
            </button>
          ) : null}
          {activeRunId ? (
            <button type="button" className="wb-button wb-button-stop" onClick={() => void stop()}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="wb-button wb-button-primary"
              disabled={disabled || !sessionId || !text.trim() || busy}
              onClick={() => void send()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
