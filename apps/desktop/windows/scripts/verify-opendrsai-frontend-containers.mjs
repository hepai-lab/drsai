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
assert.match(diagnostics, /completedAutomaticRecoveries\.has\(autoRecoverKey\)/, "model verification must be deduplicated per selected configuration");
assert.match(diagnostics, /void recover\(\)/, "unverified persisted models must be checked automatically");
assert.match(authenticatedApp, /testMyDrSaiModelProvider\(provider, model\)/, "model recovery must test the selected persisted model inline");
assert.match(authenticatedApp, /autoRecoverKey=\{operationalDecision\.currentLayer === "model"[\s\S]{0,600}operationalDecision\.state === "untested"/, "only untested model state may trigger automatic verification");
assert.match(authenticatedApp, /if \(!config\?\.modelConnection\?\.model \|\| !config\.modelConnection\.model_provider\)/, "model recovery must open settings only when persisted configuration is unavailable");

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
}, null, 2));
