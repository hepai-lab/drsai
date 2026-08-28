export type LocalMicrophoneTestCode = "ready" | "permission_denied" | "device_missing" | "unsupported" | "unknown";
export interface LocalMicrophoneTestResult { ok: boolean; code: LocalMicrophoneTestCode; deviceLabel: string; }

export async function testLocalMicrophone(
  mediaDevices: Pick<MediaDevices, "getUserMedia"> | null | undefined,
  deviceId: string,
): Promise<LocalMicrophoneTestResult> {
  if (!mediaDevices?.getUserMedia) return { ok: false, code: "unsupported", deviceLabel: "" };
  let stream: MediaStream | null = null;
  try {
    stream = await mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
    const track = stream.getAudioTracks()[0];
    if (!track || track.readyState !== "live") return { ok: false, code: "device_missing", deviceLabel: "" };
    return { ok: true, code: "ready", deviceLabel: track.label };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : error && typeof error === "object" && "name" in error ? String(error.name) : "";
    if (name === "NotAllowedError" || name === "SecurityError") return { ok: false, code: "permission_denied", deviceLabel: "" };
    if (name === "NotFoundError" || name === "OverconstrainedError") return { ok: false, code: "device_missing", deviceLabel: "" };
    return { ok: false, code: "unknown", deviceLabel: "" };
  } finally { stream?.getTracks().forEach((track) => track.stop()); }
}
