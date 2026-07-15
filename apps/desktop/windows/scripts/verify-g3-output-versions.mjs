import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = readFileSync(resolve(root, "src/renderer/src/App.tsx"), "utf8");
const tasks = readFileSync(resolve(root, "src/main/backgroundTasks.ts"), "utf8");
const styles = readFileSync(resolve(root, "src/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(resolve(root, "src/main/e2eSmoke.ts"), "utf8");
const e2e = readFileSync(resolve(root, "scripts/verify-e2e-agent-run.mjs"), "utf8");

const suffixes = ["one-page-summary.md", "full-report.md", "presentation-outline.md", "email.md", "english.md"];
const checks = {
  passedReportsOfferAction: app.includes('artifact.quality?.status === "passed"') && app.includes('data-testid="results-create-versions"'),
  actionUsesFixedResultsCenter: app.includes("function ResultsCenterView") && app.includes("createArtifactVersions"),
  workspacePropagatedFromSourceTask: app.includes("sourceWorkspacePath") && app.includes("workspacePath: artifact.sourceWorkspacePath"),
  createsRealAgentThread: app.includes('kind: "agent_run"') && app.includes("desktopApi.startAgentRun"),
  sourceReportAttached: app.includes('files: [{ kind: "file", path: artifact.path, name: artifact.label }]'),
  fiveExplicitOutputs: suffixes.every((suffix) => app.includes(suffix)),
  audienceFormatsSpecified: ["决策者快速阅读", "讲述要点", "明确行动请求", "全英文版本"].every((text) => app.includes(text)),
  consistencyContractExplicit: app.includes("100% 一致") && app.includes("required_numeric_consistency: 100"),
  versionMetadataComplete: app.includes("windows-results-center-versioning") && app.includes("output_versions"),
  conciseTaskTitle: tasks.includes("生成 5 种成果版本：") && tasks.includes("agentInputFileName(request)"),
  visibleLifecycle: ["starting", "running", "completed", "failed"].every((state) => app.includes(`\"${state}\"`)),
  successReturnsToResultsCenter: app.includes("五种版本已生成，可在成果中心查看"),
  variantFormatsNotMisjudged: tasks.includes('request.metadata?.source !== "windows-results-center-versioning"'),
  actionAndStatusStyled: styles.includes(".results-artifact-actions") && styles.includes('data-testid="results-version-status"'),
  packagedScenarioRouted: smoke.includes('agentScenario === "g3-output-versions"') && smoke.includes("runOutputVersionsSmoke"),
  packagedChecksFiveFormats: ["onePageFormat", "fullReportFormat", "presentationOutlineFormat", "emailFormat", "englishFormat"].every((check) => smoke.includes(check)),
  packagedChecksNumericConsistency: smoke.includes("numericConsistency100") && e2e.includes("matched !== 20") && e2e.includes("coverage !== 100"),
  packagedChecksTraceability: smoke.includes("sourceTraceable") && smoke.includes("mentor-report.md"),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, checks, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, total: Object.keys(checks).length }, null, 2));
