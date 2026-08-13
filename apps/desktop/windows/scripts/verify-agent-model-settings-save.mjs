import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const renderer = readFileSync(resolve(here, "../../shared/renderer/src/App.tsx"), "utf8");

assert(renderer.includes('data-testid="save-agent-model-policy"'), "Agent model settings have no explicit save action");
assert(renderer.includes("setAgentModelPolicyDraft((current) => current ?"), "Agent model selectors do not update a draft");
assert(renderer.includes("await onSaveAgentModelPolicy(openDrSaiConfigurationAgent.id, agentModelPolicyDraft)"), "Save action is not connected to the policy update");
assert(renderer.includes("async function saveAgentModelPolicy(agentId: string, draft: AgentModelPolicyDraft)"), "Renderer has no atomic Agent model policy save handler");
assert(renderer.includes("expected_revision: policy.revision"), "Agent model policy save omits optimistic concurrency protection");
assert(renderer.includes("setMyDrSaiAgentModelPolicy(updated)"), "Saved Agent model policy is not applied to renderer state");
assert(renderer.includes('setAgentModelPolicyMessage(zh ? "模型配置已保存。"'), "Successful saves have no visible confirmation");
assert(!renderer.includes("onConfigureAgentCapabilityModel="), "Capability selectors still use per-field immediate writes");

console.log("Agent model settings explicit-save behavior passed.");
