import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveOperationalState, shouldShowOperationalStateBar, type OperationalStateFacts } from "../../shared/api/operationalState.ts";

const identities: OperationalStateFacts["identity"][] = ["loading", "anonymous", "authenticated"];
const runtimes: OperationalStateFacts["runtime"][] = ["unknown", "preparing", "blocked", "ready"];
const models: OperationalStateFacts["model"][] = ["unknown", "unconfigured", "untested", "ready"];
const workspaces: OperationalStateFacts["workspace"][] = ["none", "untrusted", "trusted"];

let combinations = 0;
for (const identity of identities) for (const runtime of runtimes) for (const model of models) for (const workspace of workspaces) {
  const facts = { identity, runtime, model, workspace };
  const decision = deriveOperationalState(facts);
  combinations += 1;
  const expectedLayer = identity !== "authenticated" ? "identity" : runtime !== "ready" ? "runtime" : model === "unknown" || model === "unconfigured" ? "model" : workspace !== "trusted" ? "workspace" : model === "untested" ? "model" : "workspace";
  assert.equal(decision.currentLayer, expectedLayer, JSON.stringify(facts));
  assert.equal(decision.state, facts[expectedLayer], JSON.stringify(facts));
  assert.equal(decision.layers.length, 4);
  assert.equal(decision.layers.filter((item) => item.status === "current").length, 1);
  const hardBlocked = workspace !== "trusted" || identity !== "authenticated" || runtime !== "ready" || ["unknown", "unconfigured"].includes(model);
  assert.equal(decision.readyForRun, !hardBlocked);
  const expectedBlocker = hardBlocked ? expectedLayer : null;
  assert.equal(decision.blockingLayer, expectedBlocker);
}
assert.equal(combinations, 144);
assert.equal(shouldShowOperationalStateBar(deriveOperationalState({
  identity: "authenticated",
  runtime: "blocked",
  model: "ready",
  workspace: "trusted",
})), true, "a blocking prerequisite should remain globally visible");
assert.equal(shouldShowOperationalStateBar(deriveOperationalState({
  identity: "authenticated",
  runtime: "ready",
  model: "untested",
  workspace: "trusted",
})), true, "untested models should remain visible without blocking useful work");

const app = readFileSync(resolve(import.meta.dirname, "../../shared/renderer/src/App.tsx"), "utf8");
const component = readFileSync(resolve(import.meta.dirname, "../../shared/renderer/src/components/OperationalStateBar.tsx"), "utf8");
const diagnosticsContainer = readFileSync(resolve(import.meta.dirname, "../../shared/renderer/src/containers/DiagnosticsContainer.tsx"), "utf8");
const chatWorkspace = readFileSync(resolve(import.meta.dirname, "../../shared/renderer/src/components/ChatWorkspace.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dirname, "../../shared/renderer/src/styles.css"), "utf8");
assert.match(app, /deriveOperationalState\(operationalFacts\)/);
assert.match(app, /shouldShowOperationalStateBar\(operationalDecision\)[\s\S]{0,160}<DiagnosticsContainer[\s\S]{0,160}decision=\{operationalDecision\}/);
assert.match(app, /operationalStateControl=\{shouldShowOperationalStateBar\(operationalDecision\)/);
assert.match(diagnosticsContainer, /<OperationalStateBar[\s\S]{0,160}decision=\{decision\}/);
assert.match(chatWorkspace, /conversation-titlebar-actions[\s\S]{0,120}\{operationalStateControl\}/);
assert.match(chatWorkspace, /emptyChat && operationalStateControl[\s\S]{0,180}conversation-titlebar-operational-only/);
assert.match(component, /data-current-layer=\{decision\.currentLayer\}/);
assert.match(component, /data-current-state=\{decision\.state\}/);
assert.match(component, /aria-current=\{item\.status === "current" \? "step"/);
assert.match(component, /aria-label=\{zh \? "OpenDrSai 当前状态"/);
assert.match(component, /AUTO_OPEN_STATES/);
assert.doesNotMatch(component, /AUTO_OPEN_STATES[\s\S]{0,180}"untested"/);
assert.doesNotMatch(diagnosticsContainer, /autoRecoverKey|completedAutomaticRecoveries/);
assert.doesNotMatch(app, /automaticAgentModelVerificationsRef|recordSuccessfulModelUsage/);
assert.equal((app.match(/testMyDrSaiModelProvider\(/g) ?? []).length, 1, "only the explicit Model provider settings action may probe a model");
assert.match(app, /model: !myDrSaiConfigLoaded[\s\S]{0,180}: "ready"/);
assert.match(app, /actualOperationalFacts = \{[\s\S]{0,600}identity:[\s\S]*runtime:[\s\S]*model:[\s\S]*workspace:/);
assert.doesNotMatch(app, /actualOperationalFacts = \{[\s\S]{0,700}run:/);
assert.match(component, /model: "智能体"/);
assert.doesNotMatch(component, /任务运行|Task run/);
const authProvider = readFileSync(resolve(import.meta.dirname, "../../shared/renderer/src/auth/AuthProvider.tsx"), "utf8");
assert.match(authProvider, /!session\.authenticated[\s\S]{0,220}serviceBlocker[\s\S]{0,120}void retryBootstrap\(\)/);
assert.match(styles, /\.operational-state-popover\s*\{\s*position:\s*absolute/);
assert.doesNotMatch(styles, /\.operational-state-(?:bar|control)\s*\{[^}]*position:\s*fixed/s);
assert.doesNotMatch(component, /Codex/i);

console.log(`M07 operational state verified (${combinations} four-layer property combinations + contextual visibility + production UI contracts).`);
