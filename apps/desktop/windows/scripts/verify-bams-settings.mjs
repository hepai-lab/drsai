import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "..");
const app = readFileSync(resolve(root, "shared/renderer/src/App.tsx"), "utf8");
const panel = readFileSync(resolve(root, "shared/renderer/src/components/PerceptorSettingsPanel.tsx"), "utf8");
const api = readFileSync(resolve(root, "shared/api/desktopApi.ts"), "utf8");
const main = readFileSync(resolve(root, "shared/main/myDrSaiConfig.ts"), "utf8");
const preload = readFileSync(resolve(root, "shared/main/preload.ts"), "utf8");

for (const pane of ["perceptors", "executors", "memories"]) {
  assert.ok(app.includes(`id: "${pane}"`), `Settings navigation is missing ${pane}.`);
  assert.ok(app.includes(`activePane === "${pane}"`), `Settings content is missing ${pane}.`);
}
for (const marker of ["listPerceptors", "savePerceptor", "updatePerceptor", "testPerceptor", "deletePerceptor"]) {
  assert.ok(panel.includes(`desktopApi.${marker}`), `Perceptor UI is missing ${marker}.`);
}
assert.ok(panel.includes("requestAppDecision"), "Perceptor deletion must use the focus-safe app decision dialog.");
assert.ok(!panel.includes("window.confirm"), "Perceptor settings must not use native confirm dialogs on Windows.");
for (const kind of ["public_web", "large_facility_data", "tavily", "facility_gateway"]) {
  assert.ok(panel.includes(kind), `Perceptor UI is missing ${kind}.`);
}
assert.ok(api.includes("updatePerceptor(perceptorId: string"), "Desktop API lacks perceptor update.");
assert.ok(main.includes('gatewayRequest(gateway.baseUrl, "PUT", `/v1/config/perceptors/'), "Main bridge lacks perceptor PUT.");
assert.ok(preload.includes('desktop:update-perceptor'), "Preload lacks perceptor update IPC.");

console.log("BAMS settings verification passed (perceptors CRUD, Tavily, facility data, executor and memory entry points).")
