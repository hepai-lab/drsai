import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type {
  DesktopProjectSkillDraft,
  DesktopProjectSkillDraftCreateRequest,
  DesktopProjectSkillInstallRequest,
  DesktopProjectSkillInstallResult,
  DesktopProjectSkillDraftListRequest,
  DesktopProjectSkillPublishRequest,
  DesktopProjectSkillPublishResult,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

const PROJECT_SKILL_DRAFTS_FILE = join(
  DRSAI_HOME,
  "desktop",
  "project-skill-drafts.json",
);
const PROJECT_SKILL_DRAFTS_DIR = join(DRSAI_HOME, "desktop", "skill-drafts");
const PROJECT_SKILLS_INSTALL_DIR = join(DRSAI_HOME, "desktop", "installed-skills");
const PROJECT_SKILLS_MARKETPLACE_SUBMISSIONS_DIR = join(
  DRSAI_HOME,
  "desktop",
  "skill-marketplace-submissions",
);
const MAX_SKILL_DRAFTS_PER_WORKSPACE = 100;
const MAX_SKILL_SOURCE_CHARS = 8000;
const MAX_TITLE_CHARS = 80;
const MAX_WORKSPACE_PATH_CHARS = 2048;
const MAX_NOTES_CHARS = 1000;

interface ProjectSkillDraftStore {
  workspaces: Record<string, DesktopProjectSkillDraft[]>;
}

export async function listProjectSkillDrafts(
  rawRequest: unknown,
): Promise<DesktopProjectSkillDraft[]> {
  const request = validateListRequest(rawRequest);
  const store = await readProjectSkillDraftStore();
  const key = workspaceKey(request.workspacePath);
  return (store.workspaces[key] ?? [])
    .slice()
    .sort(compareSkillDrafts)
    .slice(0, request.limit ?? 20);
}

export async function createProjectSkillDraft(
  rawRequest: unknown,
): Promise<DesktopProjectSkillDraft> {
  const request = validateCreateRequest(rawRequest);
  const store = await readProjectSkillDraftStore();
  const key = workspaceKey(request.workspacePath);
  const now = new Date().toISOString();
  const title = request.title ?? inferTitle(request.content);
  const slug = `${slugify(title)}-${randomUUID().slice(0, 8)}`;
  const workspaceDraftDir = join(PROJECT_SKILL_DRAFTS_DIR, key, slug);
  const draftPath = join(workspaceDraftDir, "SKILL.md");
  const summary = summarize(request.content);
  const skillMarkdown = renderSkillMarkdown({
    title,
    slug,
    summary,
    content: request.content,
  });
  const draft: DesktopProjectSkillDraft = {
    id: `skill-draft-${randomUUID()}`,
    workspacePath: request.workspacePath,
    title,
    slug,
    summary,
    skillMarkdown,
    draftPath,
    createdAt: now,
    updatedAt: now,
    source: request.source ?? "project_memory",
    ...(request.memoryEntryId ? { memoryEntryId: request.memoryEntryId } : {}),
  };

  await mkdir(workspaceDraftDir, { recursive: true });
  await writeFile(draftPath, skillMarkdown, "utf8");

  const entries = [draft, ...(store.workspaces[key] ?? [])]
    .sort(compareSkillDrafts)
    .slice(0, MAX_SKILL_DRAFTS_PER_WORKSPACE);
  store.workspaces[key] = entries;
  await writeProjectSkillDraftStore(store);
  return draft;
}

export async function installProjectSkillDraft(
  rawRequest: unknown,
): Promise<DesktopProjectSkillInstallResult> {
  const request = validateInstallRequest(rawRequest);
  const store = await readProjectSkillDraftStore();
  const key = workspaceKey(request.workspacePath);
  const drafts = store.workspaces[key] ?? [];
  const draft = drafts.find((item) => item.id === request.draftId);
  if (!draft) {
    throw new Error("Project skill draft was not found.");
  }

  const now = new Date().toISOString();
  const installDir = join(PROJECT_SKILLS_INSTALL_DIR, key, draft.slug);
  const installPath = join(installDir, "SKILL.md");
  const alreadyInstalled = Boolean(draft.installedAt && draft.installPath === installPath);
  const installedAt = draft.installedAt ?? now;
  await mkdir(installDir, { recursive: true });
  await writeFile(installPath, draft.skillMarkdown, "utf8");

  const installedDraft: DesktopProjectSkillDraft = {
    ...draft,
    installedAt,
    installPath,
    updatedAt: now,
  };
  store.workspaces[key] = drafts
    .map((item) => (item.id === draft.id ? installedDraft : item))
    .sort(compareSkillDrafts)
    .slice(0, MAX_SKILL_DRAFTS_PER_WORKSPACE);
  await writeProjectSkillDraftStore(store);

  return {
    workspacePath: request.workspacePath,
    draftId: draft.id,
    title: draft.title,
    slug: draft.slug,
    target: "desktop_local",
    installedAt,
    installPath,
    alreadyInstalled,
  };
}

export async function publishProjectSkillDraft(
  rawRequest: unknown,
): Promise<DesktopProjectSkillPublishResult> {
  const request = validatePublishRequest(rawRequest);
  const store = await readProjectSkillDraftStore();
  const key = workspaceKey(request.workspacePath);
  const drafts = store.workspaces[key] ?? [];
  const draft = drafts.find((item) => item.id === request.draftId);
  if (!draft) {
    throw new Error("Project skill draft was not found.");
  }

  const now = new Date().toISOString();
  const submissionDir = join(
    PROJECT_SKILLS_MARKETPLACE_SUBMISSIONS_DIR,
    key,
    draft.slug,
  );
  const submissionPath = join(submissionDir, "submission.json");
  const skillPath = join(submissionDir, "SKILL.md");
  const alreadyPublished = Boolean(
    draft.publishedAt && draft.marketplaceSubmissionPath === submissionPath,
  );
  const publishedAt = draft.publishedAt ?? now;
  const submission = {
    target: "marketplace_submission",
    workspacePath: request.workspacePath,
    draftId: draft.id,
    title: draft.title,
    slug: draft.slug,
    summary: draft.summary,
    source: draft.source,
    memoryEntryId: draft.memoryEntryId ?? null,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    publishedAt,
    notes: request.notes ?? "",
    verification:
      "Review submission.json and SKILL.md before uploading to a curated marketplace.",
  };

  await mkdir(submissionDir, { recursive: true });
  await writeFile(submissionPath, `${JSON.stringify(submission, null, 2)}\n`, "utf8");
  await writeFile(skillPath, draft.skillMarkdown, "utf8");

  const publishedDraft: DesktopProjectSkillDraft = {
    ...draft,
    publishedAt,
    marketplaceSubmissionPath: submissionPath,
    updatedAt: now,
  };
  store.workspaces[key] = drafts
    .map((item) => (item.id === draft.id ? publishedDraft : item))
    .sort(compareSkillDrafts)
    .slice(0, MAX_SKILL_DRAFTS_PER_WORKSPACE);
  await writeProjectSkillDraftStore(store);

  return {
    workspacePath: request.workspacePath,
    draftId: draft.id,
    title: draft.title,
    slug: draft.slug,
    target: "marketplace_submission",
    publishedAt,
    submissionPath,
    alreadyPublished,
    verification:
      "Review submission.json and SKILL.md before uploading to a curated marketplace.",
  };
}

async function readProjectSkillDraftStore(): Promise<ProjectSkillDraftStore> {
  try {
    const parsed = JSON.parse(await readFile(PROJECT_SKILL_DRAFTS_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object") return { workspaces: {} };
    const rawWorkspaces = (parsed as ProjectSkillDraftStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object") return { workspaces: {} };
    const workspaces: ProjectSkillDraftStore["workspaces"] = {};
    for (const [key, drafts] of Object.entries(rawWorkspaces)) {
      if (!Array.isArray(drafts)) continue;
      const validDrafts = drafts
        .filter(isSkillDraft)
        .sort(compareSkillDrafts)
        .slice(0, MAX_SKILL_DRAFTS_PER_WORKSPACE);
      if (validDrafts.length) workspaces[key] = validDrafts;
    }
    return { workspaces };
  } catch {
    return { workspaces: {} };
  }
}

async function writeProjectSkillDraftStore(
  store: ProjectSkillDraftStore,
): Promise<void> {
  await mkdir(dirname(PROJECT_SKILL_DRAFTS_FILE), { recursive: true });
  await writeFile(PROJECT_SKILL_DRAFTS_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function validateListRequest(
  rawRequest: unknown,
): DesktopProjectSkillDraftListRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Project skill draft list request must be an object.");
  }
  const request = rawRequest as Partial<DesktopProjectSkillDraftListRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    limit: sanitizeLimit(request.limit),
  };
}

function validateCreateRequest(
  rawRequest: unknown,
): DesktopProjectSkillDraftCreateRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Project skill draft create request must be an object.");
  }
  const request = rawRequest as Partial<DesktopProjectSkillDraftCreateRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    content: sanitizeSourceContent(request.content),
    title:
      typeof request.title === "string" && request.title.trim()
        ? request.title.trim().slice(0, MAX_TITLE_CHARS)
        : undefined,
    memoryEntryId: sanitizeMemoryEntryId(request.memoryEntryId),
    source: request.source === "manual" ? "manual" : "project_memory",
  };
}

function validateInstallRequest(
  rawRequest: unknown,
): DesktopProjectSkillInstallRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Project skill install request must be an object.");
  }
  const request = rawRequest as Partial<DesktopProjectSkillInstallRequest>;
  if (
    typeof request.draftId !== "string" ||
    !/^skill-draft-[a-zA-Z0-9-]{36}$/.test(request.draftId)
  ) {
    throw new Error("Project skill draft id is invalid.");
  }
  if (request.target && request.target !== "desktop_local") {
    throw new Error("Project skill install target is not supported.");
  }
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    draftId: request.draftId,
    target: "desktop_local",
  };
}

function validatePublishRequest(
  rawRequest: unknown,
): DesktopProjectSkillPublishRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Project skill publish request must be an object.");
  }
  const request = rawRequest as Partial<DesktopProjectSkillPublishRequest>;
  if (
    typeof request.draftId !== "string" ||
    !/^skill-draft-[a-zA-Z0-9-]{36}$/.test(request.draftId)
  ) {
    throw new Error("Project skill draft id is invalid.");
  }
  if (request.target && request.target !== "marketplace_submission") {
    throw new Error("Project skill publish target is not supported.");
  }
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    draftId: request.draftId,
    target: "marketplace_submission",
    notes:
      typeof request.notes === "string"
        ? request.notes.trim().slice(0, MAX_NOTES_CHARS)
        : undefined,
  };
}

function sanitizeWorkspacePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > MAX_WORKSPACE_PATH_CHARS ||
    /[\r\n]/.test(value)
  ) {
    throw new Error("Project skill draft workspace path is invalid.");
  }
  return value.trim();
}

function sanitizeSourceContent(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Project skill draft content is required.");
  }
  return value.trim().slice(0, MAX_SKILL_SOURCE_CHARS);
}

function sanitizeLimit(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(100, Math.floor(Number(value))));
}

function sanitizeMemoryEntryId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^memory-[a-zA-Z0-9-]{36}$/.test(value)) {
    throw new Error("Project memory id is invalid.");
  }
  return value;
}

function inferTitle(content: string): string {
  const withoutPrefix = content.replace(/^Skill promotion candidate:\s*/i, "").trim();
  const firstLine = withoutPrefix.split(/\r?\n/)[0]?.trim() || "Project memory skill";
  return firstLine.slice(0, MAX_TITLE_CHARS);
}

function summarize(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 220);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "project-memory-skill";
}

function renderSkillMarkdown({
  title,
  slug,
  summary,
  content,
}: {
  title: string;
  slug: string;
  summary: string;
  content: string;
}): string {
  return `# ${title}

Use this skill when a future OpenDrSai task matches this project lesson.

## Description

${summary}

## Workflow

1. Read the current project state before acting.
2. Apply the lesson below only when it matches the current task.
3. Add or update verification that proves the behavior still works.
4. Record any follow-up lesson back into project memory.

## Project Lesson

${content}

## Draft Metadata

- Draft slug: ${slug}
- Source: Project memory promotion candidate
`;
}

function isSkillDraft(value: unknown): value is DesktopProjectSkillDraft {
  const draft = value as DesktopProjectSkillDraft;
  return Boolean(
    draft &&
      typeof draft.id === "string" &&
      /^skill-draft-[a-zA-Z0-9-]{36}$/.test(draft.id) &&
      typeof draft.workspacePath === "string" &&
      typeof draft.title === "string" &&
      typeof draft.slug === "string" &&
      typeof draft.summary === "string" &&
      typeof draft.skillMarkdown === "string" &&
      typeof draft.draftPath === "string" &&
      typeof draft.createdAt === "string" &&
      typeof draft.updatedAt === "string",
  );
}

function compareSkillDrafts(
  left: DesktopProjectSkillDraft,
  right: DesktopProjectSkillDraft,
): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function workspaceKey(workspacePath: string): string {
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}
