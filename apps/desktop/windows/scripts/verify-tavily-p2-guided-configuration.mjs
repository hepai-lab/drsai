import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const renderer = read("apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx");
const adapter = read("apps/desktop/shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const workspace = read("apps/desktop/shared/renderer/src/components/ChatWorkspace.tsx");
const chat = read("apps/desktop/shared/main/chat.ts");
const projection = read("apps/desktop/shared/main/threadRuntimeProjection.ts");
const gateway = read("cores/python/packages/drsai/src/drsai/backend/gateway.py");

const checks = [
  [renderer, 'data-testid="capability-configuration-card"', "guided configuration card"],
  [renderer, 'data-state="configured"', "configured compact state"],
  [renderer, "网络感知器已配置", "configured success label"],
  [renderer, "capability-configuration-resume-status", "immediate continuation feedback"],
  [workspace, "configuredCapabilityRequestIds", "configured state survives rerender"],
  [renderer, 'type="password"', "masked API key input"],
  [renderer, "savePerceptor", "shared Perceptor save contract"],
  [renderer, "testPerceptor", "connection validation"],
  [renderer, "configurationPersisted", "save and validation transaction boundary"],
  [renderer, "automatic validation is temporarily inconclusive", "non-blocking transient validation"],
  [renderer, "需要网络感知器", "network Perceptor guidance"],
  [renderer, "设置 → 感知器配置", "settings navigation guidance"],
  [adapter, "capabilityConfigurationPartFromOaep", "authoritative OAEP interaction fallback"],
  [chat, '["pending", "running", "waiting"].includes(item.status)', "pending interaction response binding"],
  [chat, "awaiting_capability_configuration", "suspended execution acknowledgement"],
  [chat, "web_search_declined", "run-local no-network decision"],
  [projection, "capability_configuration", "reloadable OAEP projection"],
  [gateway, "query_disclosed", "privacy evidence"],
  [gateway, "trace.capability.configuration_required", "Inspector trace"],
  [gateway, "resuming_capability_configuration", "same-Run capability resume"],
  [gateway, 'display_prompt = str(run_record["input_message"])', "persisted Run input authority"],
  [gateway, "if not resuming_capability_configuration:", "first-bind-only Run input"],
  [gateway, '"run_input_conflict"', "immutable input conflict contract"],
  [gateway, "mark_user_config_stale(_effective_user_id(user_id))", "non-disruptive Perceptor activation"],
  [gateway, "_prefetch_configured_web_evidence", "Host-owned first retrieval after consent"],
  [gateway, "query_disclosed_after_resolution", "post-consent query disclosure evidence"],
  [gateway, '"configured_perceptor"', "configured Perceptor deterministic retrieval"],
  [gateway, '"query_disclosed_with_active_configuration"', "active-configuration disclosure evidence"],
  [gateway, '"activation": capability_web_activation', "retrieval activation provenance"],
];

for (const [source, needle, label] of checks) {
  if (!source.includes(needle)) throw new Error(`Missing Tavily P2 contract: ${label}`);
}
if (renderer.includes("console.log(apiKey") || gateway.includes('"api_key": request.prompt')) {
  throw new Error("Tavily P2 secret/query boundary regression");
}
const preflight = gateway.slice(
  gateway.indexOf("# Local capability preflight"),
  gateway.indexOf('append_event(run_id, "trace.request.accepted"'),
);
if (preflight.includes("_web_search_status")) {
  throw new Error("Tavily P2 preflight must not treat an implicit browser fallback as configured web search");
}
if (chat.includes('operation: "agent.waiting-model"')) {
  throw new Error("Capability configuration suspension must not be reported as waiting for the model");
}
if (!workspace.includes("Math.max(0, message.firstFeedbackAt - message.startedAt)")) {
  throw new Error("First-feedback latency must never render as a negative duration");
}
console.log(`Tavily P2 guided configuration verification passed (${checks.length} contracts).`);
