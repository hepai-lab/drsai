import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isSelectableModelAvailability, modelCatalogRecoveryCopy } from "../../shared/renderer/src/modelCatalogRecovery.ts";

const states = ["unconfigured", "empty", "unauthorized", "offline", "timeout", "stale", "unavailable", "error"] as const;
const zhTitles = new Set<string>();
const enTitles = new Set<string>();
for (const state of states) {
  const zh = modelCatalogRecoveryCopy(state, true);
  const en = modelCatalogRecoveryCopy(state, false);
  assert.ok(zh.title && zh.message && en.title && en.message, `${state} must have complete bilingual recovery copy`);
  zhTitles.add(zh.title);
  enTitles.add(en.title);
}
assert.equal(zhTitles.size, states.length, "Chinese recovery states must remain distinguishable");
assert.equal(enTitles.size, states.length, "English recovery states must remain distinguishable");
assert.equal(isSelectableModelAvailability("available"), true);
assert.equal(isSelectableModelAvailability("configured_unverified"), true);
for (const state of ["stale", "offline", "unauthorized", "unavailable"] as const) {
  assert.equal(isSelectableModelAvailability(state), false, `${state} models must not be selectable for a new task`);
}

const appSource = readFileSync(resolve(import.meta.dirname, "../../shared/renderer/src/App.tsx"), "utf8");
const configSource = readFileSync(resolve(import.meta.dirname, "../../shared/main/myDrSaiConfig.ts"), "utf8");
const apiSource = readFileSync(resolve(import.meta.dirname, "../../shared/api/desktopApi.ts"), "utf8");

assert.match(appSource, /<optgroup key=\{provider\} label=\{provider\}>/, "Agent models must be grouped by Provider");
assert.match(appSource, /data-testid="agent-text-model-select" aria-label=/, "model selection must have an accessible name");
assert.match(appSource, /disabled=\{!usable && !selected\}/, "unusable models must be disabled while the current selection remains visible");
assert.match(appSource, /data-testid="agent-model-catalog-recovery"[\s\S]{0,900}agent-model-refresh/, "catalog failures must expose an inline refresh action");
assert.match(appSource, /agent-model-sign-in/, "authorization failures must expose re-authentication");
assert.match(appSource, /agent-model-use-default/, "unavailable selections must expose an explicit Provider-default recovery");
assert.match(appSource, /modelCatalog: \{ state: "stale"[\s\S]{0,800}setChatChoicesRefreshNonce/, "Provider saves must mark the catalog stale and trigger a reload");
assert.match(appSource, /selectedModelRef[\s\S]{0,500}provider_id: selectedModelRef\.provider_id[\s\S]{0,180}availability: "unavailable"/, "an unavailable selection must retain its Provider-aware identity");
assert.match(configSource, /runtimeCatalog = await readRuntimeModelCatalog[\s\S]{0,500}ready: true/, "catalog failure must not make the otherwise running Runtime unavailable");
for (const state of ["unauthorized", "timeout", "offline", "error"]) assert.match(configSource, new RegExp(`return "${state}"`));
assert.match(configSource, /modelConnection \? "empty" : "unconfigured"/, "an empty configured Provider must differ from no Provider configuration");
assert.match(apiSource, /modelCatalog\?: \{[\s\S]{0,180}"unconfigured" \| "empty" \| "timeout"/, "Desktop API must publish recoverable catalog states");

console.log("OpenDrSai model usability recovery verified: Provider groups, admissibility filtering, preserved selections, post-save refresh, and eight distinct recovery states.");
