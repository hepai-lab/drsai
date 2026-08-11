import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (path) => readFileSync(join(root, path), "utf8");
const api = read("../shared/api/desktopApi.ts");
const tasks = read("src/main/backgroundTasks.ts");
const notifications = `${read("src/main/completionNotifications.ts")}\n${read("../shared/main/completionNotifications.ts")}`;
const generator = read("../shared/main/managerPresentation.ts");
const renderer = read("../shared/renderer/src/App.tsx");
const smoke = read("src/main/e2eSmoke.ts");

const checks = {
  typedDeliverySummary: /interface DesktopTaskDeliverySummary/.test(api),
  findingField: /findingSummary: string/.test(api),
  importanceField: /importance: DesktopTaskImportance/.test(api),
  artifactsField: /artifacts: DesktopTaskArtifactLink\[\]/.test(api),
  suggestedActionField: /suggestedAction: string/.test(api),
  g7CompletionFields: /workSummary: string/.test(api)
    && /coreConclusion: string/.test(api)
    && /verification: string/.test(api)
    && /remainingRisks: string/.test(api),
  taskPersistence: /deliverySummary: normalizeDeliverySummary/.test(tasks),
  cernSummaryGenerated: /HL-LHC 数据增长/.test(generator)
    && /管理者版 PPT/.test(generator),
  fourNotificationLabels: /发现：/.test(notifications)
    && /重要程度：/.test(notifications)
    && /成果入口：/.test(notifications)
    && /建议操作：/.test(notifications),
  notificationRedaction: /redactDeliverySummary/.test(notifications),
  exactTargetLookup: /candidate\.targetId === event\.target\.targetId/.test(renderer),
  fourVisibleSections: /delivery-finding/.test(renderer)
    && /delivery-importance/.test(renderer)
    && /delivery-artifacts/.test(renderer)
    && /delivery-action/.test(renderer),
  artifactOpenAction: /desktopApi\.openPath\(artifact\.path\)/.test(renderer),
  fullCompletionCard: /delivery-work-summary/.test(renderer)
    && /delivery-core-conclusion/.test(renderer)
    && /delivery-verification/.test(renderer)
    && /delivery-risks/.test(renderer),
  packagedRouteAssertions: /structuredSummaryCorrectTask/.test(smoke)
    && /structuredSummaryArtifactCorrect/.test(smoke)
    && /structuredNotificationFourFields/.test(smoke),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`K3 structured summary contract failed: ${failed.join(", ")}`);
console.log(JSON.stringify({ ok: true, checks }, null, 2));
