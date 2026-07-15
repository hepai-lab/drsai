import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const api = readFileSync(resolve(root, "src/shared/desktopApi.ts"), "utf8");
const tasks = readFileSync(resolve(root, "src/main/backgroundTasks.ts"), "utf8");
const app = readFileSync(resolve(root, "src/renderer/src/App.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(resolve(root, "src/main/e2eSmoke.ts"), "utf8");
const e2e = readFileSync(resolve(root, "scripts/verify-e2e-agent-run.mjs"), "utf8");

const checks = {
  lineageContractTyped: api.includes("export interface DesktopArtifactEditLineage") && api.includes("editLineage?: DesktopArtifactEditLineage"),
  threeScopeTypes: ["text", "table", "image"].every((type) => api.includes(`\"${type}\"`)),
  threeActionsTyped: ["simplify_text", "sort_table_numeric", "log_scale_image"].every((action) => api.includes(action)),
  lineagePersisted: tasks.includes("buildArtifactEditLineage") && tasks.includes("editLineage: { ...artifact.editLineage }"),
  localVariantsSkipFullReportRule: tasks.includes('request.metadata?.source !== "windows-results-center-local-edit"'),
  sourceTypePreserved: tasks.includes("md|markdown|txt") && tasks.includes('"report" as const : "file" as const'),
  textSelectionUsesVisibleSelection: app.includes("window.getSelection()?.toString().trim()") && app.includes("captureTextSelection"),
  tableSelectionExplicit: app.includes('data-testid="results-select-table"') && app.includes('type: "table"'),
  imageSelectionExplicit: app.includes('type: "image"') && app.includes('data-selected={localEditScope?.type === "image"}'),
  actionLabelsUserFacing: ["改得更简单并生成新版", "按数值排序并生成新版", "改为对数坐标并生成新版"].every((text) => app.includes(text)),
  realAgentRunUsed: app.includes('source: "windows-results-center-local-edit"') && app.includes("desktopApi.startAgentRun"),
  scopeMetadataComplete: ["scope_type", "scope_label", "selected_text", "edit_action"].every((key) => app.includes(key)),
  originalProtectionExplicit: app.includes("不得覆盖或改写源文件") && app.includes("保持不变"),
  newVersionRequired: app.includes("create_new_version: true") && app.includes("preserve_unselected: true"),
  completionVisible: app.includes('data-testid="results-edit-status"') && app.includes("原成果保持不变"),
  lineageVisible: app.includes('data-testid="results-edit-lineage"'),
  comparisonEntryVisible: app.includes('data-testid="results-compare-artifact"') && app.includes('data-testid="results-compare-dialog"'),
  sideBySideComparison: app.includes("原版与修改版比较") && styles.includes(".results-compare-grid"),
  selectedScopeStyled: styles.includes('img[data-selected="true"]') && styles.includes('table[data-selected="true"]'),
  packagedThreeEdits: smoke.includes("threeEditRunsCompleted") && smoke.includes("threeNewVersionsRegistered"),
  packagedScopeIsolation: e2e.includes("textOutsideSelectionPreserved") && e2e.includes("tableCellSetPreserved") && e2e.includes("unrelatedArtifactPreserved"),
  packagedNoOverwrite: e2e.includes("originalFilesOverwritten: 0") && e2e.includes("source report") && e2e.includes("source table") && e2e.includes("source image"),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, checks, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, total: Object.keys(checks).length }, null, 2));
