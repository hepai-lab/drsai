import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const renderer = resolve(root, "shared/renderer/src");
const appPath = resolve(renderer, "App.tsx");
const app = readFileSync(appPath, "utf8");
const authenticatedApp = app.slice(
  app.indexOf("function AuthenticatedApp("),
  app.indexOf("function loadRemoteRecentPaths("),
);

const containers = {
  ModelSettingsContainer: "containers/ModelSettingsContainer.tsx",
  ResultsContainer: "containers/ResultsContainer.tsx",
  TaskShellContainer: "containers/TaskShellContainer.tsx",
  DiagnosticsContainer: "containers/DiagnosticsContainer.tsx",
};

for (const [name, relative] of Object.entries(containers)) {
  const path = resolve(renderer, relative);
  assert.equal(existsSync(path), true, `${name} module is missing`);
  assert.match(app, new RegExp(`import \\{[^}]*${name}[^}]*\\} from "\\./containers/`), `${name} is not imported by App`);
  assert.match(authenticatedApp, new RegExp(`<${name}\\b|use${name}Controller\\(`), `${name} is not composed by AuthenticatedApp`);
}

const forbiddenTopLevelDrafts = [
  "firstRunTaskDraft", "defaultWorkspaceBusy", "defaultWorkspaceMessage",
  "modelDraft", "providerDraft", "baseUrlDraft", "apiKeyDraft", "apiKeyEnvDraft",
  "modelConfigBusy", "modelConfigMessage", "modelConfigConflict",
  "operationalActionBusy", "operationalActionMessage", "resultsScopeRequestKey",
];
for (const name of forbiddenTopLevelDrafts) {
  assert.doesNotMatch(authenticatedApp, new RegExp(`\\[${name}\\s*,|set${name[0].toUpperCase()}${name.slice(1)}\\b`), `AuthenticatedApp still owns ${name}`);
}

for (const draft of ["modelDraft", "providerDraft", "baseUrlDraft", "apiKeyDraft", "apiKeyEnvDraft", "providerModelsDraft", "providerModelOperationsDraft"]) {
  assert.doesNotMatch(app, new RegExp(`const \\[${draft},\\s*set${draft[0].toUpperCase()}${draft.slice(1)}\\]\\s*=\\s*useState`), `App.tsx still owns ${draft}`);
}

const model = readFileSync(resolve(renderer, containers.ModelSettingsContainer), "utf8");
for (const draft of ["modelDraft", "providerDraft", "baseUrlDraft", "apiKeyDraft", "providerModelsDraft", "providerModelOperationsDraft"]) {
  assert.match(model, new RegExp(`\\[${draft}, set${draft[0].toUpperCase()}${draft.slice(1)}\\] = useState`), `model container does not own ${draft}`);
}

const results = readFileSync(resolve(renderer, containers.ResultsContainer), "utf8");
assert.match(results, /useResultsContainerController/);
assert.match(results, /requestWorkspaceScope/);

const taskShell = readFileSync(resolve(renderer, containers.TaskShellContainer), "utf8");
assert.match(taskShell, /ComponentProps<typeof WorkspaceShell>/);
assert.match(taskShell, /<WorkspaceShell \{\.\.\.props\} \/>/);

const diagnostics = readFileSync(resolve(renderer, containers.DiagnosticsContainer), "utf8");
assert.match(diagnostics, /const \[busy, setBusy\] = useState/);
assert.match(diagnostics, /const \[message, setMessage\] = useState/);
assert.match(diagnostics, /copyTextSafely/);
assert.doesNotMatch(diagnostics, /autoRecoverKey|completedAutomaticRecoveries/, "automatic Agent verification must not depend on whether the status popover is mounted");
assert.doesNotMatch(authenticatedApp, /automaticAgentModelVerificationsRef|recordSuccessfulModelUsage/, "ordinary startup and chat must not perform or synthesize model probes");
assert.equal((app.match(/testMyDrSaiModelProvider\(/g) ?? []).length, 1, "the saved-model probe must have exactly one renderer call site");
assert.match(app, /async function testModelConnection\(mode:[\s\S]{0,700}testingSavedModel[\s\S]{0,160}testMyDrSaiModelProvider\(providerDraft\.trim\(\), modelDraft\.trim\(\)\)/, "the saved-model probe must remain inside Model provider settings");
assert.match(authenticatedApp, /case "model":[\s\S]{0,700}setRequestedSettingsPane\("model-providers"\);[\s\S]{0,100}navigateTo\(MENU_IDS\.profile\)/, "global model recovery must navigate to Model provider settings without probing");

console.log(JSON.stringify({
  ok: true,
  schema: "opendrsai.frontend-container-boundary/1",
  independentContainers: Object.keys(containers),
  topLevelDomainDrafts: 0,
  modelCredentialDraftsOwned: true,
  resultRefreshOwned: true,
  diagnosticsTransientStateOwned: true,
  taskShellDelegated: true,
  appModelDraftsOwned: 0,
  modelProbeRendererCallSites: 1,
}, null, 2));
