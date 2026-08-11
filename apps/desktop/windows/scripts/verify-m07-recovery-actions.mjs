import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = readFileSync(resolve(root, "../shared/renderer/src/App.tsx"), "utf8");
const bar = readFileSync(resolve(root, "../shared/renderer/src/components/OperationalStateBar.tsx"), "utf8");
const checks = {
  identityAction: /currentLayer === "identity"[\s\S]*Go to sign in/.test(bar),
  runtimeAction: /currentLayer === "runtime"[\s\S]*Repair and retry runtime/.test(bar),
  modelActions: /Reconfigure HAI model/.test(bar) && /Test model connection/.test(bar),
  workspaceActions: /Trust this workspace/.test(bar) && /Choose workspace/.test(bar),
  runActions: /Review pending approval/.test(bar) && /Review and retry task/.test(bar),
  diagnosticAction: /operational-copy-diagnostics/.test(bar) && /Copy redacted diagnostics/.test(bar),
  runtimeExecutes: /await auth\.retryBootstrap\(\);[\s\S]*await desktop\.refreshHealth\(\)/.test(app),
  modelExecutes: /setRequestedSettingsPane\("model-providers"\);[\s\S]*navigateTo\(MENU_IDS\.profile\)/.test(app),
  workspaceExecutes: /handleUpdateWorkspace\(selectedSetupWorkspace\.id, \{ trusted: true \}\)/.test(app) && /handleAddLocalWorkspace\(\)/.test(app),
  approvalExecutes: /MENU_IDS\.approvalCenter/.test(app),
  runRetryViewExecutes: /MENU_IDS\.savedPlan/.test(app),
  noInfiniteBusy: /finally \{[\s\S]{0,100}setOperationalActionBusy\(false\)/.test(app),
  failureIsUserFacing: /setOperationalActionMessage\(userFacingFailureMessage\(error, language\)\)/.test(app),
  diagnosticsBounded: /currentLayer: operationalDecision\.currentLayer/.test(app) && /runtimeReady: health\?\.gatewayReady/.test(app),
};
const failed = Object.entries(checks).filter(([, passed]) => !passed);
if (failed.length) throw new Error(`M07 recovery action contract failed: ${failed.map(([name]) => name).join(", ")}`);
console.log(`M07 recovery action contract passed (${Object.keys(checks).length}/${Object.keys(checks).length}).`);
