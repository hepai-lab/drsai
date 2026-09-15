import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const api = read("../shared/api/desktopApi.ts");
const parser = read("../shared/main/sseParser.ts");
const runner = read("../shared/main/agentRuns.ts");
const tasks = read("src/main/backgroundTasks.ts");
const workspace = read("../shared/renderer/src/components/AgentRunWorkspace.tsx");
const taskCenter = read("../shared/renderer/src/components/SkillSquareView.tsx");
const styles = read("../shared/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const packaged = read("scripts/verify-e2e-agent-run.mjs");

const checks = {
  typedAdjustment: api.includes("export interface DesktopTaskPlanAdjustment") && api.includes('completeness: "partial" | "blocked"'),
  eventContract: api.includes('type: "start" | "chunk" | "status" | "plan_adjustment"') && api.includes("planAdjustment?: DesktopTaskPlanAdjustment"),
  persistedOnTask: api.includes("planAdjustments?: DesktopTaskPlanAdjustment[]") && tasks.includes("planAdjustments"),
  parserReadsTopLevelAndMetadata: parser.includes("value.plan_adjustment") && parser.includes("value.metadata?.plan_adjustment"),
  parserRequiresFourExplanations: ["failedStepTitle", "reason", "replacementStepTitle", "impact"].every((field) => parser.includes(field)),
  parserRejectsInvalidCompleteness: parser.includes('record.completeness === "blocked"') && parser.includes('record.completeness === "partial"'),
  streamDeduplicatesAdjustments: runner.includes("planAdjustmentKeys") && runner.includes('type: "plan_adjustment"'),
  backgroundDeduplicatesById: tasks.includes("candidate.id === item.id"),
  failedStepExcludedFromCompleted: tasks.includes("failedIds.has(step.id)") && tasks.includes("failedTitles.has(step.title)"),
  terminalStatusNotComplete: tasks.includes('return hasIncompleteAdjustment ? "blocked" : "completed"'),
  partialCurrentStep: tasks.includes("部分结果已生成，仍有未完成项"),
  partialSummaryHonest: tasks.includes("当前成果只反映可用材料，不能作为完整综合结论") && tasks.includes("未完成项没有被标记为通过"),
  currentWorkspaceCard: workspace.includes('data-testid="agent-plan-adjustment"') && workspace.includes("计划已调整，结果不完整"),
  taskCenterCard: taskCenter.includes('data-testid="background-task-plan-adjustment"') && taskCenter.includes("对结果的影响"),
  failedStepNonColorCue: workspace.includes('data-plan-state={adjusted ? "adjusted"') && workspace.includes('adjusted ? "⚠"'),
  accessibleStatus: workspace.includes('data-completeness={adjustment.completeness} role="status"') && taskCenter.includes('data-completeness={adjustment.completeness} role="status"'),
  visibleWarningStyle: styles.includes('.background-task-plan li[data-plan-state="adjusted"]') && styles.includes("text-decoration: line-through") && styles.includes(".agent-plan-adjustment"),
  packagedFaultInjection: smoke.includes('if (agentScenario === "d5-plan-adjustment") return runAgentPlanAdjustmentSmoke(window)') && packaged.includes('scenario === "d5-plan-adjustment"'),
  packagedChecksNoFalseComplete: smoke.includes("noFalseCompleteClaim") && packaged.includes("noFalseCompleteClaim"),
  transparentPartialArtifact: packaged.includes('"partial-research-report.md"') && packaged.includes("无法形成完整的成本争议结论"),
};

const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, count: Object.keys(checks).length, checks }, null, 2));
