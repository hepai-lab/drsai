import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const tasks = read("src/main/backgroundTasks.ts");
const plans = read("src/shared/agentTaskPlan.ts");
const smoke = read("src/main/e2eSmoke.ts");
const packaged = read("scripts/verify-e2e-agent-run.mjs");

const requiredSteps = [
  "读取并确认全部研究材料",
  "比较材料并整理共识、争议和证据缺口",
  "核对结论、材料来源和不确定性",
  "生成综合报告和下一步研究问题",
];

const checks = {
  recognizesG3Task: /isMultiMaterialSynthesisTask/.test(plans)
    && /综合这些材料/.test(plans)
    && /共识/.test(plans)
    && /争议/.test(plans),
  recordsAllBusinessSteps: requiredSteps.every((step) => plans.includes(step)),
  preservesGenericAgentFlow: /确认任务目标和输入材料/.test(plans)
    && /整理并交付最终成果/.test(plans),
  cleanG3DeliverySummary: /已完成多材料综合/.test(tasks)
    && /材料读取、跨材料比较、观点整理和综合报告生成/.test(tasks)
    && /长期稳定性仍缺乏充分证据/.test(tasks),
  artifactEventCreatesResultLink: /event\.fileEvent\?\.action === "artifact"/.test(tasks)
    && /buildAgentArtifactSummary/.test(tasks),
  packagedUsesThreeIndependentStudies: ["study-a.md", "study-b.md", "study-c.md"]
    .every((name) => packaged.includes(name)),
  packagedGeneratesCompleteReport: ["## 共识", "## 争议", "## 下一步研究问题", "## 不确定性与限制", "## 来源"]
    .every((heading) => packaged.includes(heading)),
  packagedGoldenContent: /短期记忆表现改善/.test(packaged)
    && /成本判断存在冲突/.test(packaged)
    && /长期稳定性仍缺乏充分证据/.test(packaged),
  packagedOneTaskAndNoInterruption: /d4SingleRunCompleted/.test(smoke)
    && /d4NoNonCriticalApproval/.test(smoke)
    && /d4NoPendingDecision/.test(smoke),
  packagedChecksCompleteArtifact: /d4ArtifactRegistered/.test(smoke)
    && /d4CompleteReportGenerated/.test(smoke)
    && /d4GoldenConsensus/.test(smoke)
    && /d4GoldenDispute/.test(smoke)
    && /d4GoldenNextQuestion/.test(smoke),
  packagedRejectsTechnicalSteps: /d4BusinessStepsNoTechnicalNoise/.test(smoke),
  scenarioRegistered: /"continuous-task"/.test(packaged)
    && /D4 continuous-task check failed/.test(packaged),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`D4 continuous task contract failed: ${failed.join(", ")}`);
console.log(JSON.stringify({ ok: true, checks }, null, 2));
