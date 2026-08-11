import assert from "node:assert/strict";
import { OAEP_SCHEMA_SHA256 } from "../api/oaep.generated";
import type { RuntimeCapabilities } from "../main/runtimeClient";
import {
  selectRuntimeConversationProtocol,
  selectRuntimeConversationProtocolResult,
} from "../main/runtimeProtocolSelection";

const oaepCapabilities = (): RuntimeCapabilities => ({
  protocol_version: 1,
  capabilities: [
    "oaep.v1",
    "oaep.session.snapshot",
    "oaep.session.events",
    "oaep.session.events.stream",
    "event.cursor_expired",
    "conversation.snapshot",
    "session.event.resume",
    "session.event.stream",
    "session.event.cursor_expired",
  ],
  capability_versions: {},
  protocols: {
    oaep: {
      version: "1.0",
      profiles: ["oaep.session-stream/1"],
      schema_sha256: OAEP_SCHEMA_SHA256,
    },
  },
});

assert.deepEqual(selectRuntimeConversationProtocolResult(oaepCapabilities()), {
  selected: "oaep",
  version: "1.0",
  schemaHash: OAEP_SCHEMA_SHA256,
  fallbackReason: null,
  upgradeAction: null,
});

for (const mutate of [
  (value: RuntimeCapabilities) => { value.protocols!.oaep!.version = "2.0"; },
  (value: RuntimeCapabilities) => { value.protocols!.oaep!.profiles = []; },
  (value: RuntimeCapabilities) => { value.protocols!.oaep!.schema_sha256 = "0".repeat(64); },
  (value: RuntimeCapabilities) => { delete value.protocols!.oaep!.schema_sha256; },
  (value: RuntimeCapabilities) => { value.capabilities = value.capabilities.filter((name) => name !== "oaep.session.events.stream"); },
]) {
  const capabilities = oaepCapabilities();
  mutate(capabilities);
  assert.throws(
    () => selectRuntimeConversationProtocol(capabilities),
    /oaep_capability_partial/,
    "partial or schema-incompatible OAEP advertisements must fail closed",
  );
}

const rollback = selectRuntimeConversationProtocolResult(oaepCapabilities(), { forceLegacy: true });
assert.equal(rollback.selected, "legacy");
assert.equal(rollback.fallbackReason, "operator_rollback");
assert.equal(rollback.upgradeAction, "disable_operator_rollback");

const legacyOnly = oaepCapabilities();
delete legacyOnly.protocols;
legacyOnly.capabilities = legacyOnly.capabilities.filter((name) => !name.startsWith("oaep.") && name !== "event.cursor_expired");
assert.equal(selectRuntimeConversationProtocol(legacyOnly), "legacy");

const unavailable = { ...legacyOnly, capabilities: [] };
assert.deepEqual(selectRuntimeConversationProtocolResult(unavailable), {
  selected: "unavailable",
  version: null,
  schemaHash: null,
  fallbackReason: "legacy_unavailable",
  upgradeAction: "upgrade_runtime",
});

console.log("Runtime protocol selection verification passed (version/profile/schema/capability fail-closed and rollback).\n");
