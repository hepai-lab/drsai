import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deriveOperationalRunState, deriveOperationalState, shouldShowOperationalStateBar, type OperationalStateFacts } from "../../shared/api/operationalState.ts";

const identities: OperationalStateFacts["identity"][] = ["loading", "anonymous", "authenticated"];
const runtimes: OperationalStateFacts["runtime"][] = ["unknown", "preparing", "blocked", "ready"];
const models: OperationalStateFacts["model"][] = ["unknown", "unconfigured", "untested", "ready"];
const workspaces: OperationalStateFacts["workspace"][] = ["none", "untrusted", "trusted"];
const runs: OperationalStateFacts["run"][] = ["idle", "queued", "running", "waiting_approval", "recovering", "failed", "completed", "cancelled"];

let combinations = 0;
for (const identity of identities) for (const runtime of runtimes) for (const model of models) for (const workspace of workspaces) for (const run of runs) {
  const facts = { identity, runtime, model, workspace, run };
  const decision = deriveOperationalState(facts);
  combinations += 1;
  const runNeedsAttention = ["queued", "running", "waiting_approval", "recovering", "failed"].includes(run);
  const expectedLayer = identity !== "authenticated" ? "identity" : runtime !== "ready" ? "runtime" : model === "unknown" || model === "unconfigured" ? "model" : workspace !== "trusted" ? "workspace" : runNeedsAttention ? "run" : model === "untested" ? "model" : "run";
  assert.equal(decision.currentLayer, expectedLayer, JSON.stringify(facts));
  assert.equal(decision.state, facts[expectedLayer], JSON.stringify(facts));
  assert.equal(decision.layers.length, 5);
  assert.equal(decision.layers.filter((item) => item.status === "current").length, 1);
  const hardBlocked = expectedLayer !== "run" && !(expectedLayer === "model" && model === "untested");
  assert.equal(decision.readyForRun, !hardBlocked);
  const expectedBlocker = hardBlocked ? expectedLayer : ["waiting_approval", "failed"].includes(run) ? "run" : null;
  assert.equal(decision.blockingLayer, expectedBlocker);
}
assert.equal(combinations, 1152);

const decisionFor = (run: OperationalStateFacts["run"]) => deriveOperationalState({
  identity: "authenticated",
  runtime: "ready",
  model: "ready",
  workspace: "trusted",
  run,
});
for (const run of ["queued", "running", "waiting_approval", "recovering", "failed"] as const) {
  assert.equal(shouldShowOperationalStateBar(decisionFor(run)), true, `${run} should remain globally visible`);
}
for (const run of ["idle", "completed", "cancelled"] as const) {
  assert.equal(shouldShowOperationalStateBar(decisionFor(run)), false, `${run} should not occupy the global overlay`);
}
assert.equal(shouldShowOperationalStateBar(deriveOperationalState({
  identity: "authenticated",
  runtime: "blocked",
  model: "ready",
  workspace: "trusted",
  run: "idle",
})), true, "a blocking prerequisite should remain globally visible");
assert.equal(shouldShowOperationalStateBar(deriveOperationalState({
  identity: "authenticated",
  runtime: "ready",
  model: "untested",
  workspace: "trusted",
  run: "idle",
})), true, "untested models should remain visible without blocking useful work");

const task = (status: string, updatedAt: string, recoveredAt?: string) => ({ status, updatedAt, ...(recoveredAt ? { recoveredAt } : {}) }) as never;
assert.equal(deriveOperationalRunState([], null), "idle");
assert.equal(deriveOperationalRunState([], "request-1"), "running");
assert.equal(deriveOperationalRunState([task("waiting_approval", "2026-08-05T00:00:00Z")]), "waiting_approval");
assert.equal(deriveOperationalRunState([task("queued", "2026-08-05T00:00:00Z", "2026-08-05T00:00:00Z")]), "recovering");
assert.equal(deriveOperationalRunState([task("blocked", "2026-08-05T00:00:00Z")]), "failed");

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
assert.match(app, /automaticAgentModelVerificationsRef[\s\S]{0,1200}testMyDrSaiModelProvider\(ref\.provider_id, ref\.model_id\)/);
assert.match(styles, /\.operational-state-popover\s*\{\s*position:\s*absolute/);
assert.doesNotMatch(styles, /\.operational-state-(?:bar|control)\s*\{[^}]*position:\s*fixed/s);
assert.doesNotMatch(component, /Codex/i);

console.log(`M07 operational state verified (${combinations} property combinations + 5 run mappings + contextual visibility + 11 production UI contracts).`);
