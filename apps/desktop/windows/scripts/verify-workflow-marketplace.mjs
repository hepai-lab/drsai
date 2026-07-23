import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Workflow marketplace verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const api = read("../shared/api/desktopApi.ts");
const policy = read("../shared/api/executionPolicy.ts");
const marketplace = read("src/main/workflowMarketplace.ts");
const durableStore = read("../shared/main/durableJsonStore.ts");
const main = read("src/main/index.ts");
const preload = read("../shared/main/preload.ts");
const skillSquare = read("../shared/renderer/src/components/SkillSquareView.tsx");
const mock = read("../shared/renderer/src/mockDesktopApi.ts");
const styles = read("../shared/renderer/src/styles.css");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(
  marketplace.includes("readDurableJson(WORKFLOW_MARKETPLACE_IMPORTS_FILE") &&
    marketplace.includes("writeDurableJson(WORKFLOW_MARKETPLACE_IMPORTS_FILE") &&
    durableStore.includes("`${filePath}.bak`") &&
    durableStore.includes("replaceFileSafely"),
  "workflow marketplace imports do not use atomic primary/backup recovery",
);

assert(
  packageJson.includes(
    '"verify:workflow-marketplace": "node scripts/verify-workflow-marketplace.mjs"',
  ),
  "package script is not registered",
);

assert(api.includes("DesktopWorkflowTemplate"), "shared API omits workflow template type");
assert(
  api.includes("DesktopWorkflowMarketplaceListResult"),
  "shared API omits marketplace list result",
);
assert(
  api.includes("DesktopWorkflowMarketplaceSyncRequest") &&
    api.includes("DesktopWorkflowMarketplaceSyncResult") &&
    api.includes("syncWorkflowMarketplace(") &&
    api.includes("syncedCount?: number") &&
    api.includes("lastSyncedAt?: string"),
  "shared API omits workflow marketplace sync contract",
);
assert(
  api.includes("DesktopProjectSkillPublishRequest") &&
    api.includes("DesktopProjectSkillPublishResult") &&
    api.includes("publishProjectSkillDraft(") &&
    api.includes('"marketplace_submission"') &&
    api.includes("marketplaceSubmissionPath"),
  "shared API omits reviewed skill marketplace submission contract",
);
assert(
  api.includes("DesktopWorkflowRunPrepareRequest") &&
    api.includes("DesktopWorkflowRunPrepareResult") &&
    api.includes("DesktopWorkflowRunRecipe") &&
    api.includes("DesktopWorkflowRunStep"),
  "shared API omits workflow run recipe types",
);
assert(
  api.includes("DesktopWorkflowRunStartRequest") &&
    api.includes("DesktopWorkflowRunStartResult") &&
    api.includes("DesktopWorkflowRunStepExecution") &&
    api.includes("DesktopWorkflowExecutionStatus"),
  "shared API omits workflow run execution types",
);
assert(
  api.includes("listWorkflowMarketplace("),
  "desktop API omits listWorkflowMarketplace",
);
assert(
  api.includes("prepareWorkflowRun(") &&
    api.includes('"workflow"') &&
    policy.includes('"workflow.run"'),
  "desktop API omits workflow run preparation contract",
);
assert(
  api.includes("startWorkflowRun(") && api.includes("listWorkflowRuns("),
  "desktop API omits workflow run engine methods",
);
assert(
  api.includes("DesktopWorkflowRunStepDispatchRequest") &&
    api.includes("DesktopWorkflowRunStepDispatchResult") &&
    api.includes("dispatchWorkflowRunStep("),
  "desktop API omits workflow run step dispatch contract",
);
assert(
  api.includes("DesktopWorkflowRunStepCompleteRequest") &&
    api.includes("DesktopWorkflowRunStepCompleteResult") &&
    api.includes("completeWorkflowRunStep("),
  "desktop API omits workflow run step completion contract",
);
assert(
  api.includes('"running"') &&
    api.includes("workflowRunId?: string") &&
    api.includes("workflowStepId?: string"),
  "desktop API omits workflow terminal running metadata",
);
assert(
  api.includes("DesktopWorkflowRunResumePlan") &&
    api.includes("DesktopWorkflowRunResumeAction") &&
    api.includes("resumableAfterRestart") &&
    api.includes('"external_runtime"') &&
    api.includes('"reconnect_external"') &&
    api.includes("resumePlan?: DesktopWorkflowRunResumePlan"),
  "desktop API omits workflow restart resume metadata and external runtime action",
);

assert(
  marketplace.includes("WORKFLOW_TEMPLATES"),
  "main marketplace catalog is missing",
);
assert(
  marketplace.includes("plan-review-fix") &&
    marketplace.includes("test-and-commit") &&
    marketplace.includes("memory-to-skill") &&
    marketplace.includes("connector-digest") &&
    marketplace.includes("external-runtime-reconnect"),
  "marketplace catalog omits expected starter templates",
);
assert(
  marketplace.includes("approvalRequired") && marketplace.includes("verification"),
  "marketplace templates do not expose approval and verification commitments",
);
assert(
  marketplace.includes("Workflow approval proposal is required before this recipe can become ready") &&
    marketplace.includes("template.approvalRequired && !proposal") &&
    marketplace.includes("the /commit step owns the write approval"),
  "marketplace does not fail closed on missing template approval or avoid duplicate commit approval",
);
assert(
  marketplace.includes('id: "connector-digest"') &&
    marketplace.includes('status: "available"') &&
    marketplace.includes('id: "review-context"') &&
    marketplace.includes('id: "draft-brief"') &&
    marketplace.includes('id: "verify-brief"') &&
    marketplace.includes("only the reviewed Channel import attachments") &&
    marketplace.includes("do not fetch or send provider data") &&
    !marketplace.includes("Add connector runtime verifier after live OAuth is wired"),
  "connector digest is not an honest executable reviewed-import recipe",
);
assert(
  marketplace.includes("createWorkflowRunRecipe") &&
    marketplace.includes("getWorkflowTemplate") &&
    marketplace.includes('"approval_queued"') &&
    marketplace.includes("/commit <message>") &&
    marketplace.includes("/memory retrospective <lesson>") &&
    !marketplace.includes("/workflow ${template.id}"),
  "marketplace does not build executable workflow run recipes",
);
assert(
  marketplace.includes("availableCount") &&
    marketplace.includes("approvalRequiredCount"),
  "marketplace result omits summary counts",
);
assert(
  marketplace.includes("syncWorkflowMarketplace") &&
    marketplace.includes("workflow-marketplace-imports.json") &&
    marketplace.includes(".drsai") &&
    marketplace.includes("workflow-marketplace.json") &&
    marketplace.includes("workspace-local workflow templates") &&
    marketplace.includes("no network marketplace call was made") &&
    marketplace.includes("realpathSync.native") &&
    marketplace.includes("normalizeSyncedTemplate") &&
    marketplace.includes("MAX_SYNCED_TEMPLATES_PER_WORKSPACE"),
  "marketplace sync does not use bounded reviewed workspace-local template imports",
);
assert(
  marketplace.includes("getWorkflowTemplate(") &&
    marketplace.includes("listSyncedWorkflowTemplates") &&
    marketplace.includes("syncedCount") &&
    marketplace.includes("lastSyncedAt"),
  "marketplace list/prepare path does not include synced templates",
);
const projectSkills = read("src/main/projectSkills.ts");
assert(
  projectSkills.includes("publishProjectSkillDraft") &&
    projectSkills.includes("skill-marketplace-submissions") &&
    projectSkills.includes("submission.json") &&
    projectSkills.includes("SKILL.md") &&
    projectSkills.includes("marketplaceSubmissionPath") &&
    projectSkills.includes("Review submission.json and SKILL.md before uploading"),
  "project skills do not create reviewed local marketplace submission packages",
);
const workflowRuns = read("src/main/workflowRuns.ts");
assert(
  workflowRuns.includes("startWorkflowRun") &&
    workflowRuns.includes("listWorkflowRuns") &&
    workflowRuns.includes('"waiting_approval"') &&
    workflowRuns.includes("chatCommands") &&
    workflowRuns.includes("terminalCommands"),
  "main workflow run engine does not dispatch recipe steps",
);
assert(
  workflowRuns.includes("DRSAI_HOME") &&
    workflowRuns.includes("workflow-runs.json") &&
    workflowRuns.includes("readWorkflowRunStore") &&
    workflowRuns.includes("writeWorkflowRunStore") &&
    workflowRuns.includes("MAX_WORKFLOW_RUNS_PER_WORKSPACE") &&
    workflowRuns.includes("workspaceKey("),
  "main workflow run engine does not persist bounded workspace-scoped runs",
);
assert(
  workflowRuns.includes("dispatchWorkflowRunStep") &&
    workflowRuns.includes("buildWorkflowStepDispatchResult") &&
    workflowRuns.includes("Terminal command is ready") &&
    workflowRuns.includes("Dispatched to the chat bar"),
  "main workflow run engine does not dispatch individual workflow steps",
);
assert(
  workflowRuns.includes("completeWorkflowRunStep") &&
    workflowRuns.includes("Only dispatched terminal/chat steps or explicitly reconnected external runtimes can be completed") &&
    workflowRuns.includes('"External runtime reconnect"') &&
    workflowRuns.includes("Only a running workflow step or waiting external runtime can be completed") &&
    workflowRuns.includes("Workflow run is blocked by a failed or blocked step"),
  "main workflow run engine does not record truthful terminal/chat/external step completion",
);
assert(
  workflowRuns.includes("markWorkflowRunTerminalStepRunning") &&
    workflowRuns.includes('"running"') &&
    workflowRuns.includes("Terminal command is running after shell approval"),
  "main workflow run engine does not mark terminal steps running after approval",
);
assert(
  workflowRuns.includes("recoverWorkflowRunsAfterRestart") &&
    workflowRuns.includes("buildRestartResumePlan") &&
    workflowRuns.includes("resumableAfterRestart") &&
    workflowRuns.includes("resumeAction: \"dispatch_chat\"") &&
    workflowRuns.includes("resumeAction: \"prepare_terminal\"") &&
    workflowRuns.includes("resumeAction: \"reconnect_external\"") &&
    workflowRuns.includes("resumeAction: \"confirm_manual\"") &&
    workflowRuns.includes("Recovered after app restart"),
  "main workflow run engine does not recover restart-resumable steps and external runtimes",
);
assert(
  workflowRuns.includes('"external_runtime"') &&
    workflowRuns.includes("provider-specific reconnect or restart") &&
    workflowRuns.includes("no process was started automatically"),
  "main workflow run engine does not keep external runtime reconnect explicit",
);

assert(main.includes('from "./workflowMarketplace"'), "main process does not import marketplace");
assert(main.includes('from "./workflowRuns"'), "main process does not import workflow run engine");
assert(
  main.includes('secureHandle("desktop:workflow-marketplace-list"'),
  "main process does not expose marketplace IPC",
);
assert(
  main.includes("publishProjectSkillDraft") &&
    main.includes('secureHandle("desktop:project-skill-draft-publish"') &&
    main.includes("syncWorkflowMarketplace") &&
    main.includes('secureHandle("desktop:workflow-marketplace-sync"') &&
    main.includes("await getWorkflowTemplate"),
  "main process does not expose skill submission or marketplace sync IPC",
);
assert(
  main.includes('secureHandle("desktop:workflow-run-prepare"') &&
    main.includes("prepareWorkflowRun") &&
    main.includes('source: "workflow"') &&
    main.includes('actionKind: "workflow.run"'),
  "main process does not expose approval-gated workflow run preparation",
);
assert(
  main.includes('secureHandle("desktop:workflow-run-start"') &&
    main.includes('secureHandle("desktop:workflow-runs-list"'),
  "main process does not expose workflow run engine IPC",
);
assert(
  main.includes('secureHandle("desktop:workflow-run-step-dispatch"') &&
    main.includes("dispatchWorkflowRunStep"),
  "main process does not expose workflow step dispatch IPC",
);
assert(
  main.includes('secureHandle("desktop:workflow-run-step-complete"') &&
    main.includes("completeWorkflowRunStep"),
  "main process does not expose workflow step completion IPC",
);
assert(
  main.includes("markWorkflowRunTerminalStepRunning") &&
    main.includes("workflowRunId") &&
    main.includes("workflowStepId") &&
    main.includes("markShellWorkflowStepRunning"),
  "main process does not connect shell approval to workflow running state",
);
assert(
  main.includes("recoverWorkflowRunsAfterRestart") &&
    main.includes("recoverWorkflowRunStateAfterRestart") &&
    main.includes("Recovered ${result.recovered} workflow run(s) after restart") &&
    main.includes("upsertBackgroundTaskForWorkflowRun(run)"),
  "main process does not recover persisted workflow runs on app restart",
);
assert(
  preload.includes("DesktopWorkflowMarketplaceListResult"),
  "preload omits marketplace result type",
);
assert(
  preload.includes("desktop:workflow-marketplace-list"),
  "preload omits marketplace IPC",
);
assert(
  preload.includes("DesktopWorkflowMarketplaceSyncRequest") &&
    preload.includes("DesktopWorkflowMarketplaceSyncResult") &&
    preload.includes("desktop:workflow-marketplace-sync") &&
    preload.includes("DesktopProjectSkillPublishRequest") &&
    preload.includes("DesktopProjectSkillPublishResult") &&
    preload.includes("desktop:project-skill-draft-publish"),
  "preload omits marketplace sync or skill submission IPC",
);
assert(
  preload.includes("DesktopWorkflowRunPrepareRequest") &&
    preload.includes("DesktopWorkflowRunPrepareResult") &&
    preload.includes("desktop:workflow-run-prepare"),
  "preload omits workflow run preparation IPC",
);
assert(
  preload.includes("DesktopWorkflowRunStartRequest") &&
    preload.includes("DesktopWorkflowRunStartResult") &&
    preload.includes("desktop:workflow-run-start") &&
    preload.includes("desktop:workflow-runs-list"),
  "preload omits workflow run engine IPC",
);
assert(
  preload.includes("DesktopWorkflowRunStepDispatchRequest") &&
    preload.includes("DesktopWorkflowRunStepDispatchResult") &&
    preload.includes("desktop:workflow-run-step-dispatch"),
  "preload omits workflow step dispatch IPC",
);
assert(
  preload.includes("DesktopWorkflowRunStepCompleteRequest") &&
    preload.includes("DesktopWorkflowRunStepCompleteResult") &&
    preload.includes("desktop:workflow-run-step-complete"),
  "preload omits workflow step completion IPC",
);

assert(
  skillSquare.includes("desktopApi.listWorkflowMarketplace"),
  "Skills view does not load marketplace through desktop API",
);
assert(
  skillSquare.includes("desktopApi.syncWorkflowMarketplace") &&
    skillSquare.includes("Sync local") &&
    skillSquare.includes("No network marketplace call is made") &&
    skillSquare.includes("workflow-marketplace-actions"),
  "Skills view does not expose reviewed local marketplace sync",
);
assert(
  skillSquare.includes("desktopApi.publishProjectSkillDraft") &&
    skillSquare.includes("Prepare submission") &&
    skillSquare.includes("marketplaceSubmissionPath") &&
    skillSquare.includes("marketplace_submission"),
  "Skills view does not expose reviewed skill marketplace submission packages",
);
assert(
  skillSquare.includes("WorkflowTemplateCard"),
  "Skills view does not render workflow template cards",
);
assert(
  skillSquare.includes("desktopApi.prepareWorkflowRun") &&
    skillSquare.includes("Prepare run") &&
    skillSquare.includes("workflow-run-recipe"),
  "Skills view does not prepare workflow run recipes",
);
assert(
  skillSquare.includes("desktopApi.startWorkflowRun") &&
    skillSquare.includes("desktopApi.listWorkflowRuns") &&
    skillSquare.includes("desktopApi.dispatchWorkflowRunStep") &&
    skillSquare.includes("drsai:workflow-run-updated") &&
    skillSquare.includes("drsai:workflow-chat-command") &&
    skillSquare.includes("drsai:workflow-terminal-command") &&
    skillSquare.includes("workflow-step-dispatch") &&
    skillSquare.includes("refreshWorkflowRuns") &&
    skillSquare.includes("Start run") &&
    skillSquare.includes("WorkflowRunExecution") &&
    skillSquare.includes("workflow-run-execution"),
  "Skills view does not start or render workflow runs",
);
assert(
  skillSquare.includes("workflow-resume-plan") &&
    skillSquare.includes("Workflow restart resume plan") &&
    skillSquare.includes("step.resumeMessage") &&
    skillSquare.includes("Resume chat") &&
    skillSquare.includes("Resume terminal") &&
    skillSquare.includes("Reconnect runtime") &&
    skillSquare.includes("Resume checkpoint"),
  "Skills view does not render workflow restart resume state and external reconnect actions",
);
assert(
  skillSquare.includes("Confirm chat complete") &&
    skillSquare.includes("Confirm runtime reconnected") &&
    skillSquare.includes("isCompletableWorkflowStep") &&
    skillSquare.includes("completeWorkflowRunStep"),
  "Skills view cannot explicitly complete chat or reconnected external runtime steps",
);
const terminalPanel = read("../shared/renderer/src/components/TerminalPanel.tsx");
assert(
  terminalPanel.includes("completeWorkflowRunStep") &&
    terminalPanel.includes("drsai:workflow-run-updated") &&
    terminalPanel.includes("workflowRunId") &&
    terminalPanel.includes("workflowStepId") &&
    terminalPanel.includes("__DRSAI_AGENT_COMMAND_DONE"),
  "terminal panel does not complete workflow terminal steps after command exit",
);
assert(
  terminalPanel.includes("requestShellCommandApproval") &&
    terminalPanel.includes("workflowRunId: proposal.workflowRunId") &&
    terminalPanel.includes("workflowStepId: proposal.workflowStepId"),
  "terminal panel does not pass workflow metadata into shell approval",
);
const approvalCenter = read("../shared/renderer/src/components/ApprovalCenterView.tsx");
assert(
  approvalCenter.includes("broadcastLatestWorkflowRunUpdate") &&
    approvalCenter.includes("desktopApi.listWorkflowRuns") &&
    approvalCenter.includes("drsai:workflow-run-updated") &&
    approvalCenter.includes('step.status === "running"'),
  "approval center does not refresh workflow running state after shell approval",
);
const chatWorkspace = read("../shared/renderer/src/components/ChatWorkspace.tsx");
const app = read("../shared/renderer/src/App.tsx");
assert(
  chatWorkspace.includes("drsai:workflow-chat-command") &&
    chatWorkspace.includes("onInputChange(command.trim())"),
  "chat workspace does not receive workflow chat command dispatch events",
);
assert(
  app.includes("drsai:workflow-terminal-command") &&
    app.includes("proposeTerminalCommand") &&
    app.includes("workflowRunId") &&
    app.includes("workflowStepId") &&
    app.includes('setActiveRightTab("terminal")') &&
    app.includes("setRightPanelCollapsed(false)") &&
    app.includes("setTerminalCommandProposal(null)") &&
    app.includes("window.setTimeout"),
  "app shell does not route workflow terminal commands into the terminal approval path",
);
assert(
  skillSquare.includes('aria-label="Workflow marketplace"'),
  "Workflow marketplace section is not labelled",
);
assert(
  skillSquare.includes("template.verification"),
  "Workflow card omits verification commitment",
);
assert(
  skillSquare.includes("template.approvalRequired"),
  "Workflow card omits approval requirement",
);

assert(mock.includes("mockWorkflowMarketplace"), "mock bridge omits marketplace data");
assert(mock.includes("listWorkflowMarketplace"), "mock bridge omits listWorkflowMarketplace");
assert(
  mock.includes("mockSyncedWorkflowTemplates") &&
    mock.includes("syncWorkflowMarketplace") &&
    mock.includes("synced-workspace-status-digest") &&
    mock.includes("no network marketplace call was made") &&
    mock.includes("publishProjectSkillDraft") &&
    mock.includes("skill-marketplace-submissions"),
  "mock bridge omits local marketplace sync or skill submission behavior",
);
assert(
  mock.includes("prepareWorkflowRun") &&
    mock.includes('source: "workflow"') &&
    mock.includes('actionKind: "workflow.run"'),
  "mock bridge omits workflow run preparation",
);
assert(
  mock.includes("startWorkflowRun") &&
    mock.includes("listWorkflowRuns") &&
    mock.includes("workflowRuns"),
  "mock bridge omits workflow run execution",
);
assert(
  mock.includes("dispatchWorkflowRunStep") &&
    mock.includes("Mock chat command prepared; confirm this step only after the chat action finishes") &&
    mock.includes("Mock terminal command dispatched; waiting for its exit result"),
  "mock bridge omits workflow step dispatch",
);
assert(
  mock.includes("completeWorkflowRunStep") &&
    mock.includes('step.kind === "external_runtime" && step.status === "waiting_approval"') &&
    mock.includes("Mock ${label} completed") &&
    mock.includes("Mock workflow run is blocked by a failed terminal command"),
  "mock bridge omits truthful workflow terminal/chat/external step completion",
);
assert(
  mock.includes("pendingShellWorkflowApprovals") &&
    mock.includes("markMockWorkflowTerminalStepRunning") &&
    mock.includes("Mock terminal command is running after shell approval"),
  "mock bridge omits workflow terminal running state after approval",
);
assert(
    mock.includes("applyMockRestartResumePlan") &&
    mock.includes("resumeAction: \"dispatch_chat\"") &&
    mock.includes("resumeAction: \"prepare_terminal\"") &&
    mock.includes("resumeAction: \"reconnect_external\"") &&
    mock.includes("Mock recovered after app restart"),
  "mock bridge omits workflow restart recovery state and external runtime reconnect",
);
assert(
  mock.includes("external-runtime-reconnect") &&
    mock.includes('"external_runtime"') &&
    mock.includes("no process was started automatically"),
  "mock bridge omits external runtime reconnect workflow behavior",
);

assert(styles.includes(".workflow-marketplace"), "workflow marketplace styles are missing");
assert(
  styles.includes(".workflow-marketplace-actions") &&
    styles.includes(".project-skill-draft-card.published"),
  "workflow marketplace sync or skill submission styles are missing",
);
assert(styles.includes(".workflow-template-card"), "workflow template card styles are missing");
assert(styles.includes(".workflow-template-meta"), "workflow metadata styles are missing");
assert(styles.includes(".workflow-run-recipe"), "workflow run recipe styles are missing");
assert(styles.includes(".workflow-run-execution"), "workflow run execution styles are missing");
assert(styles.includes(".workflow-resume-plan"), "workflow resume plan styles are missing");
assert(
  styles.includes(".workflow-template-prepare"),
  "workflow prepare button styles are missing",
);
assert(
  styles.includes(".workflow-step-dispatch"),
  "workflow step dispatch styles are missing",
);

assert(
    roadmap.includes("workflow marketplace") &&
    roadmap.includes("approval-gated workflow") &&
    roadmap.includes("shell approval-to-running status feedback") &&
    roadmap.includes("external runtime reconnect") &&
    roadmap.includes("local marketplace sync") &&
    roadmap.includes("marketplace submission") &&
    roadmap.includes("npm run verify:workflow-marketplace"),
  "roadmap does not record workflow marketplace verification",
);

console.log("Workflow marketplace verification passed.");
