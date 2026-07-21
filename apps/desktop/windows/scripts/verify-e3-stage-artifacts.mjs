import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const api = read("../shared/api/desktopApi.ts");
const generator = read("src/main/managerPresentation.ts");
const persistence = read("src/main/managerPresentationTasks.ts");
const renderer = read("../shared/renderer/src/components/files/FilesContextPanel.tsx");
const packaged = read("scripts/verify-packaged-presentation-pdf-action.mjs");
const smoke = read("src/main/e2eSmoke.ts");

const checks = {
  typedStageArtifact: /interface ManagerPresentationStageArtifact/.test(api),
  explicitTemporaryFlag: /temporary: true/.test(api),
  explicitImmutableFlag: /immutable: true/.test(api),
  tenMinuteDefaultThreshold: /10 \* 60 \* 1000/.test(generator),
  analysisSnapshot: /"analysis",[\s\S]*"PDF 分析摘要"/.test(generator),
  outlineSnapshot: /"outline",[\s\S]*"PPT 结构草案"/.test(generator),
  finalDoesNotReuseSnapshotPath: /\.opendrsai", "stage-results"/.test(generator)
    && /join\(artifactDir,/.test(generator),
  snapshotsVersionInsteadOfOverwrite: /nextAvailablePath\(join\(stageDir/.test(generator),
  stageArtifactsPersistForRecovery: /stageArtifacts: sanitizeStageArtifacts/.test(persistence),
  userVisibleTemporaryLabel: /manager-presentation-stage-artifacts/.test(renderer)
    && /临时结果/.test(renderer)
    && /不会覆盖/.test(renderer),
  openSnapshotAction: /打开快照/.test(renderer) && /desktopApi\.openPath\(artifact\.path\)/.test(renderer),
  packagedTenMinuteScenario: /stage-artifacts/.test(packaged)
    && /600001/.test(packaged)
    && /stageArtifactContentsNotOverwritten/.test(smoke),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length > 0) throw new Error(`E3 stage artifact contract failed: ${failed.join(", ")}`);
console.log(JSON.stringify({ ok: true, checks }, null, 2));
