import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`Project memory verification failed: ${message}`);
    process.exit(1);
  }
}

const packageJson = read("package.json");
const api = read("src/shared/desktopApi.ts");
const preload = read("src/preload/index.ts");
const main = read("src/main/index.ts");
const store = read("src/main/projectMemory.ts");
const skillDraftStore = read("src/main/projectSkills.ts");
const commands = read("src/renderer/src/chatCommands.ts");
const adapter = read("src/renderer/src/adapters/useDesktopChatAdapter.ts");
const app = read("src/renderer/src/App.tsx");
const skillSquare = read("src/renderer/src/components/SkillSquareView.tsx");
const styles = read("src/renderer/src/styles.css");
const mock = read("src/renderer/src/mockDesktopApi.ts");
const roadmap = read("docs/smart-chat-bar-roadmap.md");

assert(packageJson.includes('"verify:project-memory": "node scripts/verify-project-memory.mjs"'), "package script is not registered");

assert(api.includes("DesktopProjectMemoryEntry"), "shared API omits project memory entry type");
assert(api.includes("DesktopProjectMemoryAddRequest"), "shared API omits add request type");
assert(api.includes("DesktopProjectMemoryUpdateRequest"), "shared API omits update request type");
assert(api.includes("DesktopProjectMemoryClearResult"), "shared API omits clear result type");
assert(api.includes("DesktopProjectSkillDraft"), "shared API omits skill draft type");
assert(api.includes("DesktopProjectSkillDraftCreateRequest"), "shared API omits skill draft create request");
assert(api.includes("DesktopProjectSkillInstallRequest"), "shared API omits skill install request");
assert(api.includes("DesktopProjectSkillInstallResult"), "shared API omits skill install result");
assert(api.includes("listProjectMemory("), "desktop API omits listProjectMemory");
assert(api.includes("addProjectMemory("), "desktop API omits addProjectMemory");
assert(api.includes("updateProjectMemory("), "desktop API omits updateProjectMemory");
assert(api.includes("clearProjectMemory("), "desktop API omits clearProjectMemory");
assert(api.includes("listProjectSkillDrafts("), "desktop API omits listProjectSkillDrafts");
assert(api.includes("createProjectSkillDraft("), "desktop API omits createProjectSkillDraft");
assert(api.includes("installProjectSkillDraft("), "desktop API omits installProjectSkillDraft");

assert(preload.includes("desktop:project-memory-list"), "preload omits project memory list IPC");
assert(preload.includes("desktop:project-memory-add"), "preload omits project memory add IPC");
assert(preload.includes("desktop:project-memory-update"), "preload omits project memory update IPC");
assert(preload.includes("desktop:project-memory-clear"), "preload omits project memory clear IPC");
assert(preload.includes("desktop:project-skill-drafts-list"), "preload omits skill draft list IPC");
assert(preload.includes("desktop:project-skill-draft-create"), "preload omits skill draft create IPC");
assert(preload.includes("desktop:project-skill-draft-install"), "preload omits skill draft install IPC");
assert(main.includes('from "./projectMemory"'), "main process does not import project memory store");
assert(main.includes('from "./projectSkills"'), "main process does not import project skill draft store");
assert(main.includes('secureHandle("desktop:project-memory-list"'), "main process does not register list IPC");
assert(main.includes('secureHandle("desktop:project-memory-add"'), "main process does not register add IPC");
assert(main.includes('secureHandle("desktop:project-memory-update"'), "main process does not register update IPC");
assert(main.includes('secureHandle("desktop:project-memory-clear"'), "main process does not register clear IPC");
assert(main.includes('secureHandle("desktop:project-skill-drafts-list"'), "main process does not register skill draft list IPC");
assert(main.includes('secureHandle("desktop:project-skill-draft-create"'), "main process does not register skill draft create IPC");
assert(main.includes('secureHandle("desktop:project-skill-draft-install"'), "main process does not register skill draft install IPC");

assert(store.includes('join(DRSAI_HOME, "desktop", "project-memory.json")'), "project memory is not persisted under DRSAI_HOME desktop data");
assert(store.includes("MAX_MEMORY_ENTRIES_PER_WORKSPACE"), "project memory does not cap entries");
assert(store.includes("MAX_MEMORY_CONTENT_CHARS"), "project memory does not cap content");
assert(store.includes("workspaceKey(workspacePath"), "project memory does not partition by workspace");
assert(store.includes("createHash(\"sha256\")"), "project memory workspace key is not stable");
assert(store.includes("sanitizeWorkspacePath"), "project memory request validation is missing");
assert(store.includes("sanitizeMemoryContent"), "project memory content validation is missing");
assert(store.includes("updateProjectMemory"), "project memory store omits entry updates");
assert(store.includes("validateUpdateRequest"), "project memory update validation is missing");
assert(store.includes("requireMemoryId"), "project memory update does not require entry ids");

assert(skillDraftStore.includes("PROJECT_SKILL_DRAFTS_FILE"), "skill drafts are not indexed under DRSAI_HOME desktop data");
assert(skillDraftStore.includes("PROJECT_SKILL_DRAFTS_DIR"), "skill draft files are not written under DRSAI_HOME desktop data");
assert(skillDraftStore.includes("createProjectSkillDraft"), "skill draft store omits createProjectSkillDraft");
assert(skillDraftStore.includes("listProjectSkillDrafts"), "skill draft store omits listProjectSkillDrafts");
assert(skillDraftStore.includes("SKILL.md"), "skill draft store does not create SKILL.md files");
assert(skillDraftStore.includes("renderSkillMarkdown"), "skill draft store does not render skill markdown");
assert(skillDraftStore.includes("workspaceKey(workspacePath"), "skill drafts are not partitioned by workspace");
assert(skillDraftStore.includes("MAX_SKILL_DRAFTS_PER_WORKSPACE"), "skill drafts are not capped per workspace");
assert(skillDraftStore.includes("PROJECT_SKILLS_INSTALL_DIR"), "skill draft install directory is missing");
assert(skillDraftStore.includes("installProjectSkillDraft"), "skill draft store omits installProjectSkillDraft");
assert(skillDraftStore.includes("validateInstallRequest"), "skill draft install validation is missing");
assert(skillDraftStore.includes('target: "desktop_local"'), "skill draft install does not pin the local target");
assert(skillDraftStore.includes("installedAt"), "skill draft install does not record installedAt");
assert(skillDraftStore.includes("installPath"), "skill draft install does not record installPath");

assert(commands.includes("describeMemoryCommand"), "/memory command-specific feedback is missing");
assert(commands.includes("/memory add <note>"), "/memory add help copy is missing");
assert(commands.includes("/memory retrospective <note>"), "/memory retrospective help copy is missing");
assert(commands.includes("/memory edit <index|id> <note>"), "/memory edit help copy is missing");
assert(commands.includes("/memory delete <index|id>"), "/memory delete help copy is missing");
assert(commands.includes("/memory clear"), "/memory clear help copy is missing");
assert(commands.includes("context.projectMemory"), "/memory does not read current project memory");

assert(adapter.includes("DesktopProjectMemoryEntry"), "chat adapter does not type project memory");
assert(adapter.includes("projectMemoryRef"), "chat adapter does not keep project memory available for submit");
assert(adapter.includes("desktopApi.listProjectMemory"), "chat adapter does not load project memory");
assert(adapter.includes("maybeApplyMemoryCommand"), "chat adapter does not handle /memory writes");
assert(adapter.includes("desktopApi.addProjectMemory"), "chat adapter does not save /memory add");
assert(adapter.includes("desktopApi.updateProjectMemory"), "chat adapter does not save /memory edit");
assert(adapter.includes("desktopApi.clearProjectMemory"), "chat adapter does not clear /memory clear");
assert(adapter.includes("resolveProjectMemoryEntry"), "chat adapter cannot target memory entries by index or id");
assert(adapter.includes('source: "retrospective"'), "chat adapter does not capture retrospective memory");
assert(adapter.includes("compact-summary:"), "/compact save does not capture reviewed compact summaries as project memory");
assert(adapter.includes("Saved compact summary to project memory"), "/compact save project memory feedback is missing");
assert(adapter.includes("Project memory for this workspace:"), "chat adapter does not inject project memory into model context");

assert(
  app.includes("workspacePath={effectiveWorkspacePath}") &&
    app.includes("const effectiveWorkspacePath"),
  "Skills Square is not scoped to the effective active workspace path",
);
assert(skillSquare.includes("DesktopProjectMemoryEntry"), "Skills Square does not type project memory entries");
assert(skillSquare.includes("desktopApi.listProjectMemory"), "Skills Square does not load project memory");
assert(skillSquare.includes("desktopApi.addProjectMemory"), "Skills Square does not add project memory");
assert(skillSquare.includes("desktopApi.updateProjectMemory"), "Skills Square does not edit project memory");
assert(skillSquare.includes("desktopApi.clearProjectMemory"), "Skills Square does not delete project memory");
assert(skillSquare.includes("Skill promotion candidate:"), "Skills Square omits the promotion candidate path");
assert(skillSquare.includes("desktopApi.listProjectSkillDrafts"), "Skills Square does not list generated skill drafts");
assert(skillSquare.includes("desktopApi.createProjectSkillDraft"), "Skills Square does not create skill drafts from memory");
assert(skillSquare.includes("desktopApi.installProjectSkillDraft"), "Skills Square does not install reviewed skill drafts");
assert(skillSquare.includes("Install locally"), "Skills Square omits local skill install action");
assert(skillSquare.includes("buildWorkflowPostmortemDraft"), "Skills Square does not build automatic workflow retrospective drafts");
assert(skillSquare.includes("Workflow retrospective candidate:"), "workflow retrospective draft copy is missing");
assert(skillSquare.includes("saveWorkflowPostmortem"), "Skills Square does not save workflow retrospectives");
assert(skillSquare.includes("source: \"retrospective\""), "workflow postmortem prompt does not save retrospective memory");
assert(skillSquare.includes('aria-label="Workflow retrospective prompt"'), "workflow retrospective prompt is not labelled");
assert(skillSquare.includes('aria-label="Generated skill drafts"'), "Skills Square skill draft list is not labelled");
assert(skillSquare.includes('aria-label="Project memory review"'), "Skills Square memory review list is not labelled");
assert(styles.includes(".project-memory-review"), "project memory review styles are missing");
assert(styles.includes(".project-memory-card-actions"), "project memory action styles are missing");
assert(styles.includes(".project-skill-drafts"), "project skill draft styles are missing");
assert(styles.includes(".project-skill-draft-actions"), "project skill draft install action styles are missing");
assert(styles.includes(".project-skill-draft-card.installed"), "project skill draft installed state styles are missing");
assert(styles.includes(".workflow-postmortem-prompt"), "workflow retrospective prompt styles are missing");
assert(styles.includes(".workflow-postmortem-actions"), "workflow retrospective action styles are missing");

assert(mock.includes("projectMemory"), "mock desktop API does not keep project memory");
assert(mock.includes("listProjectMemory"), "mock desktop API omits listProjectMemory");
assert(mock.includes("addProjectMemory"), "mock desktop API omits addProjectMemory");
assert(mock.includes("updateProjectMemory"), "mock desktop API omits updateProjectMemory");
assert(mock.includes("clearProjectMemory"), "mock desktop API omits clearProjectMemory");
assert(mock.includes("projectSkillDrafts"), "mock desktop API does not keep skill drafts");
assert(mock.includes("listProjectSkillDrafts"), "mock desktop API omits listProjectSkillDrafts");
assert(mock.includes("createProjectSkillDraft"), "mock desktop API omits createProjectSkillDraft");
assert(mock.includes("installProjectSkillDraft"), "mock desktop API omits installProjectSkillDraft");
assert(mock.includes("installed-skills"), "mock desktop API omits installed skill path");

assert(roadmap.includes("project memory"), "roadmap does not mention project memory progress");
assert(roadmap.includes("skill draft"), "roadmap does not mention generated skill draft progress");
assert(roadmap.includes("reviewed local draft install"), "roadmap does not mention reviewed skill install progress");
assert(roadmap.includes("automatic workflow retrospective prompt"), "roadmap does not mention workflow retrospective prompts");

console.log("Project memory verification passed.");
