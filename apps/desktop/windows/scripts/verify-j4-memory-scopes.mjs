import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const resultPath = join(root, "release", "product-evidence", "j4-memory-scopes", "packaged-j4-memory-scopes-result.json");
assert(existsSync(resultPath), "Run verify:packaged-j4-memory-scopes before the independent verifier");
const result = JSON.parse(readFileSync(resultPath, "utf8"));
const evaluation = evaluate(result);
assert(result.ok === true && evaluation.ok, `J4 independent evaluation failed: ${JSON.stringify(evaluation.metrics)}`);

const negative = {
  missingPersonalRejected: !evaluate(mutate(result, "personalScopeVisible", false)).ok,
  leakedProjectRejected: !evaluate(mutate(result, "projectBIsolatedAtRest", false)).ok,
  missingAuthorizedTeamRejected: !evaluate(mutate(result, "authorizedTeamReadable", false)).ok,
  unauthorizedReadRejected: !evaluate(mutate(result, "unauthorizedTeamReadRejected", false)).ok,
  unauthorizedWriteRejected: !evaluate(mutate(result, "unauthorizedTeamWriteRejected", false)).ok,
  missingProjectAChatRejected: !evaluate(mutate(result, "projectATaskCompleted", false)).ok,
  missingProjectBChatRejected: !evaluate(mutate(result, "projectBTaskCompleted", false)).ok,
  changedCernPdfRejected: !evaluate({ ...result, details: { ...result.details, pdfHash: "sha256:changed" } }).ok,
};
assert(Object.values(negative).every(Boolean), `J4 negative mutations were not rejected: ${JSON.stringify(negative)}`);

const shared = read("src/shared/desktopApi.ts");
const service = read("src/main/teamMemory.ts");
const main = read("src/main/index.ts");
const preload = read("src/preload/index.ts");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const adapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
const view = read("src/renderer/src/components/AgentSquareView.tsx");
const smoke = read("src/main/e2eSmoke.ts");
const runner = read("scripts/verify-e2e-chat.mjs");
const packageJson = read("package.json");
const contracts = {
  typedTeamEntries: shared.includes("DesktopTeamMemoryEntry") && shared.includes("DesktopTeamMemoryDeleteResult"),
  typedTeamApi: shared.includes("listTeamMemory") && shared.includes("addTeamMemory") && shared.includes("deleteTeamMemory"),
  secureTeamListIpc: main.includes('secureHandle("desktop:team-memory-list"') && preload.includes('"desktop:team-memory-list"'),
  secureTeamWriteIpc: main.includes('secureHandle("desktop:team-memory-add"') && main.includes('secureHandle("desktop:team-memory-delete"'),
  authorizationFromSession: service.includes("requireAuthContext") && service.includes("session.user?.groups"),
  unauthorizedAccessRejected: service.includes("not authorized to access this team's memory"),
  atomicTeamPersistence: service.includes("temporaryPath") && service.includes("rename(temporaryPath, TEAM_MEMORY_FILE)"),
  boundedTeamStorage: service.includes("MAX_ENTRIES_PER_TEAM") && service.includes("MAX_CONTENT_CHARS"),
  invalidClaimsIgnored: service.includes("Ignore unrelated malformed identity claims"),
  preloadParity: preload.includes("listTeamMemory") && preload.includes("addTeamMemory") && preload.includes("deleteTeamMemory"),
  mockParity: mock.includes("listTeamMemory: async") && mock.includes("addTeamMemory: async") && mock.includes("deleteTeamMemory: async"),
  teamContextInjection: adapter.includes("Authorized team memory for the signed-in user") && adapter.includes("teamMemoryRef.current"),
  structuredScopeMetadata: adapter.includes("project_memory:") && adapter.includes("team_memory:"),
  threeScopeUi: view.includes('data-testid="user-memory-manager"') && view.includes('data-testid="project-memory-scope"') && view.includes('data-testid="team-memory-scope"'),
  restrictedTeamSelector: view.includes('data-testid="team-memory-team"') && view.includes("userGroups.map"),
  projectManagementUi: view.includes('data-testid="project-memory-add"') && view.includes("clearProjectMemory"),
  teamManagementUi: view.includes('data-testid="team-memory-add"') && view.includes("deleteTeamMemory"),
  realPackagedCoverage: smoke.includes("runMemoryScopeSmoke") && runner.includes("J4 PROJECT A") && runner.includes("J4 PROJECT B"),
  realCernFixture: runner.includes("F6581E1A255B354667188B41B874B996A300F88BB48912721BC1C854183E913E"),
  commandsRegistered: packageJson.includes('"verify:packaged-j4-memory-scopes"') && packageJson.includes('"verify:j4-memory-scopes"'),
};
assert(Object.values(contracts).every(Boolean), `J4 contracts failed: ${JSON.stringify(contracts)}`);

console.log(JSON.stringify({ ok: true, golden: evaluation, negative, contracts, contractCount: Object.keys(contracts).length }, null, 2));

function evaluate(input) {
  const checks = input?.checks ?? {};
  const details = input?.details ?? {};
  const metrics = {
    visibleScopeManagement: checks.scopeManagerVisible && checks.personalScopeVisible && checks.projectScopeVisible && checks.teamScopeVisible ? 1 : 0,
    personalCrossProject: checks.projectATaskCompleted && checks.projectBTaskCompleted && details.personalPreferences?.some((item) => item.category === "output_language" && item.value === "zh") ? 1 : 0,
    projectIsolation: checks.projectAStored && checks.projectBIsolatedAtRest && details.projectAMemory?.some((item) => item.content?.includes("WLCG-CAPACITY")) && !details.projectBMemory?.some((item) => item.content?.includes("WLCG-CAPACITY")) ? 1 : 0,
    authorizedTeamUse: checks.authorizedIdentityLoaded && checks.authorizedTeamReadable && details.authorizedTeamMemory?.some((item) => item.teamId === "cern-research") ? 1 : 0,
    unauthorizedTeamProtection: checks.unauthorizedTeamReadRejected && checks.unauthorizedTeamWriteRejected && checks.teamSelectorRestricted ? 1 : 0,
    twoProjectExecution: checks.workspaceASelected && checks.projectANewChat && checks.projectATaskCompleted && checks.workspaceBSelected && checks.projectBNewChat && checks.projectBTaskCompleted ? 1 : 0,
    cernSourceProtection: checks.cernPdfAvailable && checks.cernPdfUnchanged && details.pdfHash === "sha256:f6581e1a255b354667188b41b874b996a300f88bb48912721bc1c854183e913e" ? 1 : 0,
  };
  return { ok: Object.values(metrics).every((value) => value === 1), metrics };
}

function mutate(input, name, value) {
  return { ...input, checks: { ...input.checks, [name]: value } };
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
