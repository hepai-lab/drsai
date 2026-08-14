import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const api = read("../shared/api/desktopApi.ts");
const preload = read("../shared/main/preload.ts");
const main = read("src/main/index.ts");
const renderer = read("../shared/renderer/src/App.tsx");
const pythonGateway = read("../../../cores/python/packages/drsai/src/drsai/backend/gateway.py");
const pythonSchema = read("../../../cores/python/packages/drsai/src/drsai/config/schema.py");
const pythonCredentials = read("../../../cores/python/packages/drsai/src/drsai/config/credentials.py");
const pythonConnectivity = read("../../../cores/python/packages/drsai/src/drsai/config/connectivity.py");
const pythonProbe = read("../../../cores/python/packages/drsai/src/drsai/config/probe.py");
const pythonImageOperations = read("../../../cores/python/packages/drsai/src/drsai/backend/runtime/image_operations.py");
const desktopConfig = read("../shared/main/myDrSaiConfig.ts");

const requirements = [
  [api, "updateMyDrSaiModelConnection", "desktop API update contract"],
  [api, "previewMyDrSaiModelConnection", "desktop API preview contract"],
  [api, "diagnoseMyDrSaiModelConnection", "desktop API Doctor contract"],
  [api, "restoreMyDrSaiModelConnection", "desktop API last-known-good restore contract"],
  [api, "testMyDrSaiModelProvider", "desktop API test contract"],
  [api, "testMyDrSaiModelDraft", "side-effect-free draft test contract"],
  [api, "listMyDrSaiModelProviderPresets", "provider preset contract"],
  [api, "discoverMyDrSaiProviderModels", "model discovery contract"],
  [api, "getMyDrSaiAgentModelCapabilityStatus", "Agent model capability status contract"],
  [preload, "desktop:update-my-drsai-model-connection", "preload update IPC"],
  [preload, "desktop:preview-my-drsai-model-connection", "preload preview IPC"],
  [preload, "desktop:diagnose-my-drsai-model-connection", "preload Doctor IPC"],
  [preload, "desktop:restore-my-drsai-model-connection", "preload restore IPC"],
  [main, "desktop:update-my-drsai-model-connection", "main update IPC"],
  [main, "desktop:preview-my-drsai-model-connection", "main preview IPC"],
  [main, "desktop:diagnose-my-drsai-model-connection", "main Doctor IPC"],
  [main, "desktop:restore-my-drsai-model-connection", "main restore IPC"],
  [main, "desktop:get-my-drsai-agent-model-capability-status", "main capability status IPC"],
  [renderer, 'data-testid="model-provider-settings"', "renderer settings form"],
  [renderer, 'type="password"', "masked API key input"],
  [renderer, 'data-testid="model-provider-test-basic"', "basic connection test action"],
  [renderer, 'data-testid="model-provider-test-model"', "explicit model call test action"],
  [renderer, 'data-testid="model-provider-test-dialog"', "model call fee confirmation dialog"],
  [renderer, 'data-testid="model-provider-test-model-confirm"', "confirmed model call action"],
  [renderer, 'data-testid="model-provider-test-output"', "bounded model call output"],
  [renderer, 'data-testid="model-provider-model-new-input"', "inline new-model input"],
  [renderer, 'data-testid="model-provider-model-new-confirm"', "inline new-model confirmation"],
  [renderer, "model-provider-model-alias-", "per-model alias editor"],
  [renderer, 'data-testid="model-provider-dirty-indicator"', "unsaved Provider indicator"],
  [renderer, 'data-testid="model-provider-save-use"', "dirty-aware save-and-use action"],
  [renderer, 'data-testid="model-provider-preview-dialog"', "side-effect-free save preview dialog"],
  [renderer, 'data-testid="model-provider-preview-cancel"', "side-effect-free preview cancel action"],
  [renderer, 'data-testid="model-provider-doctor-result"', "Model Doctor result UI"],
  [renderer, 'data-testid="model-provider-restore-last-good"', "last-known-good recovery action"],
  [renderer, 'data-testid="model-provider-conflict-reload"', "revision conflict reload action"],
  [renderer, '"Discover models"', "model discovery user flow"],
  [renderer, 'data-testid="model-provider-delete-dialog"', "semantic Provider deletion dialog"],
  [renderer, 'data-testid="model-provider-delete-with-credential"', "delete Provider and credential action"],
  [renderer, 'data-testid="model-provider-delete-keep-credential"', "delete Provider while retaining credential action"],
  [renderer, 'data-testid="model-provider-delete-cancel"', "side-effect-free Provider deletion cancel action"],
  [renderer, 'testId: "agent-image-understanding-model-setting"', "Agent image understanding model setting"],
  [renderer, 'testId: "agent-image-generation-model-setting"', "Agent image generation model setting"],
  [renderer, 'testId: "agent-text-to-speech-model-setting"', "Agent text-to-speech model setting"],
  [renderer, 'testId: "agent-speech-to-text-model-setting"', "Agent speech-to-text model setting"],
  [renderer, 'data-testid="agent-model-capability-status"', "Agent model capability status UI"],
  [renderer, '"image_generation"', "per-model image generation declaration"],
  [renderer, '"image_edit"', "per-model image editing declaration"],
  [pythonGateway, '@app.get("/v1/config/model")', "gateway model read endpoint"],
  [pythonGateway, '@app.post("/v1/config/model/preview")', "gateway atomic preview endpoint"],
  [pythonGateway, '@app.post("/v1/config/model/doctor")', "gateway Model Doctor endpoint"],
  [pythonGateway, '@app.post("/v1/config/model/restore")', "gateway last-known-good restore endpoint"],
  [pythonGateway, '@app.put("/v1/config/model-providers/{name}")', "gateway Provider update endpoint"],
  [pythonGateway, '@app.post("/v1/config/model-providers/test")', "gateway draft test endpoint"],
  [pythonGateway, '@app.get("/v1/config/model-providers/presets")', "gateway presets endpoint"],
  [pythonGateway, '@app.get("/v1/config/agents/{agent_id}/model-capability-status")', "gateway capability status endpoint"],
  [pythonSchema, '"has_api_key": self.has_api_key', "redacted Provider response"],
  [pythonSchema, '"model_aliases": dict(self.model_aliases)', "public model aliases"],
  [pythonSchema, '"model_operations": {key: list(value)', "public image operation declarations"],
  [pythonGateway, "core_tools = [image_generation, image_edit]", "native image tools injected into production Agent"],
  [pythonImageOperations, '/images/generations', "exact image generation route"],
  [pythonImageOperations, '/images/edits', "exact image edit route"],
  [pythonImageOperations, 'publish_content', "image output published through Runtime Artifact store"],
];

const missing = requirements.filter(([source, needle]) => !source.includes(needle));
if (missing.length) {
  for (const [, , label] of missing) console.error(`Missing: ${label}`);
  process.exit(1);
}
const providerActionsIndex = renderer.indexOf('className="model-provider-actions"');
const providerMessageIndex = renderer.indexOf("{modelConfigMessage &&");
const providerOutputIndex = renderer.indexOf('data-testid="model-provider-test-output"');
if (!(providerActionsIndex < providerMessageIndex && providerMessageIndex < providerOutputIndex)) {
  console.error("Model call output must render after Provider actions and status messages.");
  process.exit(1);
}
const publicProviderSerializer = pythonSchema.match(/class ProviderConfig:[\s\S]*?def public_dict[\s\S]*?\n\n\n@dataclass/)?.[0] || "";
if (!publicProviderSerializer || publicProviderSerializer.includes("reveal(")) {
  console.error("Provider public serializer may expose a revealed API key.");
  process.exit(1);
}
if (pythonCredentials.includes('"-w", secret') || pythonCredentials.includes("'-w', secret")) {
  console.error("macOS Keychain command exposes the secret in process arguments.");
  process.exit(1);
}
if (!pythonCredentials.includes("SecKeychainAddGenericPassword") || !pythonCredentials.includes("Security.framework/Security")) {
  console.error("macOS model Provider credentials must use the native Security.framework boundary.");
  process.exit(1);
}
if (/response\.(?:text|content)|response\.headers/.test(pythonConnectivity)) {
  console.error("Connectivity probe may expose upstream response bodies or headers.");
  process.exit(1);
}
if (!desktopConfig.includes('"X-OpenDrSai-Auth-Mode": "oidc"') || !desktopConfig.includes('provider === "hepai" ? await oidcGatewayHeaders()') || !desktopConfig.includes("value.error") || !pythonProbe.includes('draft.name == "hepai"') || !pythonProbe.includes("credential.openai_base_url") || !pythonGateway.includes('auth = get_platform_auth() if req.provider == "hepai" else None') || !renderer.includes('data-testid="model-provider-account-auth"')) {
  console.error("HepAI draft tests must use request-scoped OIDC credentials and preserve structured Gateway errors.");
  process.exit(1);
}
if (!renderer.includes('data-testid="model-provider-api-host"') || !renderer.includes('{zh ? "API 主机：" : "API host: "}{myDrSaiConfig.modelConnection.provider.base_url}')) {
  console.error("Every Provider, including HepAI, must display its effective API host.");
  process.exit(1);
}
if (!renderer.includes('data-testid="model-provider-configuration-indicator"') || !renderer.includes('zh ? "已配置" : "Configured"') || !renderer.includes('zh ? "未配置" : "Not configured"')) {
  console.error("Model Providers must expose configured and unconfigured states explicitly.");
  process.exit(1);
}
if (!renderer.includes('className="model-provider-model-table-header"') || !renderer.includes('function ModelModalityBadges') || !renderer.includes('function ModelApiProtocolBadge') || !renderer.includes('"OpenAI API 兼容"') || !renderer.includes('"Anthropic API 兼容"') || !renderer.includes('"Google API 兼容"')) {
  console.error("Provider models must use the canonical model table with recognizable modality and API protocol badges.");
  process.exit(1);
}
if (!renderer.includes("function duplicateProviderModel") || !renderer.includes("model-provider-model-edit-${model}") || !renderer.includes("model-provider-model-copy-${model}") || !renderer.includes('data-testid="model-provider-model-editor"')) {
  console.error("Provider model rows must expose edit and copy actions backed by the model information editor.");
  process.exit(1);
}
if (!renderer.includes('modalities.map((modality)') || !renderer.includes('direction="input"') || !renderer.includes('direction="output"') || !renderer.includes('className="model-modality-separator" aria-hidden>→</span>') || !renderer.includes('protocol-${kind} is-supported') || renderer.includes('(["openai", "anthropic", "google"] as const).map')) {
  console.error("Provider model rows must show only supported input/output modalities and only the configured API protocol.");
  process.exit(1);
}
if (!renderer.includes("modelConfigsForSave") || !renderer.includes("providerModelConfigsDraft") || !renderer.includes('apiProtocol: protocol.id') || !renderer.includes('type="checkbox" checked={config.enabled}')) {
  console.error("Provider models must support direct per-model editing and structured model persistence.");
  process.exit(1);
}
if (!renderer.includes('aria-label={zh ? "添加协议主机" : "Add protocol host"}') || renderer.includes('disabled={usesOidcProviderAuth || ((wireApiDraft === "anthropic"')) {
  console.error("HepAI OIDC Providers must allow adding Anthropic and Google protocol hosts.");
  process.exit(1);
}
if (!renderer.includes("BUILTIN_MODEL_PROVIDER_PRESETS") || !renderer.includes("effectiveModelProviderPresets") || !renderer.includes("visibleModelProviderIds") || !renderer.includes("configuredModels")) {
  console.error("Built-in Provider presets must remain available, deduplicated, and populated while Gateway data loads.");
  process.exit(1);
}
if (!renderer.includes('selectableCapabilityModels("image", "text")') || !renderer.includes('model.output_modalities?.includes("image")') || !renderer.includes('selectableCapabilityModels("text", "audio")') || !renderer.includes('selectableCapabilityModels("audio", "text")')) {
  console.error("Agent capability model controls must be driven by declared input/output modalities.");
  process.exit(1);
}
if (pythonImageOperations.includes('follow_redirects=True') || !pythonImageOperations.includes('follow_redirects=False') || !pythonImageOperations.includes('response_format": "b64_json"')) {
  console.error("Image operations must reject redirects and require bounded inline image data.");
  process.exit(1);
}
const draftTestBody = renderer.match(/async function testModelConnection[\s\S]*?\n  }/)?.[0] || "";
if (!draftTestBody.includes("testMyDrSaiModelDraft") || draftTestBody.includes("updateMyDrSaiModelConnection")) {
  console.error("Desktop draft test is not side-effect free.");
  process.exit(1);
}
if (!draftTestBody.includes('mode: "basic" | "model"') || !draftTestBody.includes("Connection succeeded.") || !draftTestBody.includes("Model call succeeded.") || !renderer.includes("may incur a small charge")) {
  console.error("Desktop must distinguish connection and model-call success while warning about cost before the model call.");
  process.exit(1);
}
if (!renderer.includes("modelConnectionRevision") || !renderer.includes('activePane !== "model-providers"') || !renderer.includes("setProviderModelAliasesDraft(provider.model_aliases ?? {})") || !renderer.includes("modelProviderDirty") || !renderer.includes("modelConnectionDirty") || !renderer.includes("!modelProviderDirty") || !renderer.includes("!modelConnectionDirty")) {
  console.error("Provider drafts must survive probe refreshes and expose dirty-aware save actions.");
  process.exit(1);
}
const deletionRequestBody = renderer.match(/function requestModelProviderDeletion[\s\S]*?\n  }/)?.[0] || "";
if (!deletionRequestBody || deletionRequestBody.includes("deleteMyDrSaiModelProvider") || renderer.includes("Also delete the credential from secure storage?")) {
  console.error("Provider deletion request must open the explicit three-action dialog without mutating state.");
  process.exit(1);
}
console.log("Model Provider desktop contract verification passed.");
