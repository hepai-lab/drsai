export type DuplexLifecycleSignal = "hidden" | "visible" | "pagehide" | "offline" | "online" | "suspend" | "resume" | "lock" | "unlock" | "window_close";
export type DuplexLifecycleAction = "keep_session" | "release_capture" | "recover_capture" | "mark_offline" | "mark_online" | "dispose_session";

const POLICY: Readonly<Record<DuplexLifecycleSignal, DuplexLifecycleAction>> = Object.freeze({
  hidden: "keep_session", visible: "keep_session", pagehide: "dispose_session", offline: "mark_offline", online: "mark_online",
  suspend: "release_capture", resume: "recover_capture", lock: "release_capture", unlock: "recover_capture", window_close: "dispose_session",
});

export function duplexLifecycleAction(signal: DuplexLifecycleSignal): DuplexLifecycleAction { return POLICY[signal]; }
export function duplexLifecyclePolicy(): Readonly<Record<DuplexLifecycleSignal, DuplexLifecycleAction>> { return POLICY; }
