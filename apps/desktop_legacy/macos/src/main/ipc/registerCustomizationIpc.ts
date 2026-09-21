import { createHash } from "node:crypto";
import type { IpcMain } from "electron";
import { deleteCustomCommand, listCustomCommands, upsertCustomCommand } from "../../../../shared/main/customCommands";
import { addProjectMemory, clearProjectMemory, listProjectMemory, updateProjectMemory } from "../../../../shared/main/projectMemory";
import { createProjectSkillDraft, installProjectSkillDraft, listProjectSkillDrafts, publishProjectSkillDraft } from "../../../../shared/main/projectSkills";
import { addTeamMemory, deleteTeamMemory, listTeamMemory } from "../../../../shared/main/teamMemory";
import { deleteUserPreference, listUserPreferences, upsertUserPreference } from "../../../../shared/main/userPreferences";
import type { MacosServiceContainer } from "../serviceContainer";

export type MacosCustomizationIpcServices = Pick<MacosServiceContainer, "workspace" | "approvals">;

/** Registers preferences, commands, memory and project-skill IPC with explicit platform services. */
export function registerMacosCustomizationIpc(
  ipcMain: Pick<IpcMain, "handle">,
  services: MacosCustomizationIpcServices,
): void {
  const requireWorkspace = async (request: { workspacePath?: unknown } | undefined) =>
    services.workspace.assertPath(request?.workspacePath);

  ipcMain.handle("desktop:user-preferences-list", () => listUserPreferences());
  ipcMain.handle("desktop:user-preference-upsert", (_event, request) => upsertUserPreference(request));
  ipcMain.handle("desktop:user-preference-delete", (_event, request) => deleteUserPreference(request));
  ipcMain.handle("desktop:custom-commands-list", async (_event, request) => { await requireWorkspace(request); return listCustomCommands(request); });
  ipcMain.handle("desktop:custom-command-upsert", async (_event, request) => { await requireWorkspace(request); return upsertCustomCommand(request); });
  ipcMain.handle("desktop:custom-command-delete", async (_event, request) => { await requireWorkspace(request); return deleteCustomCommand(request); });
  ipcMain.handle("desktop:project-memory-list", async (_event, request) => { await requireWorkspace(request); return listProjectMemory(request); });
  ipcMain.handle("desktop:project-memory-add", async (_event, request) => { await requireWorkspace(request); return addProjectMemory(request); });
  ipcMain.handle("desktop:project-memory-update", async (_event, request) => { await requireWorkspace(request); return updateProjectMemory(request); });
  ipcMain.handle("desktop:project-memory-clear", async (_event, request) => { await requireWorkspace(request); return clearProjectMemory(request); });
  ipcMain.handle("desktop:team-memory-list", (_event, request) => listTeamMemory(request));
  ipcMain.handle("desktop:team-memory-add", (_event, request) => addTeamMemory(request));
  ipcMain.handle("desktop:team-memory-delete", (_event, request) => deleteTeamMemory(request));
  ipcMain.handle("desktop:project-skill-drafts-list", async (_event, request) => { await requireWorkspace(request); return listProjectSkillDrafts(request); });
  ipcMain.handle("desktop:project-skill-draft-create", async (_event, request) => { await requireWorkspace(request); return createProjectSkillDraft(request); });
  ipcMain.handle("desktop:project-skill-draft-install", async (_event, request) => {
    const workspacePath = await requireWorkspace(request);
    const stable = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const proposal = await services.approvals.propose({ source: "workflow", actionKind: "workflow.run", title: "Install project skill", detail: `Install reviewed project skill draft ${request?.draftId}.`, target: workspacePath, risk: "high", idempotencyKey: `skill-install:${stable}` }, async () => { await installProjectSkillDraft(request); return true; });
    if (proposal.blocked || !proposal.allowed) throw new Error(proposal.reason);
    if (proposal.queued && proposal.approval) return { workspacePath, draftId: request?.draftId, title: "Pending approval", slug: "pending", target: "desktop_local", installedAt: "", installPath: "", alreadyInstalled: false, approvalId: proposal.approval.id, approvalQueued: true };
    return installProjectSkillDraft(request);
  });
  ipcMain.handle("desktop:project-skill-draft-publish", async (_event, request) => {
    const workspacePath = await requireWorkspace(request);
    const stable = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const proposal = await services.approvals.propose({ source: "workflow", actionKind: "workflow.run", title: "Prepare project skill publication", detail: `Create a reviewed marketplace submission for skill draft ${request?.draftId}. No network upload is performed.`, target: workspacePath, risk: "high", idempotencyKey: `skill-publish:${stable}` }, async () => { await publishProjectSkillDraft(request); return true; });
    if (proposal.blocked || !proposal.allowed) throw new Error(proposal.reason);
    if (proposal.queued && proposal.approval) return { workspacePath, draftId: request?.draftId, title: "Pending approval", slug: "pending", target: "marketplace_submission", publishedAt: "", submissionPath: "", alreadyPublished: false, verification: "Waiting for Approval Center review.", approvalId: proposal.approval.id, approvalQueued: true };
    return publishProjectSkillDraft(request);
  });
}
