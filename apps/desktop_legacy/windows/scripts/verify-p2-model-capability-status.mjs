import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const sources = {
  api: read("../shared/api/desktopApi.ts"),
  preload: read("../shared/main/preload.ts"),
  client: read("../shared/main/myDrSaiConfig.ts"),
  main: read("src/main/index.ts"),
  renderer: read("../shared/renderer/src/App.tsx"),
  styles: read("../shared/renderer/src/styles.css"),
  gateway: read("../../../cores/python/packages/drsai/src/drsai/backend/gateway.py"),
};

const requirements = [
  [sources.api, "AgentModelCapabilityStatus", "typed status response"],
  [sources.api, "getMyDrSaiAgentModelCapabilityStatus", "Desktop API method"],
  [sources.preload, "desktop:get-my-drsai-agent-model-capability-status", "preload bridge"],
  [sources.client, "/model-capability-status", "Gateway client route"],
  [sources.main, "desktop:get-my-drsai-agent-model-capability-status", "main IPC handler"],
  [sources.renderer, 'data-testid="agent-model-capability-status"', "visible settings status"],
  [sources.renderer, "runtime_verified", "Runtime verified state"],
  [sources.renderer, "No real capability probe results yet", "empty-state guidance"],
  [sources.styles, '.model-capability-status-row em[data-state="runtime_verified"]', "status styling"],
  [sources.gateway, '@app.get("/v1/config/agents/{agent_id}/model-capability-status")', "Gateway status endpoint"],
];
const missing = requirements.filter(([source, needle]) => !source.includes(needle));
if (missing.length) {
  for (const [, , label] of missing) console.error(`Missing: ${label}`);
  process.exit(1);
}
if (/api_key|authorization/i.test(sources.renderer.match(/className="model-capability-status"[\s\S]*?<\/div>}\n\s*<div className="settings-row">/)?.[0] ?? "")) {
  console.error("Capability status UI may expose credential material.");
  process.exit(1);
}
console.log("P2 model capability Desktop status verification passed.");
