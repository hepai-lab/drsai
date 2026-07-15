import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const api = read("src/shared/desktopApi.ts");
const tasks = read("src/main/backgroundTasks.ts");
const renderer = read("src/renderer/src/App.tsx");
const styles = read("src/renderer/src/styles.css");
const main = read("src/main/index.ts");
const smoke = read("src/main/e2eSmoke.ts");
const packaged = read("scripts/verify-packaged-presentation-pdf-action.mjs");

const checks = {
  typedFiveFieldContract: /workSummary: string/.test(api)
    && /coreConclusion: string/.test(api)
    && /artifacts: DesktopTaskArtifactLink\[\]/.test(api)
    && /verification: string/.test(api)
    && /remainingRisks: string/.test(api),
  persistedWithUnderlyingTask: /deliverySummary: normalizeDeliverySummary/.test(tasks),
  cardShowsFiveFields: /delivery-work-summary/.test(renderer)
    && /delivery-core-conclusion/.test(renderer)
    && /delivery-artifacts/.test(renderer)
    && /delivery-verification/.test(renderer)
    && /delivery-risks/.test(renderer),
  taskIdentityExposed: /data-status=\{task\.status\}/.test(renderer)
    && /data-target-id=\{task\.targetId\}/.test(renderer),
  everyArtifactGetsOpenAction: /summary\.artifacts\.map\(\(artifact\)/.test(renderer)
    && /openArtifact\(artifact\)/.test(renderer),
  openActionUsesDesktopBridge: /desktopApi\.openPath\(artifact\.path\)/.test(renderer),
  openSuccessAndFailureVisible: /delivery-artifact-open-status/.test(renderer)
    && /state: error \? "failed" : "opened"/.test(renderer)
    && /role="status"/.test(renderer),
  openStatusStyledWithoutColorOnly: /delivery-artifact-entry \[role="status"\]/.test(styles)
    && /data-state="opened"/.test(styles)
    && /data-state="failed"/.test(styles),
  mainValidatesBeforeSystemOpen: /if \(!\(await isAllowedOpenPath\(rawPath\)\)\)/.test(main)
    && /return shell\.openPath\(rawPath\)/.test(main),
  packagedClicksArtifact: /artifact\?\.click\(\)/.test(smoke)
    && /completionArtifactOpened/.test(smoke)
    && /artifactOpenState === "opened"/.test(smoke),
  packagedUsesSafeExternalBoundary: /OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN/.test(packaged)
    && /OPENDRSAI_E2E_SUPPRESS_EXTERNAL_OPEN/.test(main),
  packagedChecksTaskState: /structuredSummaryCorrectTask/.test(smoke)
    && /routed\.status === "completed"/.test(smoke),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`G7 completion summary contract failed: ${failed.join(", ")}`);
console.log(JSON.stringify({ ok: true, checks }, null, 2));
