import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import type * as TypeScript from "typescript";
const ts: typeof TypeScript = createRequire(import.meta.url)("typescript");

// Source contracts plus isolated handler execution. No Electron/backend or real credentials.
const root = resolve(dirname(resolve(process.argv[2])), "../renderer/src");
const panelPath = resolve(root, "components/SettingsPanel.tsx");
const directPath = resolve(root, "components/providerDirectSetup.ts");
const source = readFileSync(panelPath, "utf8");
const styles = readFileSync(resolve(root, "styles.css"), "utf8");

function declarations(file: string, text: string): Map<string, string> {
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const table = new Map<string, string>();
  const visit = (node: TypeScript.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) table.set(node.name.text, node.getText(tree).replace(/^export\s+(?:default\s+)?/, ""));
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return table;
}
// The panel delegates model-entry shaping to providerDirectSetup; execute both sources together.
const functions = new Map([...declarations(directPath, readFileSync(directPath, "utf8")), ...declarations(panelPath, source)]);
function handler(name: string, context: Record<string, unknown>) {
  const text = functions.get(name);
  assert.ok(text, name);
  const js = ts.transpileModule(`${text}\nglobalThis.invoke = ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const sandbox = vm.createContext(context);
  vm.runInContext(js, sandbox);
  return sandbox.invoke as (...args: any[]) => any;
}
/** Opening tag of a testid, tolerant of arrow-function "=>" inside event handlers. */
function openingTag(testId: string): string {
  const at = source.indexOf(`data-testid="${testId}"`);
  assert.ok(at >= 0, `${testId} must exist`);
  const start = source.lastIndexOf("<", at);
  let end = at;
  for (;;) {
    end = source.indexOf(">", end + 1);
    assert.ok(end > 0, `${testId} tag must close`);
    if (source[end - 1] !== "=") break;
  }
  return source.slice(start, end + 1);
}
function disabledConditions(testId: string): string {
  const match = /disabled=\{([^}]*)\}/.exec(openingTag(testId));
  assert.ok(match, `${testId} must be conditionally disabled`);
  return match[1];
}
function stateContext(extra: Record<string, unknown> = {}) {
  const values: Record<string, any> = {};
  const setters = Object.fromEntries([...source.matchAll(/\b(set[A-Z]\w*)\(/g)].map((m) => [m[1], (value: any) => { values[m[1]] = typeof value === "function" ? value(values[m[1]] ?? {}) : value; }]));
  const context = { ...setters, URL, zh: true, language: "zh", modelConfigBusy: false, modelProviderDirty: false, providerDraft: "custom", baseUrlDraft: "https://api.test/v1", providerDiscoveryCredentialReady: true, providerModelsDraft: ["m"], modelDraft: "m", providerModelConfigsDraft: {}, wireApiDraft: "openai", newProviderModelDraft: "", userFacingFailureMessage: () => "failed", normalizeRuntimeErrorEnvelope: () => ({ code: "unknown" }), currentModelSnapshot: () => ({ id: "m", models: { m: { enabled: true, capabilities: ["chat"] } } }), ...extra };
  return { values, context: { ...context, modelProviderSetupIssue: handler("modelProviderSetupIssue", context) } };
}
const directHelpers = { directTokenBudget: handler("directTokenBudget", {}), replaceDirectModel: handler("replaceDirectModel", {}), providerModelConfigForWrite: handler("providerModelConfigForWrite", {}) };
const defaultEditor = { originalId: null, modelId: "new-model", alias: "", inputModalities: ["text"], outputModalities: ["text"], apiProtocol: "openai", enabled: true, capabilities: ["chat"], tokenLimit: "64000", maxTokens: "8000", reasoningEfforts: [], origin: "user" };
/** Run the real draft-snapshot builder with the real budget/dedup helpers. */
function snapshotWithEditor(extra: Record<string, unknown> = {}) {
  const context = { zh: true, wireApiDraft: "openai", anthropicBaseUrlDraft: "", geminiBaseUrlDraft: "", providerModelConfigsDraft: {}, modelConfigsForSave: () => ({ existing: { api_protocol: "openai" } }), ...directHelpers, providerModelEditor: { ...defaultEditor }, ...extra };
  return handler("currentModelSnapshot", context)();
}
function editorSnapshot(over: Record<string, unknown>) {
  return snapshotWithEditor({ providerModelEditor: { ...defaultEditor, ...over } });
}

assert.match(source, /const visibleModelProviderTabs = \[\{ id: "__new-custom-provider__"/);
// The edited provider is pinned inline, the draft tab is never duplicated, and a crowded
// tab bar wraps instead of pushing the add/overflow controls out of the settings pane.
assert.match(source, /function computeModelProviderTabLayout\(\{ tabs, primaryIds, draftTabId, pinned \}/);
assert.match(source, /entry\.id === draftTabId/);
assert.match(source, /pinned: \[recentOverflowModelProviderTabEntry, activeModelProviderTabEntry\]/);
assert.match(styles, /\.model-provider-tabs \{[^}]*flex-wrap: wrap;/);
assert.match(styles, /\.model-provider-tablist \{[^}]*flex-wrap: wrap;/);
assert.match(source, /if \(!providerDraft\) addCustomModelProvider\(\)/);
assert.doesNotMatch(source, /\[activePane, activeModelProviderTab, modelConnectionRevision, modelProviderInventory\]/);
// Simple setup stays URL -> key -> model, and the model has exactly one editing surface.
const url = source.indexOf('data-testid="model-provider-api-host"');
const key = source.indexOf('data-testid="model-provider-api-key"');
const selection = source.indexOf('data-testid="model-provider-model-selection"');
const editor = source.indexOf('data-testid="model-provider-model-editor"');
const modelId = source.indexOf('data-testid="model-provider-model-id"');
assert.ok(url < key && key < selection && selection < editor && editor < modelId, "API URL, key, model selection, model editor, model ID order");
assert.match(openingTag("model-provider-api-host"), /readOnly=\{usesOidcProviderAuth\}/);
assert.match(openingTag("model-provider-api-key"), /type="password"/);
assert.match(openingTag("model-provider-model-id"), /aria-required="true"/);
assert.match(openingTag("model-provider-model-id"), /value=\{providerModelEditor\.modelId\}/);
// The retired "type a model ID then add it to the draft" step must not come back.
assert.doesNotMatch(source, /value=\{newProviderModelDraft\}/);
assert.doesNotMatch(source, /添加到草稿|保存到草稿|model-provider-model-new-input/);
for (const id of ["model-provider-model-details", "model-provider-endpoints", "model-provider-recovery"]) {
  const opening = source.match(new RegExp(`<details[^>]*data-testid="${id}"[^>]*>`))?.[0];
  assert.ok(opening, id);
  assert.doesNotMatch(opening, /\bopen(?:=|\s|>)/);
}
assert.match(source, /留空保留原密钥/);
assert.match(source, /return result && !modelProviderDirty/);
assert.match(source, /lastModelTestDraftFingerprint !== modelDraftFingerprint/);
assert.match(source, /disabled=\{modelProviderDirty \|\| modelConfigBusy \|\| !config.enabled/);
assert.match(source, /\.map\(\(entry\) => entry.kind === "family" \?/);
assert.match(source, /return known.length \? known : \["chat"\]/);
// Neither provider save nor provider test may run while the setup itself is invalid.
for (const condition of ["modelConfigBusy", "!modelProviderDirty", "Boolean(providerSetupIssue)"]) {
  assert.ok(disabledConditions("model-provider-save").includes(condition), `model-provider-save: ${condition}`);
}
assert.ok(disabledConditions("model-provider-test-save").includes("Boolean(providerSetupIssue)"));
console.log("PASS simple layout, collapsed advanced controls, safe capability and feedback contracts");

{
  const { context, values } = stateContext({ modelProviderInventory: [{ name: "custom" }, { name: "custom-2" }], myDrSaiConfig: undefined });
  handler("addCustomModelProvider", context)();
  assert.equal(values.setActiveModelProviderTab, "__new-custom-provider__");
  assert.equal(values.setProviderDraft, "custom-3");
  assert.equal(values.setWireApiDraft, "openai");
  assert.equal(values.setApiKeyDraft, "");
  assert.equal(values.setModelTestOutput, null);
  console.log("PASS new Custom entry does not overwrite saved custom/custom-2");
}
{
  let selected = "";
  let prompts = 0;
  const base = { modelConfigBusy: false, runningModelCapability: null, activeModelProviderTab: "old", newProviderModelDraft: "", selectModelProviderTab: (id: string) => { selected = id; } };
  // Nothing typed: switching tabs must not interrupt with a discard prompt.
  {
    const { context } = stateContext({ ...base, modelProviderDirty: false, baseUrlDraft: "", apiKeyDraft: "", providerModelsDraft: [], requestAppDecision: async () => { prompts += 1; return true; } });
    await handler("navigateModelProvider", context)("openai");
    assert.equal(selected, "openai");
    assert.equal(prompts, 0);
  }
  // Unsaved provider draft: prompt first, and declining keeps the current provider.
  {
    selected = "";
    const { context } = stateContext({ ...base, modelProviderDirty: true, requestAppDecision: async () => { prompts += 1; return false; } });
    await handler("navigateModelProvider", context)("openai");
    assert.equal(selected, "");
    assert.equal(prompts, 1);
    context.requestAppDecision = async () => true;
    await handler("navigateModelProvider", context)("openai");
    assert.equal(selected, "openai");
    assert.equal(prompts, 1);
  }
  console.log("PASS switching providers prompts only for unsaved content and never discards it silently");
}
{
  const saved = { name: "custom", base_url: "https://saved.test/v1", wire_api: "openai", requires_api_key: true, models: ["enabled"], disabled_models: ["disabled"] };
  const { context, values } = stateContext({ myDrSaiConfig: undefined, modelProviderInventory: [saved], effectiveModelProviderPresets: [], providerDraftModels: (p: typeof saved) => [...p.models, ...p.disabled_models], providerModelConfigsFor: () => ({}), applyModelProviderPreset: () => assert.fail("saved provider must not fall back to preset") });
  handler("selectModelProviderTab", context)("custom");
  assert.equal(values.setProviderDraft, "custom");
  assert.equal(values.setBaseUrlDraft, saved.base_url);
  assert.deepEqual(values.setProviderModelsDraft, ["enabled", "disabled"]);
  console.log("PASS existing custom is reachable and disabled models are retained");
}
{
  assert.throws(() => snapshotWithEditor({ providerModelEditor: null }), /模型 ID/);
  assert.throws(() => editorSnapshot({ modelId: "  " }), /有效的模型 ID/);
  assert.throws(() => editorSnapshot({ modelId: "existing" }), /重复/);
  assert.throws(() => editorSnapshot({ tokenLimit: "", maxTokens: "" }), /必填/);
  assert.throws(() => editorSnapshot({ tokenLimit: "64000", maxTokens: "0" }), /正整数/);
  assert.throws(() => editorSnapshot({ capabilities: ["chat", "image_generation"], outputModalities: ["image"] }), /不能混用对话能力/);
  assert.throws(() => editorSnapshot({ apiProtocol: "anthropic" }), /主机/);
  const created = snapshotWithEditor();
  assert.equal(created.id, "new-model");
  assert.deepEqual(Object.keys(created.models).sort(), ["existing", "new-model"]);
  assert.equal(created.models["new-model"].token_limit, 72000);
  assert.equal(created.models["new-model"].max_tokens, 8000);
  assert.equal("origin" in created.models["new-model"], false);
  // Product entries stay read-only: only their enabled flag may change, and origin never round-trips.
  const product = snapshotWithEditor({ providerModelConfigsDraft: { "gpt-4o": { origin: "product", enabled: true, api_protocol: "openai" } }, providerModelEditor: { ...defaultEditor, originalId: "gpt-4o", origin: "product", enabled: false, tokenLimit: "", maxTokens: "" } });
  assert.equal(product.id, "gpt-4o");
  assert.equal(product.models["gpt-4o"].enabled, false);
  assert.equal("origin" in product.models["gpt-4o"], false);
  console.log("PASS the model editor is the single source of truth and Product entries stay read-only");
}
for (const dirty of [true, false]) {
  for (const ok of [true, false]) {
    const calls: string[] = [];
    const { context, values } = stateContext({
      providerDraft: "custom", modelDraft: "example-model", providerModelConfigsDraft: {}, wireApiDraft: "openai", baseUrlDraft: "https://api.test/v1", anthropicBaseUrlDraft: "", geminiBaseUrlDraft: "", apiKeyDraft: "", keySourceDraft: "secure", modelProviderDirty: dirty, modelDraftFingerprint: "snapshot", language: "zh",
      onModelConnectionUpdated: () => {}, userFacingFailureMessage: () => "failed",
      desktopApi: {
        testMyDrSaiModelProvider: async () => { calls.push("saved"); return { ok, error: "denied", output: "reply" }; },
        testMyDrSaiModelDraft: async () => { calls.push("draft"); return { ok, error: "denied", output: "reply" }; },
        getMyDrSaiConfig: async () => ({}),
      },
    });
    await handler("testModelConnection", context)("model");
    assert.deepEqual(calls, [dirty ? "draft" : "saved"]);
    assert.equal(values.setModelConfigMessage.includes("测试通过"), ok);
    if (!ok) assert.match(values.setModelConfigMessage, /denied/);
    else assert.match(values.setModelConfigMessage, /未切换主模型/);
  }
}
console.log("PASS saved vs draft testing follows result.ok, failures never claim success");
{
  let payload: Record<string, unknown> = {};
  const { context, values } = stateContext({ providerDraft: "custom", baseUrlDraft: "https://api.test/v1", anthropicBaseUrlDraft: "", geminiBaseUrlDraft: "", apiKeyDraft: "", wireApiDraft: "openai", keySourceDraft: "secure", myDrSaiConfig: undefined, modelDraft: "m", providerModelsDraft: ["m"], onModelConnectionUpdated: () => {}, selectModelProviderTab: () => {}, desktopApi: { saveMyDrSaiModelProvider: async (_name: string, body: Record<string, unknown>) => { payload = body; return { providers: [] }; } } });
  await handler("saveModelProvider", context)();
  assert.equal("api_key" in payload, false);
  assert.deepEqual(Object.keys(payload.models), ["m"]);
  assert.match(values.setModelConfigMessage, /尚未验证模型调用/);
  assert.match(values.setModelConfigMessage, /未切换主模型/);
  console.log("PASS blank key omitted from save, saving is not verification or primary selection");
}
{
  const { context, values } = stateContext({ myDrSaiConfig: undefined, onModelConnectionUpdated: () => {}, desktopApi: { restoreMyDrSaiModelConnection: async () => ({}) } });
  await handler("restoreLastKnownGoodModelConnection", context)();
  assert.match(values.setModelConfigMessage, /当前编辑草稿已保留/);
  assert.equal(values.setModelTestOutput, null);
  assert.equal(values.setProviderDraft, undefined);
  console.log("PASS recovery retains editor draft and clears previous test output");
}
{
  const check = (extra: Record<string, unknown>, requireModels = true) => handler("modelProviderSetupIssue", stateContext(extra).context)(requireModels);
  for (const baseUrlDraft of ["", "not a URL", "api.example.test/v1", "ftp://api.test", "https://"]) {
    assert.match(check({ baseUrlDraft }), /http/);
  }
  assert.equal(check({ baseUrlDraft: "http://localhost:8000/v1" }), null);
  assert.match(check({ providerDraft: " " }), /提供方名称/);
  assert.match(check({ providerDiscoveryCredentialReady: false }), /API Key/);
  // The editor is the only source of the model, so an incomplete editor blocks save and test.
  const incompleteEditor = { currentModelSnapshot: () => { throw new Error("请填写模型 ID。"); } };
  assert.match(check(incompleteEditor), /模型 ID/);
  assert.equal(check(incompleteEditor, false), null);
  for (const extra of [{ baseUrlDraft: "bad" }, { providerDiscoveryCredentialReady: false }, incompleteEditor]) {
    const { context, values } = stateContext({ ...extra, desktopApi: new Proxy({}, { get: () => assert.fail("invalid setup must not call backend") }) });
    await handler("saveModelProvider", context)();
    assert.ok(values.setModelConfigMessage);
    assert.equal(values.setModelConfigBusy, undefined);
    await handler("testModelConnection", context)("model");
    assert.equal(values.setModelConfigBusy, undefined);
  }
  assert.match(source, /data-testid="model-provider-keyless"/);
  assert.match(source, /models discovered; added to draft, not saved or call-tested/);
  console.log("PASS required URL, credentials and model checks block invalid saves/tests, discovery is not call validation");
}
{
  // Tab partitioning is pure, so the inline/overflow split is executed directly.
  const layout = handler("computeModelProviderTabLayout", {}) as (options: {
    tabs: Array<{ id: string; label: string }>;
    primaryIds: Set<string>;
    draftTabId: string;
    pinned: Array<{ id: string; label: string } | null>;
  }) => { visible: Array<{ id: string; label: string }>; overflow: Array<{ id: string; label: string }> };
  const draft = { id: "__new-custom-provider__", label: "自定义接入" };
  const tabs = [draft, { id: "hepai", label: "HepAI" }, { id: "openai", label: "OpenAI" }, { id: "ollama", label: "Ollama" }, { id: "custom", label: "custom" }, { id: "custom-2", label: "custom-2" }];
  const primaryIds = new Set(["hepai", "deepseek", "openai", "anthropic"]);
  const ids = (list: Array<{ id: string }>): string => [...list].map((entry) => entry.id).join(",");
  const partition = (pinned: Array<{ id: string; label: string } | null>) => layout({ tabs, primaryIds, draftTabId: draft.id, pinned });
  const idle = partition([]);
  assert.equal(ids(idle.visible), "hepai,openai");
  assert.equal(ids(idle.overflow), "ollama,custom,custom-2");
  // A provider picked from the menu moves inline; the remaining saved providers stay in the menu.
  const picked = partition([tabs[4], tabs[4]]);
  assert.equal(ids(picked.visible), "hepai,openai,custom");
  assert.equal(ids(picked.overflow), "ollama,custom-2");
  // The open form is never hidden in the menu, even when another provider was used more recently.
  const editing = partition([tabs[4], tabs[5]]);
  assert.equal(ids(editing.visible), "hepai,openai,custom,custom-2");
  assert.equal(ids(editing.overflow), "ollama");
  // The draft pseudo tab is already the first inline entry, so it must never be repeated.
  const drafting = partition([draft, draft]);
  assert.equal(ids(drafting.visible), "hepai,openai");
  assert.equal(ids(drafting.overflow), "ollama,custom,custom-2");
  // The caller renders the draft pseudo tab itself, so no input may make the pure
  // split emit it: a second entry would be a dead "自定义接入" button.
  for (const result of [idle, picked, editing, drafting]) {
    assert.ok(!ids(result.visible).includes(draft.id), "draft tab must never appear inline twice");
    assert.ok(!ids(result.overflow).includes(draft.id), "draft tab must never appear in the overflow menu");
  }
  console.log("PASS provider tab overflow keeps the edited provider inline and never duplicates the draft tab");
}
console.log("All simplified provider setup checks passed (not an end-to-end UI/network test).");
