import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = readFileSync(resolve(root, "../shared/api/desktopApi.ts"), "utf8");
const plan = readFileSync(resolve(root, "../shared/api/agentTaskPlan.ts"), "utf8");
const runs = readFileSync(resolve(root, "../shared/main/agentRuns.ts"), "utf8");
const tasks = readFileSync(resolve(root, "src/main/backgroundTasks.ts"), "utf8");
const view = readFileSync(resolve(root, "../shared/renderer/src/components/AgentRunWorkspace.tsx"), "utf8");
const smoke = readFileSync(resolve(root, "src/main/e2eSmoke.ts"), "utf8");
const runner = readFileSync(resolve(root, "scripts/verify-e2e-agent-run.mjs"), "utf8");

const checks = {
  typedExecutionPlan: /executionPlan\?: DesktopTaskPlanStep\[\]/.test(shared),
  sharedPlanGenerator: /export function buildAgentTaskPlan/.test(plan),
  validatesPlanShape: /normalizeExecutionPlan/.test(runs) && /1 to 20 steps/.test(runs) && /seenIds/.test(runs),
  promptUsesEditedPlan: /buildAgentExecutionPrompt/.test(runs) && /只执行列出的步骤/.test(runs),
  promptForbidsDeletedSteps: /不得恢复已删除步骤/.test(runs),
  gatewayReceivesPlan: /execution_plan: request\.executionPlan/.test(runs),
  persistedPlanUsesRequest: /request\.executionPlan\?\.length \? request\.executionPlan/.test(tasks),
  visibleEditor: /data-testid="agent-plan-editor"/.test(view) && /data-testid="agent-plan-edit-button"/.test(view),
  deleteControl: /data-plan-action="delete"/.test(view) && /removePlanStep/.test(view),
  reorderControls: /data-plan-action="move-up"/.test(view) && /data-plan-action="move-down"/.test(view) && /movePlanStep/.test(view),
  addRequirementControl: /agent-plan-new-requirement/.test(view) && /addPlanRequirement/.test(view),
  executionCarriesPlan: /executionPlan = editablePlan/.test(view) && /\{ executionPlan \}/.test(view),
  packagedUsesVisibleUi: /runAgentPlanEditSmoke/.test(smoke) && /agent-plan-edit-button/.test(smoke),
  packagedChecksAllMutations: ["planStepDeleted", "planOrderChanged", "citationRequirementAdded", "editedPlanPersisted", "deletedStepNotExecuted", "editedOrderExecuted"].every((key) => smoke.includes(key)),
  packagedChecksFinalCitation: /citationRequirementInResult/.test(smoke) && /edited-plan-report\.md/.test(runner),
};

const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) throw new Error(`D2 edit-plan verification failed: ${failures.join(", ")}`);
console.log(`D2 edit-plan verification passed (${Object.keys(checks).length} checks).`);
