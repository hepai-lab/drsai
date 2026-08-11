// Barrel file — re-exports all API modules for backward compatibility.
// Prefer importing from the individual sub-modules for better tree-shaking.
// e.g. import { sessionAPI } from "./session";

export { SessionAPI, sessionAPI } from "./session";
export { TeamAPI, teamAPI } from "./team";
export { PlanAPI, planAPI } from "./plan";
export { SettingsAPI, settingsAPI } from "./settings";
export { Agent, agentAPI } from "./agent";
export { AgentWorkerAPI, agentWorkerAPI } from "./agentWorker";
export { FileAPI, fileAPI } from "./file";
export { AuthAPI, authAPI } from "./auth";
export { AdminAnalyticsAPI, adminAnalyticsAPI } from "./adminAnalytics";
export { UserAPI, userAPI } from "./user";
export type { ManagedUser, UserAccess, AdminUsageOverviewData } from "./user";
export { SkillsAPI, skillsAPI } from "./skills";
export type {
  SkillsCatalogItem,
  SkillsPublicItem,
  SkillsPublicDetail,
  SkillsUserItem,
  SkillsUserDetail,
  SkillsCatalogDetail,
  SkillsCatalogUploadResult,
} from "./skills";
export { DocMasterAPI, docmasterAPI } from "./docmaster";
export type { DocMasterTemplateEntry, DocMasterPptxPreviewSlide, DocMasterTemplatesResponse } from "./docmaster";
export { CloudAPI, cloudAPI } from "./cloud";
export type { CloudFileEntry, CloudTemplateEntry, CloudStatus } from "./cloud";