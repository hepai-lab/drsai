import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire, stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import type * as TypeScript from "typescript";
const ts: typeof TypeScript = createRequire(import.meta.url)("typescript");

// Inspect executable AST nodes, not substring matches: commented-out handlers
// previously passed source checks while Electron reported "No handler registered".
// No app launch, network, user configuration or credentials are needed.
const root = resolve(dirname(resolve(process.argv[2])), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const parse = (name: string, text: string) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const main = parse("index.ts", read("windows/src/main/index.ts"));
const preload = parse("preload.ts", read("shared/main/preload.ts"));
const registration = main.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "registerIpc");
assert.ok(registration && ts.isFunctionDeclaration(registration) && registration.body);
const calls = registration.body.statements.flatMap((node) =>
  ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(main) === "secureHandle" ? [node.expression] : []);
const channels = calls.map((call) => {
  assert.ok(ts.isStringLiteral(call.arguments[0]));
  return call.arguments[0].text;
});
assert.equal(new Set(channels).size, channels.length, "duplicate direct IPC registration can abort startup");

const contracts = [
  ["updateMyDrSaiModelConnection", "desktop:update-my-drsai-model-connection", [{ model: "example" }]],
  ["previewMyDrSaiModelConnection", "desktop:preview-my-drsai-model-connection", [{ model: "example" }]],
  ["diagnoseMyDrSaiModelConnection", "desktop:diagnose-my-drsai-model-connection", [true]],
  ["restoreMyDrSaiModelConnection", "desktop:restore-my-drsai-model-connection", ["a".repeat(64)]],
  ["saveMyDrSaiModelProvider", "desktop:save-my-drsai-model-provider", ["example", { base_url: "https://example.invalid/v1", requires_api_key: false }]],
  ["testMyDrSaiModelProvider", "desktop:test-my-drsai-model-provider", ["example", "example-model"]],
  ["probeMyDrSaiProviderModel", "desktop:probe-my-drsai-provider-model", ["example", { model: "example-model", operation: "chat" }]],
  ["testMyDrSaiModelDraft", "desktop:test-my-drsai-model-draft", [{ model_provider: "example" }, "model"]],
  ["listMyDrSaiModelProviderPresets", "desktop:list-my-drsai-model-provider-presets", []],
  ["discoverMyDrSaiProviderModels", "desktop:discover-my-drsai-provider-models", ["example", true, { base_url: "https://example.invalid/v1", requires_api_key: false }]],
  ["preflightMyDrSaiModelProviderDeletion", "desktop:preflight-my-drsai-model-provider-deletion", ["example"]],
  ["deleteMyDrSaiModelProvider", "desktop:delete-my-drsai-model-provider", ["example", false]],
  ["preflightMyDrSaiModelDeletion", "desktop:preflight-my-drsai-model-deletion", ["example", "example-model"]],
  ["deleteMyDrSaiModel", "desktop:delete-my-drsai-model", ["example", "example-model", "a".repeat(64)]],
] as const;

const apiDeclaration = preload.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find((node) => node.name.getText(preload) === "api");
assert.ok(apiDeclaration?.initializer && ts.isObjectLiteralExpression(apiDeclaration.initializer));
const properties = apiDeclaration.initializer.properties;
const configImport = main.statements.find((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "../../../shared/main/myDrSaiConfig");
assert.ok(configImport && ts.isImportDeclaration(configImport));
const imports = configImport.importClause?.namedBindings;
assert.ok(imports && ts.isNamedImports(imports));
const importedNames = new Set(imports.elements.map((node) => node.name.text));
const serviceSource = parse("myDrSaiConfig.ts", read("shared/main/myDrSaiConfig.ts"));
const serviceNames = new Set(serviceSource.statements.filter(ts.isFunctionDeclaration).map((node) => node.name?.text));
const settingsSource = ts.createSourceFile(
  "SettingsPanel.tsx",
  read("shared/renderer/src/components/SettingsPanel.tsx"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let savedModelDeletion: TypeScript.FunctionDeclaration | undefined;
const findSavedModelDeletion = (node: TypeScript.Node): void => {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "deleteSavedProviderModel") savedModelDeletion = node;
  ts.forEachChild(node, findSavedModelDeletion);
};
findSavedModelDeletion(settingsSource);
assert.ok(savedModelDeletion, "Settings must implement saved model deletion");
const savedModelDeletionText = savedModelDeletion.getText(settingsSource);
assert.match(savedModelDeletionText, /preflightMyDrSaiModelDeletion\s*\(/);
assert.match(savedModelDeletionText, /deleteMyDrSaiModel\s*\(/);
assert.doesNotMatch(savedModelDeletionText, /deleteMyDrSaiModelProvider\s*\(/,
  "model deletion must never call Provider DELETE");
assert.ok(savedModelDeletionText.indexOf("preflightMyDrSaiModelDeletion") < savedModelDeletionText.indexOf("deleteMyDrSaiModel("),
  "model preflight must happen before model DELETE");
assert.match(read("windows/src/main/myDrSaiConfig.ts"), /export \* from "\.\.\/\.\.\/\.\.\/shared\/main\/myDrSaiConfig"/);
assert.match(read("windows/src/preload/index.ts"), /import "\.\.\/\.\.\/\.\.\/shared\/main\/preload"/);

for (const [method, channel, sampleArgs] of contracts) {
  const matches = calls.filter((_, index) => channels[index] === channel);
  assert.equal(matches.length, 1, `${method}: exactly one executable handler must be registered`);
  assert.ok(importedNames.has(method), `${method}: main must import the shared service`);
  assert.ok(serviceNames.has(method), `${method}: shared implementation must exist`);
  const property = properties.find((node) => node.name?.getText(preload) === method);
  assert.ok(property && ts.isPropertyAssignment(property), `${method}: shared preload method missing`);
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let serviceCalls: unknown[][] = [];
  let failure: Error | undefined;
  const response = { ok: true, fixture: method };
  const scope = {
    secureHandle: (name: string, handler: (...args: unknown[]) => unknown) => {
      assert.ok(!handlers.has(name));
      handlers.set(name, handler);
    },
    [method]: async (...args: unknown[]) => {
      serviceCalls.push(args);
      if (failure) throw failure;
      return response;
    },
    ipcRenderer: {
      invoke: async (name: string, ...args: unknown[]) => {
        assert.equal(name, channel, `${method}: preload channel mismatch`);
        const handler = handlers.get(name);
        assert.ok(handler, `No handler registered for ${name}`);
        return handler({ sender: "fixture" }, ...args);
      },
    },
  };
  // Execute the real registration callback and real preload method with only
  // the transport/service replaced. Registration itself must not call services.
  runInNewContext(stripTypeScriptTypes(matches[0].getText(main)), scope);
  assert.equal(serviceCalls.length, 0, `${method}: registration must not require a running gateway`);
  const invoke = runInNewContext(stripTypeScriptTypes(`(${property.initializer.getText(preload)})`), scope) as (...args: unknown[]) => Promise<unknown>;
  for (const args of [Array.from(sampleArgs), ...(sampleArgs.length > 1 ? [[sampleArgs[0]]] : [])]) {
    serviceCalls = [];
    assert.equal(await invoke(...args), response);
    assert.equal(serviceCalls.length, 1);
    // Optional trailing arguments are explicitly forwarded as undefined.
    for (let index = 0; index < serviceCalls[0].length; index += 1) assert.equal(serviceCalls[0][index], args[index]);
    assert.ok(serviceCalls[0].length >= args.length, `${method}: lost argument`);
  }
  failure = new Error("fixture gateway unavailable");
  await assert.rejects(invoke(...sampleArgs), (error) => error === failure);
  failure = undefined;
  assert.equal(await invoke(...sampleArgs), response, `${method}: service errors must not remove handlers`);
}

// Normal startup must synchronously complete registration before creating the
// renderer. Do not catch registration failures and continue with a partial API.
const readyStatement = main.statements.find((node) => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
  && node.expression.expression.getText(main) === "app.whenReady().then");
assert.ok(readyStatement && ts.isExpressionStatement(readyStatement) && ts.isCallExpression(readyStatement.expression));
const ready = readyStatement.expression.arguments[0];
assert.ok(ts.isArrowFunction(ready) && ts.isBlock(ready.body));
const startupCalls = ready.body.statements.filter(ts.isExpressionStatement).map((node) => node.expression.getText(main));
assert.equal(startupCalls.filter((text) => text === "registerIpc()").length, 1);
assert.ok(startupCalls.indexOf("registerIpc()") < startupCalls.indexOf("createWindow()"));
console.log(`Model provider IPC verification passed (${contracts.length} shared-preload/main contracts, arguments, errors, duplicate registrations and startup order).`);
