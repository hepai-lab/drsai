import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const api = readFileSync(resolve(root, "src/shared/desktopApi.ts"), "utf8");
const tasks = readFileSync(resolve(root, "src/main/backgroundTasks.ts"), "utf8");
const app = readFileSync(resolve(root, "src/renderer/src/App.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(resolve(root, "src/main/e2eSmoke.ts"), "utf8");

const checks = {
  qualityContractTyped: api.includes("export interface DesktopArtifactQuality") && api.includes('status: "passed" | "failed"'),
  qualityPersistedOnArtifact: api.includes("quality?: DesktopArtifactQuality") && tasks.includes("quality: normalizeArtifactQuality"),
  markdownReadAndFormatChecked: tasks.includes('readFile(reportPath, "utf8")') && tasks.includes("formatValid"),
  sixSectionsRequired: ["标题", "摘要", "方法", "结果", "限制", "来源"].every((section) => tasks.includes(section)),
  placeholderScan: tasks.includes("placeholderCount") && tasks.includes("Lorem ipsum") && tasks.includes("待补充"),
  mojibakeScan: tasks.includes("mojibakeCount") && tasks.includes("未发现乱码"),
  emptyImageScan: tasks.includes("emptyImageCount") && tasks.includes("未发现空图"),
  brokenLocalLinkScan: tasks.includes("brokenLinkCount") && tasks.includes("await stat(resolve(dirname(reportPath)"),
  goldenFactsFromInputs: tasks.includes("goldenFacts") && tasks.includes("goldenFactCoverage") && tasks.includes("goldenFactCoverage >= 90"),
  csvFactsParsed: tasks.includes('/\\.csv$/i.test(fileName)') && tasks.includes("row.split(\",\")"),
  completionCriteriaIncludesQuality: tasks.includes("可交付文件已通过结构和格式检查"),
  failedQualityNotHidden: tasks.includes("可交付文件质量检查未通过"),
  qualityVisibleInResults: app.includes('data-testid="results-artifact-quality"') && app.includes('data-testid="results-quality-details"'),
  passAndFailAreNonColorLabels: app.includes("质量检查已通过") && app.includes("质量检查未通过"),
  qualityDetailsStyled: styles.includes(".results-quality-details") && styles.includes('.results-quality-badge[data-quality-status="failed"]'),
  packagedGoldenScenario: smoke.includes("g2DeliverableReport") && smoke.includes("g2GoldenCoverageAtLeast90"),
  packagedChecksAllDefects: ["g2NoPlaceholders", "g2NoMojibake", "g2NoEmptyImages", "g2NoBrokenLinks"].every((check) => smoke.includes(check)),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, checks, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, total: Object.keys(checks).length }, null, 2));
