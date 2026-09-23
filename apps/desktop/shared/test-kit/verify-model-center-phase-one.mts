import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import type * as TypeScript from "typescript";
const ts: typeof TypeScript = createRequire(import.meta.url)("typescript");

const root = resolve(process.cwd(), "shared/renderer/src");
const helperPath = resolve(root, "components/providerDirectSetup.ts");
const panel = readFileSync(resolve(root, "components/SettingsPanel.tsx"), "utf8");
const helper = readFileSync(helperPath, "utf8");
const styles = readFileSync(resolve(root, "styles.css"), "utf8");
const tree = ts.createSourceFile(helperPath, helper, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declarations = new Map<string, string>();
ts.forEachChild(tree, function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(tree).replace(/^export\s+/, ""));
  ts.forEachChild(node, visit);
});
function fn(name: string) {
  const dependencies = ["directModelKey", "directAgentEligibilityReason", name].filter((value, index, all) => all.indexOf(value) === index).map((value) => declarations.get(value)).filter(Boolean).join("\n");
  const js = ts.transpileModule(`${dependencies}\nglobalThis.result = ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = vm.createContext({}); vm.runInContext(js, context); return context.result as (...args: any[]) => any;
}
const aggregate = fn("aggregateDirectModels");
const eligibility = fn("directAgentEligibilityReason");
const route = fn("directModelRoute");
const replace = fn("replaceDirectModel");
const config = (over: Record<string, unknown> = {}) => ({ input_modalities: ["text"], output_modalities: ["text"], api_protocol: "openai", enabled: true, capabilities: ["chat", "tool_calling"], token_limit: 100, max_tokens: 20, ...over });
const provider = (name: string, models: Record<string, unknown>) => ({ name, base_url: `https://${name}.test/v1`, wire_api: "openai", requires_api_key: true, has_api_key: true, model_configs: models });

const rows = aggregate([
  provider("custom", { same: config(), disabled: config({ enabled: false }), builtin: config({ origin: "product" }) }),
  provider("custom-2", { same: config({ alias: "Second" }), image: config({ input_modalities: ["image"], output_modalities: ["image"], capabilities: ["image_generation"] }) }),
]);
assert.equal(rows.length, 4, "all non-product entries are aggregated");
assert.equal(JSON.stringify(rows.filter((x: any) => x.modelId === "same").map((x: any) => x.providerId).sort()), JSON.stringify(["custom", "custom-2"]), "same model id across providers must not overwrite");
assert.ok(rows.some((x: any) => x.modelId === "disabled" && !x.config.enabled), "disabled model remains visible");
assert.equal(JSON.stringify(route(rows.find((x: any) => x.providerId === "custom-2" && x.modelId === "same"))), JSON.stringify({ providerId: "custom-2", modelId: "same" }), "hidden provider id still routes edit");
assert.equal(eligibility(config()), undefined);
assert.match(eligibility(config({ capabilities: ["chat"], input_modalities: ["image"], output_modalities: ["image"] })), /tool_calling.*text input.*text output/);
const kept = replace({ first: config(), sibling: config() }, "first", "renamed", config({ enabled: false }));
assert.equal(JSON.stringify(Object.keys(kept).sort()), JSON.stringify(["renamed", "sibling"]), "saving one model preserves siblings in the same provider");

assert.match(panel, /我的模型[\s\S]*官方服务/);
assert.match(panel, /不能用于 Agent/);
assert.match(panel, /<article className="model-center-card"[\s\S]*<header className="model-center-card-header">[\s\S]*<footer className="model-center-actions">/, "model center uses semantic card hierarchy");
assert.match(panel, /<code title=\{entry\.modelId\}>\{entry\.modelId\}<\/code>/, "model id is shown without leaking internal provider identity");
assert.doesNotMatch(panel, />\{entry\.providerId\}</, "provider id remains internal");
for (const [raw, localized] of Object.entries({
  available: "可用", configured_unverified: "已配置·未验证", unavailable: "不可用",
  stale: "状态过期", offline: "服务离线", unauthorized: "认证失败", error: "异常",
})) {
  assert.match(panel, new RegExp(`${raw}: \\{ zh: "${localized}"`), `${raw} has a localized runtime label`);
}
assert.doesNotMatch(panel, /\{entry\.runtime\?\.availability\}/, "raw runtime enum is never rendered");
assert.match(panel, /modelCenterConnection\(entry\.provider\.base_url\)/, "connection display passes through safe URL parsing");
assert.match(panel, /title=\{connection\.title\}/, "sanitized full base URL is available as a title");
assert.match(panel, /preflightMyDrSaiModelDeletion\s*\(/, "saved model deletion must preflight references");
assert.match(panel, /deleteMyDrSaiModel\s*\(/, "saved model deletion must use the model-level delete API");
assert.doesNotMatch(panel, /deleteMyDrSaiModelProvider\s*\(/, "model UI must not call Provider DELETE");
assert.match(panel, /onClick=\{\(\)\s*=>\s*void deleteSavedProviderModel\(entry\.modelId, entry\.providerId\)\}/, "card delete invokes model-level deletion with owning provider");
assert.doesNotMatch(panel, /className="model-provider-button-danger"\s+disabled\s*>/, "delete is not statically disabled");
assert.match(styles, /\.model-center-card-list\s*\{[\s\S]*display:\s*grid/, "card list has dedicated layout CSS");
assert.match(styles, /\.model-center-card\s*\{[\s\S]*min-width:\s*0/, "cards can shrink without character-level wrapping");
assert.match(styles, /\.model-center-actions\s*\{[\s\S]*flex-wrap:\s*wrap[\s\S]*justify-content:\s*flex-end/, "actions wrap as whole controls and align right");
assert.match(styles, /\.model-center-actions button,[\s\S]*white-space:\s*nowrap/, "action labels never wrap character-by-character");
assert.match(styles, /@media \(max-width:\s*640px\)[\s\S]*\.model-center-actions/, "model cards have an explicit narrow-screen layout");
const addedCardCss = styles.slice(styles.indexOf("/* The user-owned model center"));
assert.ok(addedCardCss.length > 0, "dedicated model-center CSS block exists");
assert.doesNotMatch(addedCardCss, /\.model-provider-model-list/, "card CSS does not target the legacy official table");
console.log("PASS responsive model cards, localized runtime status, safe deletion, aggregation, routing, and sibling preservation");
