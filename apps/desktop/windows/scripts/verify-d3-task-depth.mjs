import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const shared = read("src/shared/agentTaskDepth.ts");
const api = read("src/shared/desktopApi.ts");
const main = read("src/main/agentRuns.ts");
const view = read("src/renderer/src/components/AgentRunWorkspace.tsx");
const styles = read("src/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const packaged = read("scripts/verify-e2e-agent-run.mjs");

const checks = {
  typedDepthContract: api.includes('export type AgentTaskDepth = "quick" | "standard" | "deep"') && api.includes("executionDepth?: AgentTaskDepth"),
  threeDepthDefinitions: ["quick", "standard", "deep"].every((depth) => shared.includes(`id: "${depth}"`)),
  estimatedTimes: ["2～5 分钟", "5～15 分钟", "15～30 分钟"].every((text) => shared.includes(text)),
  visibleOutputDifferences: ["核心结论与下一步建议", "结构化报告与来源清单", "详细报告、证据附录与风险清单"].every((text) => shared.includes(text)),
  depthValidation: main.includes("isAgentTaskDepth(request.executionDepth)") && main.includes("Agent run execution depth is invalid"),
  gatewayMetadata: main.includes("execution_depth: request.executionDepth"),
  promptRejectsLengthOnly: main.includes("不能只改变文字长度") && main.includes("buildAgentTaskDepthContract(request.executionDepth)"),
  quickExecutionDifference: shared.includes("只选择完成任务所必需且最相关的材料") && shared.includes("一次核心事实或一致性检查"),
  standardExecutionDifference: shared.includes("覆盖全部已提供材料，并比较主要结论") && shared.includes("核对关键事实、来源和材料间一致性"),
  deepExecutionDifference: shared.includes("明确冲突和不确定性") && shared.includes("独立方法复核"),
  visibleSelector: view.includes('data-testid="agent-depth-selector"') && ["quick", "standard", "deep"].every((depth) => view.includes('data-testid={`agent-depth-${option.id}`}')),
  nativeRadioAccessibility: view.includes('name="agent-task-depth"') && view.includes('type="radio"') && view.includes("checked={executionDepth === option.id}"),
  keyboardFocusVisible: styles.includes(".agent-depth-options label:has(input:focus-visible)") && styles.includes("outline: 3px solid var(--app-focus-ring)"),
  defaultStandard: view.includes('useState<AgentTaskDepth>("standard")'),
  selectedDepthSubmitted: view.includes("executionDepth,") && view.includes("setExecutionDepth(option.id)"),
  readableThreeCards: styles.includes(".agent-depth-options {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr)") && styles.includes(".agent-depth-selector {\n  margin: 0;\n  padding: 12px;\n  box-sizing: border-box;\n  min-width: 0;\n  max-width: 100%"),
  packagedThreeRunScenario: smoke.includes('if (agentScenario === "d3-depth") return runAgentDepthSmoke(window)') && packaged.includes('scenario === "d3-depth"'),
  structuralResultAssertions: ["quickUsesFocusedMaterial", "standardCoversAllMaterials", "deepPerformsIndependentReview", "deliverablesDiffer", "differencesAreStructural"].every((check) => smoke.includes(check) && packaged.includes(check)),
  deterministicDeliverableMatrix: packaged.includes('path: "quick-findings.md"') && packaged.includes('path: "standard-sources.md"') && packaged.includes('path: "deep-evidence-appendix.md"') && packaged.includes('path: "deep-risk-list.md"'),
};

const failed = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, failed, checks }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, count: Object.keys(checks).length, checks }, null, 2));
