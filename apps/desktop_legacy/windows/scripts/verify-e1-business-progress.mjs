import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const api = read("../shared/api/desktopApi.ts");
const generator = read("../shared/main/managerPresentation.ts");
const renderer = read("../shared/renderer/src/components/files/FilesContextPanel.tsx");
const agentRenderer = read("../shared/renderer/src/components/AgentRunWorkspace.tsx");
const styles = read("../shared/renderer/src/styles.css");
const smoke = read("src/main/e2eSmoke.ts");
const packaged = read("scripts/verify-packaged-presentation-pdf-action.mjs");
const packagedAgent = read("scripts/verify-e2e-agent-run.mjs");

const checks = {
  typedPresentationPhases: ["analyzing", "planning", "generating", "validating", "completed"]
    .every((phase) => api.includes(`| "${phase}"`) || api.includes(`  | "${phase}"`)),
  businessStageMapping: ["understand_material", "organize_story", "create_deck", "check_result", "ready"]
    .every((stage) => renderer.includes(stage)),
  userLanguageStageTitles: ["正在理解材料", "正在组织重点", "正在制作演示文稿", "正在检查成果", "成果已就绪"]
    .every((text) => renderer.includes(text)),
  visibleCurrentAndNext: /manager-business-progress/.test(renderer)
    && /manager-business-progress-message/.test(renderer)
    && /接下来：/.test(renderer),
  visibleFourStageRoute: /任务阶段/.test(renderer)
    && /理解材料/.test(renderer)
    && /组织重点/.test(renderer)
    && /制作演示文稿/.test(renderer)
    && /检查成果/.test(renderer),
  nonColorCuesAndCurrentStep: /aria-current=/.test(renderer)
    && /stage\.state === "done" \? "✓"/.test(renderer)
    && /stage\.state === "current" \? "▶"/.test(renderer),
  phaseMessagesAreBusinessLanguage: /正在安全读取演示型 PDF/.test(generator)
    && /正在把故事线、关键数字和来源页码组织为管理者版结构/.test(generator)
    && /正在生成可编辑文本、形状、表格和逐页讲稿/.test(generator)
    && /正在检查页数、讲稿、来源映射/.test(generator),
  visualProgressCard: /manager-business-progress/.test(styles)
    && /data-state="current"/.test(styles),
  packagedMeasuresDomLatency: /businessProgressTiming/.test(smoke)
    && /everyPhaseVisibleWithinTwoSeconds/.test(smoke)
    && /latencyMs <= 2000/.test(smoke),
  packagedChecksStateConsistency: /businessStageMatchesRunState/.test(smoke)
    && /allBusinessPhasesReceived/.test(smoke)
    && /allBusinessPhasesVisible/.test(smoke),
  packagedLanguageAndNoiseGates: /businessLanguageWhitelist/.test(smoke)
    && /technicalNoiseBlacklist/.test(smoke)
    && /notOnlyRawToolProgress/.test(smoke),
  cernScenarioRegistered: /"business-progress"/.test(packaged),
  agentBusinessStageMapping: ["understand_materials", "organize_findings", "prepare_result", "ready"]
    .every((stage) => agentRenderer.includes(stage)),
  agentBusinessLanguage: ["正在理解任务与材料", "正在整理发现", "正在整理成果", "成果已就绪"]
    .every((text) => agentRenderer.includes(text)),
  agentVisibleCurrentAndNext: /agent-business-progress/.test(agentRenderer)
    && /data-business-stage/.test(agentRenderer)
    && /接下来：/.test(agentRenderer),
  agentNonColorCues: /aria-current=/.test(agentRenderer)
    && /done \? "✓"/.test(agentRenderer)
    && /current \? "●"/.test(agentRenderer),
  agentPackagedMeasuresDomLatency: /agentBusinessProgressWithinTwoSeconds/.test(smoke)
    && /businessProgressSnapshots/.test(smoke)
    && /latencyMs <= 2000/.test(smoke),
  agentPackagedLanguageAndNoiseGates: /agentBusinessProgressUsesBusinessLanguage/.test(smoke)
    && /agentBusinessProgressNoTechnicalNoise/.test(smoke)
    && /agentBusinessProgressNotRawOutputOnly/.test(smoke),
  g3AgentScenarioRegistered: /"business-progress"/.test(packagedAgent)
    && /综合这些材料/.test(packagedAgent)
    && /paper-a\.md/.test(packagedAgent)
    && /paper-b\.md/.test(packagedAgent)
    && /data\.csv/.test(packagedAgent),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`E1 business progress contract failed: ${failed.join(", ")}`);
console.log(JSON.stringify({ ok: true, checks }, null, 2));
