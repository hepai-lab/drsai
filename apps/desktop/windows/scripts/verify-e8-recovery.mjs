import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const tasks = read("../shared/main/managerPresentationTasks.ts");
const filesUi = read("../shared/renderer/src/components/files/FilesContextPanel.tsx");
const api = read("../shared/api/desktopApi.ts");
const preload = read("../shared/main/preload.ts");
const main = read("src/main/index.ts");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-packaged-presentation-pdf-action.mjs");

const checks = {
  typedRecoveryDecision: api.includes('decision: "restart" | "abandon"') && api.includes("resolveManagerPresentationRecovery"),
  trustedIpcBoundary: main.includes('secureHandle("desktop:manager-presentation-recovery-resolve"') && preload.includes('ipcRenderer.invoke("desktop:manager-presentation-recovery-resolve"'),
  continueChoice: filesUi.includes("Resume unfinished task") && filesUi.includes('data-testid="generate-manager-presentation"'),
  restartChoice: filesUi.includes('data-testid="restart-manager-presentation"') && filesUi.includes("重新开始"),
  abandonChoice: filesUi.includes('data-testid="abandon-manager-presentation"') && filesUi.includes("放弃任务"),
  interruptedOnlyChoices: filesUi.includes('managerPresentationProgress?.phase === "interrupted"'),
  restartUsesFreshId: filesUi.includes('createManagerPresentation("restart")') && filesUi.includes("crypto.randomUUID()"),
  abandonClearsUi: filesUi.includes("setManagerPresentationProgress(null)") && filesUi.includes("setManagerPresentationRequirementStatus(null)"),
  recoveryScopedToMaterial: tasks.includes("samePath(candidate.workspacePath, workspacePath)") && tasks.includes("samePath(candidate.sourcePath, sourcePath)"),
  partialCleanupWorkspaceBounded: tasks.includes('pathWithinWorkspace.startsWith("..")') && tasks.includes('extname(outputPath).toLowerCase() !== ".pptx"'),
  sourcePreservationMessage: tasks.includes("原始材料和已完成成果均已保留"),
  atomicBackupFallback: tasks.includes('`${tasksPath}.bak`') && tasks.includes("renameSync(tasksPath, backupPath)") && tasks.includes("renameSync(backupPath, tasksPath)"),
  realForcedKill: runner.includes('child.kill("SIGKILL")') && runner.includes('OPENDRSAI_E2E_PRESENTATION_SCENARIO: "strong-kill-wait"'),
  killAfterPersistedCheckpoint: runner.includes("task.progress >= 12") && runner.includes("taskPersisted"),
  threePackagedDecisions: ["strong-kill-resume", "strong-kill-restart", "strong-kill-abandon"].every((value) => runner.includes(value)),
  twentyRunMatrix: read("scripts/verify-e8-strong-kill-stability.mjs").includes('OPENDRSAI_E8_ITERATIONS || "20"'),
  choiceAssertionsInRenderer: ["continueChoiceVisible", "restartChoiceVisible", "abandonChoiceVisible"].every((value) => smoke.includes(value)),
};

for (const [name, passed] of Object.entries(checks)) {
  if (!passed) throw new Error(`E8 recovery contract failed: ${name}`);
}
console.log(`E8 recovery contract passed (${Object.keys(checks).length} checks).`);
