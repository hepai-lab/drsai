import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const repo = join(root, "..", "..", "..");
const gateway = readFileSync(join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "backend", "gateway.py"), "utf8");
const engine = readFileSync(join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "backend", "runtime", "engine.py"), "utf8");
const agent = readFileSync(join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "backend", "runtime", "agent.py"), "utf8");
const oaep = readFileSync(join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "backend", "runtime", "oaep.py"), "utf8");
const runtimeClient = readFileSync(join(root, "..", "shared", "main", "runtimeClient.ts"), "utf8");
const subscription = readFileSync(join(root, "..", "shared", "main", "threadRuntimeSubscription.ts"), "utf8");
const oaepSessionStream = readFileSync(join(root, "..", "shared", "main", "oaepSessionStream.ts"), "utf8");
const protocolSelection = readFileSync(join(root, "..", "shared", "main", "runtimeProtocolSelection.ts"), "utf8");
const projection = readFileSync(join(root, "..", "shared", "main", "threadRuntimeProjection.ts"), "utf8");
const presentationProjector = readFileSync(join(root, "..", "shared", "main", "oaepPresentationProjector.ts"), "utf8");
const chat = readFileSync(join(root, "..", "shared", "main", "chat.ts"), "utf8");
const chatAdapter = readFileSync(join(root, "..", "shared", "renderer", "src", "adapters", "useDesktopChatAdapter.ts"), "utf8");
const chatWorkspace = readFileSync(join(root, "..", "shared", "renderer", "src", "components", "ChatWorkspace.tsx"), "utf8");
const planDir = join(repo, "docs", "protocol_issue");
const planFile = readdirSync(planDir).find((name) => name.startsWith("OAEP_v1_Runtime_Bridge") && name.endsWith(".md"));
assert.ok(planFile, "OAEP implementation plan is missing.");
const plan = readFileSync(join(planDir, planFile), "utf8");

for (const capability of [
  "oaep.v1",
  "oaep.session.snapshot",
  "oaep.session.events",
  "oaep.session.events.stream",
  "event.cursor_expired",
]) {
  assert.ok(gateway.includes(`"${capability}"`), `Runtime capability missing: ${capability}`);
}

for (const route of [
  "/v1/sessions/{session_id}/oaep-snapshot",
  "/v1/sessions/{session_id}/oaep-events",
  "/v1/sessions/{session_id}/oaep-events/stream",
]) {
  assert.ok(gateway.includes(route), `Runtime OAEP route missing: ${route}`);
}

for (const method of ["oaep_snapshot", "list_oaep_events", "wait_oaep_events"]) {
  assert.ok(engine.includes(`def ${method}`), `RuntimeEngine method missing: ${method}`);
}

for (const symbol of [
  "project_snapshot",
  "project_event",
  "project_item",
  'OAEP_VERSION = "1.0"',
  'payload.get("message")',
]) {
  assert.ok(oaep.includes(symbol), `OAEP projection symbol missing: ${symbol}`);
}

for (const symbol of [
  "agent-failed:{run_id}",
  "append_backend_event(",
]) {
  assert.ok(agent.includes(symbol), `RuntimeAgentService failure projection missing: ${symbol}`);
}

for (const symbol of ["OaepSnapshot", "OaepEvent", "getOaepSnapshot", "openOaepEventStream"]) {
  assert.ok(runtimeClient.includes(symbol), `Desktop RuntimeClient OAEP symbol missing: ${symbol}`);
}

assert.ok(subscription.includes("selectRuntimeConversationProtocolResult(capabilities"), "Desktop subscription must use strict protocol selection.");
for (const handshakeField of ["runtimeId", "instanceId", "runtimeVersion", "protocolVersion", "schemaHash"]) {
  assert.ok(subscription.includes(handshakeField), `Desktop Runtime protocol evidence is missing ${handshakeField}.`);
}
for (const capability of ["oaep.v1", "oaep.session.snapshot", "oaep.session.events", "oaep.session.events.stream", "event.cursor_expired"]) {
  assert.ok(protocolSelection.includes(`"${capability}"`), `Desktop OAEP selection requirement missing: ${capability}`);
}
assert.ok(
  protocolSelection.includes('const OAEP_PROFILE = "oaep.session-stream/1"')
    && protocolSelection.includes("profiles.includes(OAEP_PROFILE)"),
  "Desktop subscription must require the OAEP profile.",
);
assert.ok(protocolSelection.includes("oaepProtocol.schema_sha256 === OAEP_SCHEMA_SHA256"),
  "Desktop subscription must require the exact OAEP schema hash.");
assert.ok(gateway.includes('"schema_sha256": OAEP_SCHEMA_SHA256'),
  "Runtime capability negotiation must advertise the generated OAEP schema hash.");
assert.ok(subscription.includes("subscribeOaepSession"), "Desktop thread subscription must use the shared OAEP Session controller.");
assert.ok(oaepSessionStream.includes("openOaepEventStream"), "Shared OAEP Session controller must open OAEP Event stream.");
for (const runtimeLogOperation of [
  "runtime.protocol.selected",
  "oaep.snapshot.loaded",
  "oaep.events.page",
  "oaep.stream.connected",
  "oaep.event.received",
  "oaep.subscription.retry",
]) {
  assert.ok(subscription.includes(runtimeLogOperation), `OAEP runtime log behavior missing: ${runtimeLogOperation}`);
}
assert.ok(subscription.includes("sanitizeRuntimeDetails"), "OAEP runtime log details must be sanitized before renderer delivery.");
assert.ok(!subscription.includes("data: event.data"), "OAEP runtime logs must not copy conversation or command payloads.");
assert.ok(subscription.includes("hasDelta") && subscription.includes("hasItem"), "OAEP runtime logs must retain content-free event shape diagnostics.");
assert.ok(projection.includes("projectOaepThreadSnapshot"), "Desktop projection must expose OAEP snapshot projection.");
assert.ok(chat.includes('"event.run.completed", "event.run.failed", "event.run.cancelled"'), "Desktop live chat must recognize every OAEP terminal state.");
assert.ok(presentationProjector.includes('type: "turn.error"'), "Desktop OAEP presentation must map Run failure to a visible structured error.");
assert.ok(presentationProjector.includes('type: "turn.cancelled"'), "Desktop OAEP presentation must map Run cancellation to a visible structured cancellation.");
assert.ok(chatAdapter.includes("runtimeVisibleError"), "Desktop chat adapter must preserve Runtime/OAEP error text for visible rendering.");
assert.ok(chatAdapter.includes("settleAssistantAfterHiddenError("), "Desktop chat adapter must explicitly settle failed assistant bubbles.");
assert.ok(!chatWorkspace.includes('{"No response content."}'), "Chat UI must not fall back to the old opaque No response content text.");
assert.ok(plan.includes("11 个模块，共 60 个功能点"), "OAEP implementation plan module/function count changed unexpectedly.");

console.log("OAEP Runtime contract verification passed.");
