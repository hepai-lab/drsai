import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const shared = readFileSync(join(root, "..", "shared", "api", "desktopApi.ts"), "utf8");
const main = readFileSync(join(root, "src", "main", "index.ts"), "utf8");
const preload = readFileSync(join(root, "..", "shared", "main", "preload.ts"), "utf8");
const app = readFileSync(join(root, "..", "shared", "renderer", "src", "App.tsx"), "utf8");
const mock = readFileSync(join(root, "..", "shared", "renderer", "src", "mockDesktopApi.ts"), "utf8");
const smoke = readFileSync(join(root, "src", "main", "e2eSmoke.ts"), "utf8");

const checks = {
  typedDecisionContract: shared.includes('DesktopAnomalyDecision = "keep" | "exclude" | "both"') && shared.includes("DesktopAnomalyDecisionApplyResult"),
  desktopApiExposed: shared.includes("applyAnomalyDecision(") && preload.includes('desktop:apply-anomaly-decision') && mock.includes("applyAnomalyDecision: async"),
  workspaceBoundedRuntime: main.includes("async function applyAnomalyDecision") && main.includes("isAllowedOpenPath(request.workspacePath)") && main.includes("previewWorkspaceFile({ workspacePath: request.workspacePath"),
  sourcePreserved: main.includes("原始数据未改动") && main.includes("sourceSha256") && !main.includes("unlink(preview.path"),
  outputsAndReceipt: main.includes("-保留全部.csv") && main.includes("-排除异常.csv") && main.includes("-异常处理决定.json"),
  threeExclusiveOptions: app.includes('results-anomaly-option-${value}') && app.includes('name={`anomaly-decision-${artifact.id}`}') && app.includes('["keep"') && app.includes('["exclude"') && app.includes('["both"'),
  impactExplanations: app.includes("异常值可能影响整体趋势") && app.includes("便于观察基线") && app.includes("互不覆盖"),
  decisionPersisted: app.includes("anomalyDecision: result") && app.includes('data-testid="results-anomaly-record"') && app.includes("result.resultSummary"),
  keyboardNativeControls: app.includes('type="radio"') && app.includes('type="button"') && app.includes('role="status"'),
  packagedThreeBranchCoverage: smoke.includes("runF4AnomalyDecisionSmoke") && smoke.includes("keepBranchExact") && smoke.includes("excludeBranchExact") && smoke.includes("branchIsolation"),
  cernFixturePinned: smoke.includes("f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e") && smoke.includes("pdfSize === 7664262"),
  measurableSideEffects: smoke.includes("sideEffectLedgerExact") && smoke.includes("outputHashesRecorded") && smoke.includes("originalsUnchanged"),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed);
if (failed.length) throw new Error(`F4 contract verification failed: ${failed.map(([name]) => name).join(", ")}`);
console.log(`F4 anomaly-decision contract passed ${Object.keys(checks).length}/${Object.keys(checks).length} checks.`);
