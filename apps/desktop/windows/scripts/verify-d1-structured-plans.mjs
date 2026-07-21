import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tasks = readFileSync(resolve(root, "src/main/backgroundTasks.ts"), "utf8");
const planSource = readFileSync(resolve(root, "../shared/api/agentTaskPlan.ts"), "utf8");
const shared = readFileSync(resolve(root, "../shared/api/desktopApi.ts"), "utf8");
const view = readFileSync(resolve(root, "../shared/renderer/src/components/SkillSquareView.tsx"), "utf8");
const agentView = readFileSync(resolve(root, "../shared/renderer/src/components/AgentRunWorkspace.tsx"), "utf8");
const smoke = readFileSync(resolve(root, "src/main/e2eSmoke.ts"), "utf8");

const forbiddenTerms = /agent|tool|function|mcp|server|json|ipc|sse|request[_ -]?id|run[_ -]?id|参数/i;
const planTitles = [
  "读取并确认数据文件和分析目标", "检查数据质量、缺失值、重复行和异常点", "核对统计结果、图表和异常解释", "生成数据问题摘要和改进建议",
  "读取并确认全部研究材料", "比较材料并整理共识、争议和证据缺口", "核对结论、材料来源和不确定性", "生成综合报告和下一步研究问题",
  "读取旧报告、最新数据和结果图", "更新报告中的数字、文字和图表关系", "核对新数据、结果图与报告内容一致", "生成保留原文件的导师版报告",
  "确认任务目标和输入材料", "完成任务所需的分析与处理", "检查结果是否符合任务目标", "整理并交付最终成果",
];

const checks = {
  structuredPlanType: /DesktopTaskPlanPhase = "input" \| "process" \| "check" \| "output"/.test(shared)
    && /interface DesktopTaskPlanStep/.test(shared),
  planPersistedOnTask: /planSteps\?: DesktopTaskPlanStep\[\]/.test(shared)
    && tasks.includes("planSteps,") && tasks.includes("completedSteps,"),
  g2Recognizer: /function isDataQualityTask/.test(planSource) && /这份数据/.test(planSource),
  g2Input: planSource.includes("读取并确认数据文件和分析目标"),
  g2Processing: planSource.includes("检查数据质量、缺失值、重复行和异常点"),
  g2Check: planSource.includes("核对统计结果、图表和异常解释"),
  g2Output: planSource.includes("生成数据问题摘要和改进建议"),
  g3Coverage: ["读取并确认全部研究材料", "比较材料并整理共识、争议和证据缺口", "核对结论、材料来源和不确定性", "生成综合报告和下一步研究问题"].every((title) => planSource.includes(title)),
  g4Coverage: ["读取旧报告、最新数据和结果图", "更新报告中的数字、文字和图表关系", "核对新数据、结果图与报告内容一致", "生成保留原文件的导师版报告"].every((title) => planSource.includes(title)),
  genericPlanFallback: ["确认任务目标和输入材料", "完成任务所需的分析与处理", "检查结果是否符合任务目标", "整理并交付最终成果"].every((title) => planSource.includes(title)),
  noForbiddenPlanTitles: planTitles.every((title) => planSource.includes(title) && !forbiddenTerms.test(title)),
  visiblePlan: /data-testid="background-task-plan"/.test(view)
    && /data-testid="agent-task-plan"/.test(agentView)
    && /data-phase=\{step\.phase\}/.test(agentView),
  visibleState: /data-plan-state=/.test(agentView)
    && /completedSteps\?\.includes\(step\.title\)/.test(agentView)
    && /refreshTaskPlan/.test(agentView),
  semanticThreshold: /semanticCoverage >= 0\.9/.test(smoke),
  packagedMatrix: /startsWith\("d1-plan-"\)/.test(smoke)
    && /\["g2", "g3", "g4"\]/.test(smoke),
};

const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  throw new Error(`D1 structured-plan verification failed: ${failures.join(", ")}`);
}

console.log(`D1 structured-plan verification passed (${Object.keys(checks).length} checks).`);
