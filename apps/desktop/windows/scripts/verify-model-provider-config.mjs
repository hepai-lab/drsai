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

const requirements = [
  [api, "updateMyDrSaiModelConnection", "desktop API update contract"],
  [api, "testMyDrSaiModelProvider", "desktop API test contract"],
  [api, "testMyDrSaiModelDraft", "side-effect-free draft test contract"],
  [api, "listMyDrSaiModelProviderPresets", "provider preset contract"],
  [api, "discoverMyDrSaiProviderModels", "model discovery contract"],
  [preload, "desktop:update-my-drsai-model-connection", "preload update IPC"],
  [main, "desktop:update-my-drsai-model-connection", "main update IPC"],
  [renderer, 'data-testid="model-provider-settings"', "renderer settings form"],
  [renderer, 'type="password"', "masked API key input"],
  [renderer, 'data-testid="model-provider-test-basic"', "basic connection test action"],
  [renderer, 'data-testid="model-provider-test-model"', "explicit model call test action"],
  [renderer, 'data-testid="model-provider-test-dialog"', "model call fee confirmation dialog"],
  [renderer, 'data-testid="model-provider-test-model-confirm"', "confirmed model call action"],
  [renderer, 'data-testid="model-provider-conflict-reload"', "revision conflict reload action"],
  [renderer, '"Discover models"', "model discovery user flow"],
  [renderer, 'data-testid="model-provider-delete-dialog"', "semantic Provider deletion dialog"],
  [renderer, 'data-testid="model-provider-delete-with-credential"', "delete Provider and credential action"],
  [renderer, 'data-testid="model-provider-delete-keep-credential"', "delete Provider while retaining credential action"],
  [renderer, 'data-testid="model-provider-delete-cancel"', "side-effect-free Provider deletion cancel action"],
  [pythonGateway, '@app.get("/v1/config/model")', "gateway model read endpoint"],
  [pythonGateway, '@app.put("/v1/config/model-providers/{name}")', "gateway Provider update endpoint"],
  [pythonGateway, '@app.post("/v1/config/model-providers/test")', "gateway draft test endpoint"],
  [pythonGateway, '@app.get("/v1/config/model-providers/presets")', "gateway presets endpoint"],
  [pythonSchema, '"has_api_key": self.has_api_key', "redacted Provider response"],
];

const missing = requirements.filter(([source, needle]) => !source.includes(needle));
if (missing.length) {
  for (const [, , label] of missing) console.error(`Missing: ${label}`);
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
if (/response\.(?:text|content)|response\.headers/.test(pythonConnectivity)) {
  console.error("Connectivity probe may expose upstream response bodies or headers.");
  process.exit(1);
}
const draftTestBody = renderer.match(/async function testModelConnection[\s\S]*?\n  }/)?.[0] || "";
if (!draftTestBody.includes("testMyDrSaiModelDraft") || draftTestBody.includes("updateMyDrSaiModelConnection")) {
  console.error("Desktop draft test is not side-effect free.");
  process.exit(1);
}
if (!draftTestBody.includes('mode: "basic" | "model"') || !draftTestBody.includes("may have occurred") || !draftTestBody.includes("尚未验证指定模型调用")) {
  console.error("Desktop must distinguish side-effect-free basic connection and potentially billable model call results.");
  process.exit(1);
}
const deletionRequestBody = renderer.match(/function requestModelProviderDeletion[\s\S]*?\n  }/)?.[0] || "";
if (!deletionRequestBody || deletionRequestBody.includes("deleteMyDrSaiModelProvider") || renderer.includes("Also delete the credential from secure storage?")) {
  console.error("Provider deletion request must open the explicit three-action dialog without mutating state.");
  process.exit(1);
}
console.log("Model Provider desktop contract verification passed.");
