import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(import.meta.dirname, path), "utf8");
const chat = read("../../shared/main/chat.ts");
const adapter = read("../../shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const renderer = read("../../shared/renderer/src/components/StructuredMessageParts.tsx");
const workspace = read("../../shared/renderer/src/components/ChatWorkspace.tsx");
const gateway = read("../../../../cores/python/packages/drsai/src/drsai/backend/gateway.py");

assert.match(adapter, /goal_confirmation_required:\s*options\?\.agentId\?\.trim\(\) === "my-drsai"[\s\S]{0,100}options\.goalConfirmationRequired === true/, "OpenDrSai Goal confirmation must require explicit Goal-confirmation mode");
assert.match(workspace, /data-testid="composer-task-mode"/, "composer must expose Normal and Confirm-goal modes");
assert.match(workspace, /data-testid=\{`composer-task-mode-\$\{mode\}`\}/, "Task modes must be selectable from the unified composer configuration");
assert.match(workspace, /\["normal", "confirm_goal"\] as const/, "Normal interaction must be the explicit default and Goal confirmation must remain selectable");
assert.match(workspace, /goalConfirmationRequired:\s*selectedAgentId === "my-drsai" && taskInteractionMode === "confirm_goal"/, "only explicit OpenDrSai Goal mode may request confirmation");
assert.match(renderer, /<InteractionItem compact/, "timeline must render only a compact pending-interaction audit summary");
assert.match(workspace, /data-testid="composer-goal-confirm"/, "Goal confirmation actions must live in the composer");
const runtimeFlow = chat.slice(chat.indexOf("async function runRuntimeBackendChat("), chat.indexOf("function emitRuntimeOaepEvent("));
assert.ok(runtimeFlow.indexOf("proposeRunGoal") < runtimeFlow.indexOf("stageAttachments"), "Goal must be proposed before attachment staging");
assert.match(runtimeFlow, /clarification_required[\s\S]{0,1200}input_request/, "ambiguous tasks must surface a necessary clarification before execution");
assert.ok(runtimeFlow.indexOf("goalConfirmation") < runtimeFlow.indexOf("executeAgentRun"), "Goal must be confirmed before execution");
assert.match(chat, /response\.decision === "revise"[\s\S]{0,1500}reviseRunGoal/, "Goal edits must append a Runtime revision");
assert.match(renderer, /修改或补充/, "Goal card must expose edit/supplement action");
assert.match(renderer, /保存新版本/, "Goal editor must make version creation explicit");
assert.match(renderer, /取消任务/, "Goal cancellation must be separate from editing");
assert.match(renderer, /goalDraft\.outputs/, "Goal editor must include required outputs");
assert.match(renderer, /goalDraft\.materials/, "Goal editor must include materials");
assert.match(renderer, /goalDraft\.constraints/, "Goal editor must include constraints");
assert.match(gateway, /render_goal_execution_prompt\(confirmed_goal\["goal"\], request\.prompt\)/, "confirmed Goal must bind the actual Agent prompt");
assert.match(gateway, /model_evidence\["goal"\]/, "Run Manifest evidence must bind the confirmed Goal version and digest");
assert.match(gateway, /"default_sources": dict\(confirmed_goal\["goal"\]\.get\("default_sources"\)/, "Goal default provenance must be bound into model evidence");
assert.match(gateway, /"default_sources": model_evidence\["goal"\]\["default_sources"\]/, "Goal default provenance must be returned in result metadata");

console.log("OpenDrSai production Goal flow verified: pre-side-effect gate, immutable edits, four-field UI, and attributed defaults.");
