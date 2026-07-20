import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const app = readFileSync(resolve(root, "src/renderer/src/App.tsx"), "utf8");
const navigation = readFileSync(resolve(root, "src/renderer/src/navigation.ts"), "utf8");
const shell = readFileSync(resolve(root, "src/renderer/src/components/WorkspaceShell.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/renderer/src/styles.css"), "utf8");
const smoke = readFileSync(resolve(root, "src/main/e2eSmoke.ts"), "utf8");

const checks = {
  fixedRouteDeclared: navigation.includes('results: "results"'),
  fixedRouteEnabled: navigation.includes('{ id: MENU_IDS.results, enabled: true }'),
  localizedNavigationLabel: navigation.includes('[MENU_IDS.results]: "成果库"') && navigation.includes('[MENU_IDS.results]: "Results Library"'),
  resultsLivesInPrimaryTaskNavigation: navigation.includes('{ id: MENU_IDS.results, enabled: true }') && shell.includes('label={resultsItem.label}'),
  workspaceResultShortcut: shell.includes('zh ? "查看成果" : "View Results"') && shell.includes('onOpenWorkspaceResults(workspaceDetails.id)'),
  fixedViewRenderedFromRoute: app.includes('activeNav === MENU_IDS.results') && app.includes('<ResultsCenterView'),
  fixedRouteTestId: app.includes('data-testid="results-center-view" data-route="results"'),
  authoritativeTaskSource: app.includes('desktopApi.listBackgroundTasks({ limit: 100 })'),
  artifactStableIdIndexed: app.includes('indexed.set(artifact.id') && app.includes('data-artifact-id={artifact.id}'),
  sourceTaskIndexed: app.includes('data-source-task-id={artifact.sourceTaskId}') && app.includes('sourceTaskTitle: task.title'),
  resultTypeIndexed: app.includes('data-artifact-kind={artifact.kind}') && app.includes('results-kind-index'),
  workspaceScopeDefaultsLocally: app.includes('useState<"workspace" | "all">("workspace")') && app.includes('setWorkspaceScope("workspace")') && app.includes('getComparablePath(artifact.sourceWorkspacePath) === getComparablePath(workspacePath)'),
  allWorkspacesCanBeSelected: app.includes('zh ? "全部工作区" : "All workspaces"') && styles.includes('.results-workspace-scope button[aria-pressed="true"]'),
  allArtifactKindsSupported: ['"report"', '"presentation"', '"file"', '"folder"'].every((kind) => app.includes(kind)),
  openActionUsesRegisteredPath: app.includes('desktopApi.openPath(artifact.path)') && app.includes('data-testid="results-open-artifact"'),
  visibleOpenOutcome: app.includes('data-testid="results-open-status"') && app.includes('state: "failed"'),
  emptyStateExplained: app.includes('data-testid="results-center-empty"'),
  taskGroupingStyled: styles.includes('.results-task-index > section'),
  typeFilteringStyled: styles.includes('.results-kind-index button[aria-pressed="true"]'),
  fourTaskPackagedScenario: smoke.includes('"g1-paper-summary"') && smoke.includes('"g4-mentor-report"'),
  noChatNavigationInScenario: smoke.includes('navigationPath: "main-sidebar-results"') && smoke.includes('noChatTemporaryLinkUsed'),
  everyResultOpenedInScenario: smoke.includes('everyResultOpenActionWorks') && smoke.includes('idsStableAfterRefresh'),
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) {
  console.error(JSON.stringify({ ok: false, checks, failed }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks, total: Object.keys(checks).length }, null, 2));
