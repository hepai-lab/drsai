import type { RuntimeCapabilities } from "./runtimeClient";

const OAEP_REQUIRED = [
  "oaep.v1",
  "oaep.session.snapshot",
  "oaep.session.events",
  "oaep.session.events.stream",
  "event.cursor_expired",
] as const;

const LEGACY_REQUIRED = [
  "conversation.snapshot",
  "session.event.resume",
  "session.event.stream",
  "session.event.cursor_expired",
] as const;

export function selectRuntimeConversationProtocol(
  capabilities: RuntimeCapabilities,
): "oaep" | "legacy" | "unavailable" {
  const advertised = new Set(capabilities.capabilities);
  const oaepProtocol = capabilities.protocols?.oaep;
  const oaepSignals = Boolean(oaepProtocol) || [...advertised].some((name) => name.startsWith("oaep."));
  const oaepComplete = oaepProtocol?.version === "1.0"
    && oaepProtocol.profiles.includes("oaep.session-stream/1")
    && OAEP_REQUIRED.every((name) => advertised.has(name));
  if (oaepSignals && !oaepComplete) throw new Error("oaep_capability_partial");
  if (oaepComplete) return "oaep";
  if (LEGACY_REQUIRED.every((name) => advertised.has(name))) return "legacy";
  return "unavailable";
}
