import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const api = read("../shared/api/desktopApi.ts");
const backgroundTasks = read("src/main/backgroundTasks.ts");
const presentation = read("src/main/managerPresentation.ts");
const renderer = read("../shared/renderer/src/App.tsx");
const styles = read("../shared/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const packaged = read("scripts/verify-e2e-agent-run.mjs");

const checks = {
  typedCompletionCriteria: /completionCriteria\?: \{/.test(api)
    && /passed: string\[\]/.test(api)
    && /incomplete: string\[\]/.test(api),
  persistedAndClonedCriteria: /completionCriteria: \{/.test(backgroundTasks)
    && /passed: \[\.\.\.summary\.completionCriteria\.passed\]/.test(backgroundTasks)
    && /incomplete: \[\.\.\.summary\.completionCriteria\.incomplete\]/.test(backgroundTasks),
  agentProvidesPassedAndIncomplete: /任务已完成并到达可交付状态/.test(backgroundTasks)
    && /尚未由用户确认成果符合最终业务要求/.test(backgroundTasks),
  g4UsesCleanBusinessSummary: /已将最新数据更新进旧报告/.test(backgroundTasks)
    && /导师版更新报告已经生成/.test(backgroundTasks)
    && /结果图的业务含义/.test(backgroundTasks),
  agentArtifactRegistered: /event\.fileEvent\.action === "artifact"/.test(backgroundTasks)
    && /buildAgentArtifactSummary/.test(backgroundTasks),
  cernProvidesConcreteCriteria: /页数检查通过/.test(presentation)
    && /讲稿覆盖检查通过/.test(presentation)
    && /时间与目标比例尚待正式计划确认/.test(presentation),
  visibleStructuredCompletionCard: /delivery-completion-criteria/.test(renderer)
    && /delivery-checks-passed/.test(renderer)
    && /delivery-checks-incomplete/.test(renderer),
  userLanguageLabels: /完成标准/.test(renderer)
    && /已通过的检查/.test(renderer)
    && /尚未完成/.test(renderer)
    && /剩余风险/.test(renderer),
  nonColorCues: /aria-hidden="true">✓/.test(renderer)
    && /aria-hidden="true">!/.test(renderer),
  criteriaLayout: /delivery-completion-criteria/.test(styles)
    && /grid-template-columns: repeat\(2/.test(styles),
  packagedG4Task: /认真检查后再给我/.test(smoke)
    && /最新数据更新进旧报告/.test(smoke)
    && /old-report\.md/.test(packaged)
    && /latest-data\.csv/.test(packaged)
    && /result\.png/.test(packaged),
  packagedChecksAllRequiredFields: /d6ExplainsWorkDone/.test(smoke)
    && /d6ChecksPassedVisible/.test(smoke)
    && /d6IncompleteVisible/.test(smoke)
    && /d6RemainingRisksVisible/.test(smoke)
    && /d6NotOnlyTaskComplete/.test(smoke)
    && /d6NoRawRunOutput/.test(smoke),
  packagedScenarioRegistered: /"completion-criteria"/.test(packaged)
    && /D6 completion-criteria check failed/.test(packaged),
  cernPackagedCriteriaAssertions: /cernCompletionCriteriaPersisted/.test(smoke)
    && /cernCompletionCriteriaConcrete/.test(smoke),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`D6 completion criteria contract failed: ${failed.join(", ")}`);
console.log(JSON.stringify({ ok: true, checks }, null, 2));
