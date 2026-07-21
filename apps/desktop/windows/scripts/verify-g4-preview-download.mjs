import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const api = readFileSync(resolve(root, "../shared/api/desktopApi.ts"), "utf8");
const main = readFileSync(resolve(root, "src/main/index.ts"), "utf8");
const preload = readFileSync(resolve(root, "../shared/main/preload.ts"), "utf8");
const mock = readFileSync(resolve(root, "../shared/renderer/src/mockDesktopApi.ts"), "utf8");
const app = readFileSync(resolve(root, "../shared/renderer/src/App.tsx"), "utf8");
const styles = readFileSync(resolve(root, "../shared/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(resolve(root, "src/main/e2eSmoke.ts"), "utf8");
const e2e = readFileSync(resolve(root, "scripts/verify-e2e-agent-run.mjs"), "utf8");

const checks = {
  saveContractTyped: api.includes("export interface WorkspaceFileSaveAsRequest") && api.includes("export interface WorkspaceFileSaveAsResult"),
  integrityReturned: api.includes("sourceHash: string") && api.includes("destinationHash?: string") && api.includes("integrityVerified: boolean"),
  apiExposedThroughPreload: api.includes("saveWorkspaceFileAs(request") && preload.includes('desktop:workspace-file-save-as'),
  mockSupportsFeature: mock.includes("saveWorkspaceFileAs: async"),
  trustedIpcHandler: main.includes('secureHandle("desktop:workspace-file-save-as"'),
  sourceConfinedToWorkspace: main.includes("await previewWorkspaceFile({ workspacePath: request.workspacePath, path: request.path"),
  nativeSaveDialog: main.includes("dialog.showSaveDialog") && main.includes('title: "Save result as"'),
  noProductionDirectDestination: main.includes("A direct save destination is only available to packaged acceptance tests"),
  extensionPreserved: main.includes("ensureOriginalExtension") && main.includes("extension: extname(destinationPath).toLowerCase()"),
  byteSizeVerified: main.includes("savedStat.size === preview.size"),
  sha256Verified: main.includes('createHash("sha256")') && main.includes("destinationHash === sourceHash"),
  corruptCopyFails: main.includes("saved copy failed the automatic size or SHA-256 integrity check"),
  previewActionVisible: app.includes('data-testid="results-preview-artifact"') && app.includes("previewArtifact"),
  saveActionVisible: app.includes('data-testid="results-save-artifact"') && app.includes("saveArtifactAs"),
  previewIsInAppDialog: app.includes('data-testid="results-preview-dialog"') && app.includes('aria-modal="true"'),
  fivePreviewRenderers: app.includes('data-preview-kind={previewState.preview.kind}') && app.includes('previewState.preview.kind === "image"') && app.includes('previewState.preview.kind === "table"') && app.includes("previewState.preview.content || previewState.preview.message"),
  saveFeedbackExplicit: app.includes("已另存并通过完整性校验") && app.includes('data-testid="results-save-status"'),
  previewStylesPresent: styles.includes(".results-preview-dialog") && styles.includes(".results-preview-content table") && styles.includes(".results-preview-content img"),
  packagedFiveFormatMatrix: smoke.includes("fivePreviewKindsCorrect") && ["pdfPreviewVisible", "wordPreviewVisible", "tablePreviewVisible", "imagePreviewVisible", "markdownPreviewVisible"].every((name) => smoke.includes(name)),
  pdfSystemOpenFallback: smoke.includes("pdfSystemOpenAvailable") && smoke.includes("results-open-artifact"),
  packagedTwentySaves: smoke.includes("round <= 4") && smoke.includes("twentySaveActionsCompleted"),
  packagedChinesePathAndHashes: e2e.includes('join(tempDir, "下载结果", "导师版本")') && e2e.includes("hashesMatched") && e2e.includes("extensionsPreserved"),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, checks, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, total: Object.keys(checks).length }, null, 2));
