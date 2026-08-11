import type { RuntimeCapabilities } from "./runtimeClient";

// Kept as a runtime-safe mirror because this module is also executed directly
// by Node's strip-types test runner. generate-oaep-types.py --check verifies
// this mirror against the generated TS/Kotlin/Python constants.
const OAEP_VERSION = "1.0";
const OAEP_PROFILE = "oaep.session-stream/1";
const OAEP_SCHEMA_SHA256 = "1b28430fb888b7160247c5518f8d6075b2118b4a43151234a5f7e29f0d7ace09";

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

export interface RuntimeConversationProtocolSelection {
  selected: "oaep" | "legacy" | "unavailable";
  version: string | null;
  schemaHash: string | null;
  fallbackReason: "operator_rollback" | "oaep_unavailable" | "legacy_unavailable" | null;
  upgradeAction: "upgrade_runtime" | "disable_operator_rollback" | null;
}

export function selectRuntimeConversationProtocolResult(
  capabilities: RuntimeCapabilities,
  options: { forceLegacy?: boolean } = {},
): RuntimeConversationProtocolSelection {
  const advertised = new Set(capabilities.capabilities);
  const oaepProtocol = capabilities.protocols?.oaep;
  const oaepSignals = Boolean(oaepProtocol) || [...advertised].some((name) => name.startsWith("oaep."));
  const oaepComplete = oaepProtocol?.version === OAEP_VERSION
    && oaepProtocol.profiles.includes(OAEP_PROFILE)
    && oaepProtocol.schema_sha256 === OAEP_SCHEMA_SHA256
    && OAEP_REQUIRED.every((name) => advertised.has(name));
  if (oaepSignals && !oaepComplete) throw new Error("oaep_capability_partial");
  if (oaepComplete && !options.forceLegacy) return {
    selected: "oaep", version: OAEP_VERSION, schemaHash: OAEP_SCHEMA_SHA256,
    fallbackReason: null, upgradeAction: null,
  };
  const legacy = LEGACY_REQUIRED.every((name) => advertised.has(name));
  if (legacy) return {
    selected: "legacy", version: "1", schemaHash: null,
    fallbackReason: options.forceLegacy ? "operator_rollback" : "oaep_unavailable",
    upgradeAction: options.forceLegacy && oaepComplete ? "disable_operator_rollback" : "upgrade_runtime",
  };
  return {
    selected: "unavailable", version: null, schemaHash: null,
    fallbackReason: "legacy_unavailable", upgradeAction: "upgrade_runtime",
  };
}

export function selectRuntimeConversationProtocol(
  capabilities: RuntimeCapabilities,
  options: { forceLegacy?: boolean } = {},
): "oaep" | "legacy" | "unavailable" {
  return selectRuntimeConversationProtocolResult(capabilities, options).selected;
}
