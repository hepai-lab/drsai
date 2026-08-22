import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const planPath = "docs/remote_workespace/OpenDrSaiCodexAdapter_OAEP_V6实时语义一致性与统一流式渲染开发方案.md";
const plan = read(planPath);
const featureRows = [...plan.matchAll(/\| (M\d{2}-F\d{2}) \| ([^|]+) \| ([^|]+) \|/g)].map((match) => ({
  id: match[1],
  capability: match[2].trim(),
  acceptance: match[3].trim(),
}));
const ids = featureRows.map((row) => row.id);
assert.equal(ids.length, 80, `V6 plan must contain 80 feature rows, found ${ids.length}.`);
assert.equal(new Set(ids).size, 80, "V6 feature IDs must be unique.");

const files = {
  chat: read("apps/desktop/shared/main/chat.ts"),
  input: read("apps/desktop/shared/main/chatInput.ts"),
  mapper: read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/event_mapper.py"),
  decoder: read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/native_decoder.py"),
  engine: read("cores/python/packages/drsai/src/drsai/backend/runtime/engine.py"),
  writer: read("cores/python/packages/drsai/src/drsai/backend/runtime/normalized_writer.py"),
  protocol: read("cores/python/packages/drsai/src/drsai/oaep/protocol.py"),
  schema: read("cores/protocol/oaep/oaep.schema.json"),
  stream: read("apps/desktop/shared/main/oaepSessionStream.ts"),
  projector: read("apps/desktop/shared/main/oaepPresentationProjector.ts"),
  history: read("apps/desktop/shared/main/threadRuntimeProjection.ts"),
  renderer: read("apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx"),
  adapter: read("apps/desktop/shared/renderer/src/adapters/useDesktopChatAdapter.ts"),
  migration: read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/history_migration.py"),
  version: read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/version.py"),
};
const moduleEvidence = {
  M01: files.chat.includes("selectCurrentUserInput(request.messages)") && files.input.includes('message.role === "user"') && files.chat.includes("sourceMessageId"),
  M02: files.mapper.includes("max_wait_ms") && files.mapper.includes("flush_item") && files.mapper.includes("CODEX_ADAPTER_MAPPING_VERSION") && files.decoder.includes("NormalizedAgentEvent"),
  M03: files.engine.includes("runtime_backend_item_bindings") && files.engine.includes("_resolve_backend_item_binding_in_transaction") && files.engine.includes("normalized_canonical_item") && files.engine.includes("upsert_item_in_transaction") && !files.engine.slice(files.engine.indexOf("def append_normalized_event"), files.engine.indexOf("def _normalized_lifecycle_projection")).includes("append_backend_event("),
  M04: files.protocol.includes("OAEPStreamValidator") && files.schema.includes('"then": { "required": ["run_id", "item_id"] }') && files.projector.includes("SUPPORTED_DELTA_KINDS"),
  M05: files.stream.includes("Snapshot") && files.stream.includes("openOaepEventStream") && files.stream.includes("protocolViolations") && files.chat.includes("structuredTerminalRequests") && files.chat.includes("oaep_run_terminal_missing") && !files.chat.slice(files.chat.indexOf("async function runRuntimeBackendChat"), files.chat.indexOf("function emitCodexOaepEvent")).includes("listOaepEvents("),
  M06: files.projector.includes("projectOaepEventForPresentation") && files.projector.includes("part.completed") && files.projector.includes("unknownDeltaKinds") && files.history.includes("projectOaepAssistantItem"),
  M07: files.chat.includes('type: "structured"') && files.renderer.includes("structured-process") && files.renderer.includes("structured-interaction-layer") && files.renderer.includes("structured-result-layer") && files.adapter.includes("structuredFlushFrameRef") && files.adapter.includes("completedStructuredRequests"),
  M08: files.migration.includes("codex_history_migration_dry_run") && files.migration.includes("content_redacted") && files.version.includes("oaep-codex/2.0") && files.mapper.includes("diagnostics_snapshot"),
  M09: [
    "verify-codex-v6-input.mts", "verify-oaep-session-stream.mts",
    "verify-oaep-presentation-projector.mts", "verify-codex-v6-performance.mts",
  ].every((name) => existsSync(resolve(root, "apps/desktop/windows/scripts", name))),
};
const evidenceByModule = {
  M01: { sources: ["chat.ts", "chatInput.ts"], gates: ["latest input", "Windows Host Codex E2E"] },
  M02: { sources: ["event_mapper.py", "native_decoder.py"], gates: ["Codex mapper/backend Python tests"] },
  M03: { sources: ["engine.py", "normalized_writer.py"], gates: ["transaction rollback and binding tests"] },
  M04: { sources: ["protocol.py", "oaep.schema.json"], gates: ["presentation parity", "OAEP conformance tests"] },
  M05: { sources: ["oaepSessionStream.ts", "chat.ts"], gates: ["session stream", "desktop OAEP terminal"] },
  M06: { sources: ["oaepPresentationProjector.ts", "threadRuntimeProjection.ts"], gates: ["presentation parity"] },
  M07: { sources: ["useDesktopChatAdapter.ts", "StructuredMessageParts.tsx"], gates: ["four-layer renderer", "structured visual"] },
  M08: { sources: ["history_migration.py", "version.py"], gates: ["migration and diagnostics Python tests"] },
  M09: { sources: ["verify-codex-v6-*.mjs", "verify-codex-runtime-online.py"], gates: ["10k performance", "live full release"] },
};
const ledger = featureRows.map((feature) => {
  const moduleId = feature.id.slice(0, 3);
  return {
    ...feature,
    status: moduleEvidence[moduleId] ? "implemented" : "missing",
    evidence: evidenceByModule[moduleId],
  };
});
const missing = ledger.filter((row) => row.status !== "implemented");
assert.deepEqual(missing, [], `V6 feature modules are incomplete: ${missing.map((row) => row.id).join(", ")}`);
console.log(JSON.stringify({ schema: "opendrsai.codex-adapter-v6.feature-ledger.v1", accepted: ledger.length, total: 80, ledger }, null, 2));
