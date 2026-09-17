import { createHash } from "crypto";
import { existsSync, realpathSync } from "fs";
import { readFile } from "fs/promises";
import { isAbsolute, join, relative, resolve } from "path";
import type {
  DesktopApprovalProposalResult,
  DesktopWorkflowMarketplaceListResult,
  DesktopWorkflowMarketplaceSyncRequest,
  DesktopWorkflowMarketplaceSyncResult,
  DesktopWorkflowRunPrepareRequest,
  DesktopWorkflowRunPrepareResult,
  DesktopWorkflowRunRecipe,
  DesktopWorkflowRunStep,
  DesktopWorkflowTemplate,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";
import { readDurableJson, writeDurableJson } from "../../../shared/main/durableJsonStore";

const WORKFLOW_MARKETPLACE_IMPORTS_FILE = join(
  DRSAI_HOME,
  "desktop",
  "workflow-marketplace-imports.json",
);
const MAX_WORKFLOW_MARKETPLACE_STORE_BYTES = 16 * 1024 * 1024;
const MAX_SYNCED_TEMPLATES_PER_WORKSPACE = 40;
const MAX_SYNC_SOURCE_BYTES = 256 * 1024;
const MAX_TEMPLATE_TEXT_CHARS = 600;
const MAX_TEMPLATE_ARRAY_ITEMS = 12;

interface WorkflowMarketplaceImportStore {
  workspaces: Record<
    string,
    {
      workspacePath: string;
      sourcePath: string;
      syncedAt: string;
      templates: DesktopWorkflowTemplate[];
    }
  >;
}

const WORKFLOW_TEMPLATES: DesktopWorkflowTemplate[] = [
  {
    id: "plan-review-fix",
    name: "Plan, review, fix",
    category: "review",
    status: "available",
    summary:
      "Turn a user request into a scoped plan, code review pass, implementation, and final verification notes.",
    trigger: "/plan followed by /review or /fix",
    steps: [
      "Read project instructions and current git status.",
      "Write a short design plan before editing.",
      "Apply the scoped code change.",
      "Run focused verification and summarize residual risk.",
    ],
    requiredCapabilities: [
      "runtime modes",
      "workspace context",
      "diff visibility",
      "terminal verification",
    ],
    approvalRequired: false,
    verification: "Use verify:chat-commands and the feature-specific verifier.",
    risk: "low",
  },
  {
    id: "test-and-commit",
    name: "Test and commit",
    category: "testing",
    status: "available",
    summary:
      "Collect staged changes, recent test evidence, and a commit message before policy-gated commit approval.",
    trigger: "/test followed by /commit <message>",
    steps: [
      "Run the requested or inferred test command.",
      "Capture the terminal test result for the workspace.",
      "Inspect staged diff and unstaged risk.",
      "Queue the git commit in Approval Center.",
    ],
    requiredCapabilities: [
      "terminal test result capture",
      "git diff preflight",
      "approval center",
    ],
    approvalRequired: false,
    verification:
      "Use verify:approval-center and verify:execution-policy; the /commit step owns the write approval.",
    risk: "high",
  },
  {
    id: "memory-to-skill",
    name: "Memory to skill",
    category: "automation",
    status: "preview",
    summary:
      "Promote a repeated project lesson into a reviewable local skill draft, then install it after human review.",
    trigger: "/memory retrospective <lesson>",
    steps: [
      "Save a durable project retrospective.",
      "Mark it as a skill-promotion candidate.",
      "Generate a bounded SKILL.md draft.",
      "Install the reviewed draft into local desktop skills.",
    ],
    requiredCapabilities: ["project memory", "skill drafts", "local skill install"],
    approvalRequired: false,
    verification: "Use verify:project-memory.",
    risk: "medium",
  },
  {
    id: "connector-digest",
    name: "Connector digest",
    category: "research",
    status: "available",
    summary:
      "Turn explicitly reviewed, read-only Channel context into a task brief without silently fetching or sending provider data.",
    trigger: "Channels view reviewed context",
    steps: [
      "Load and visibly review Channel context.",
      "Draft a task brief from the reviewed attachments.",
      "Verify citations and provider boundaries.",
    ],
    requiredCapabilities: [
      "channel adapters",
      "reviewed context attachments",
      "chat context injection",
    ],
    approvalRequired: false,
    verification:
      "Run workflow and Channel adapter verification; confirm the brief only cites visible reviewed attachments.",
    risk: "medium",
  },
  {
    id: "external-runtime-reconnect",
    name: "External runtime reconnect",
    category: "automation",
    status: "available",
    summary:
      "Track a workflow step that depends on an external runtime and recover it after app restart without silently re-running the process.",
    trigger: "Scheduled monitor or workflow recipe with external runtime handoff",
    steps: [
      "Prepare the workflow context and approval boundary.",
      "Start or reconnect the external runtime under operator control.",
      "Confirm the external runtime result before continuing.",
      "Record verification and residual restart risk.",
    ],
    requiredCapabilities: [
      "background tasks",
      "scheduled monitors",
      "restart resume plan",
      "approval center",
    ],
    approvalRequired: true,
    verification:
      "Use verify:workflow-marketplace, verify:background-tasks, and verify:scheduled-tasks.",
    risk: "high",
  },
];

export async function listWorkflowMarketplace(
  rawWorkspacePath?: unknown,
): Promise<DesktopWorkflowMarketplaceListResult> {
  const workspacePath =
    typeof rawWorkspacePath === "string" && rawWorkspacePath.trim()
      ? sanitizeWorkspacePath(rawWorkspacePath)
      : undefined;
  const synced = workspacePath
    ? await listSyncedWorkflowTemplates(workspacePath)
    : { templates: [], lastSyncedAt: undefined };
  const templates = [...WORKFLOW_TEMPLATES, ...synced.templates].map((template) => ({
    ...template,
    steps: [...template.steps],
    requiredCapabilities: [...template.requiredCapabilities],
  }));
  return {
    templates,
    generatedAt: new Date().toISOString(),
    availableCount: templates.filter((template) => template.status === "available")
      .length,
    approvalRequiredCount: templates.filter((template) => template.approvalRequired)
      .length,
    syncedCount: synced.templates.length,
    ...(synced.lastSyncedAt ? { lastSyncedAt: synced.lastSyncedAt } : {}),
  };
}

export async function syncWorkflowMarketplace(
  rawRequest: unknown,
): Promise<DesktopWorkflowMarketplaceSyncResult> {
  const request = validateSyncRequest(rawRequest);
  const sourcePath = resolveMarketplaceSourcePath(request);
  const statsPath = realpathSync.native(sourcePath);
  const source = await readFile(statsPath, "utf8");
  if (Buffer.byteLength(source, "utf8") > MAX_SYNC_SOURCE_BYTES) {
    throw new Error("Workflow marketplace sync file is too large.");
  }
  const parsed = JSON.parse(source) as unknown;
  const rawTemplates = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { templates?: unknown }).templates)
      ? (parsed as { templates: unknown[] }).templates
      : [];
  const templates: DesktopWorkflowTemplate[] = [];
  let ignoredCount = 0;
  for (const rawTemplate of rawTemplates.slice(0, MAX_SYNCED_TEMPLATES_PER_WORKSPACE)) {
    const template = normalizeSyncedTemplate(rawTemplate);
    if (template) {
      templates.push(template);
    } else {
      ignoredCount += 1;
    }
  }
  if (rawTemplates.length > MAX_SYNCED_TEMPLATES_PER_WORKSPACE) {
    ignoredCount += rawTemplates.length - MAX_SYNCED_TEMPLATES_PER_WORKSPACE;
  }

  const syncedAt = new Date().toISOString();
  const store = await readWorkflowMarketplaceImportStore();
  store.workspaces[workspaceKey(request.workspacePath)] = {
    workspacePath: request.workspacePath,
    sourcePath: statsPath,
    syncedAt,
    templates: templates.slice(0, MAX_SYNCED_TEMPLATES_PER_WORKSPACE),
  };
  await writeWorkflowMarketplaceImportStore(store);
  return {
    workspacePath: request.workspacePath,
    sourcePath: statsPath,
    syncedAt,
    importedCount: templates.length,
    ignoredCount,
    templates,
    message:
      "Synced reviewed workspace-local workflow templates; no network marketplace call was made.",
  };
}

export async function getWorkflowTemplate(
  templateId: string,
  workspacePath?: string,
): Promise<DesktopWorkflowTemplate | null> {
  const builtIn = WORKFLOW_TEMPLATES.find((template) => template.id === templateId);
  if (builtIn) return builtIn;
  if (!workspacePath) return null;
  const synced = await listSyncedWorkflowTemplates(workspacePath);
  return synced.templates.find((template) => template.id === templateId) ?? null;
}

export async function createWorkflowRunRecipe(
  request: DesktopWorkflowRunPrepareRequest,
  proposal?: DesktopApprovalProposalResult,
): Promise<DesktopWorkflowRunPrepareResult> {
  const template = await getWorkflowTemplate(request.templateId, request.workspacePath);
  const createdAt = new Date().toISOString();
  if (!template) {
    return {
      recipe: createBlockedRecipe(
        request,
        createdAt,
        "Unknown workflow template.",
      ),
      blocked: true,
      queued: false,
      reason: "Unknown workflow template.",
    };
  }
  if (template.status !== "available") {
    const reason = `Workflow template is ${template.status} and cannot be prepared yet.`;
    return {
      recipe: createBlockedRecipe(request, createdAt, reason, template),
      blocked: true,
      queued: false,
      reason,
    };
  }
  if (template.approvalRequired && !proposal) {
    const reason = "Workflow approval proposal is required before this recipe can become ready.";
    return {
      recipe: createBlockedRecipe(request, createdAt, reason, template),
      blocked: true,
      queued: false,
      reason,
    };
  }
  if (proposal?.blocked || proposal?.allowed === false) {
    return {
      recipe: createBlockedRecipe(request, createdAt, proposal.reason, template),
      blocked: true,
      queued: false,
      reason: proposal.reason,
    };
  }

  const queued = Boolean(proposal?.queued && proposal.approval);
  return {
    recipe: {
      id: createWorkflowRunId(template.id, createdAt),
      templateId: template.id,
      name: template.name,
      ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
      status: queued ? "approval_queued" : "ready",
      createdAt,
      steps: buildWorkflowRunSteps(template),
      verification: template.verification,
      ...(proposal?.approval ? { approvalId: proposal.approval.id } : {}),
      message: queued
        ? "Workflow recipe is waiting in Approval Center."
        : "Workflow recipe is ready to run from the chat bar and terminal.",
    },
    ...(proposal?.approval ? { approval: proposal.approval } : {}),
    blocked: false,
    queued,
    reason: proposal?.reason ?? "Workflow recipe prepared.",
  };
}

function createBlockedRecipe(
  request: DesktopWorkflowRunPrepareRequest,
  createdAt: string,
  reason: string,
  template?: DesktopWorkflowTemplate,
): DesktopWorkflowRunRecipe {
  return {
    id: createWorkflowRunId(template?.id ?? request.templateId, createdAt),
    templateId: template?.id ?? request.templateId,
    name: template?.name ?? request.templateId,
    ...(request.workspacePath ? { workspacePath: request.workspacePath } : {}),
    status: "blocked",
    createdAt,
    steps: template ? buildWorkflowRunSteps(template) : [],
    verification: template?.verification ?? "No verifier is available.",
    message: reason,
  };
}

function buildWorkflowRunSteps(
  template: DesktopWorkflowTemplate,
): DesktopWorkflowRunStep[] {
  if (template.id === "plan-review-fix") {
    return [
      {
        id: "plan",
        kind: "chat_command",
        title: "Enter plan mode",
        detail: "Ask the chat bar to produce a scoped implementation plan before editing.",
        command: "/plan",
        requiresApproval: false,
      },
      {
        id: "review",
        kind: "chat_command",
        title: "Run review pass",
        detail: "Inspect the current diff and identify defects, risk, and missing tests.",
        command: "/review",
        requiresApproval: false,
      },
      {
        id: "fix",
        kind: "chat_command",
        title: "Switch to fix mode",
        detail: "Apply the smallest code change that addresses the reviewed issue.",
        command: "/fix",
        requiresApproval: false,
      },
      {
        id: "verify",
        kind: "terminal_command",
        title: "Run focused verifier",
        detail: "Run the feature-specific verifier recorded in the template.",
        command: template.verification,
        requiresApproval: true,
      },
    ];
  }
  if (template.id === "test-and-commit") {
    return [
      {
        id: "test",
        kind: "chat_command",
        title: "Enter test mode",
        detail: "Ask the chat bar to infer and run the focused verification command.",
        command: "/test",
        requiresApproval: false,
      },
      {
        id: "capture",
        kind: "manual_review",
        title: "Capture test evidence",
        detail: "Confirm the terminal result is recorded for the active workspace.",
        requiresApproval: false,
      },
      {
        id: "preflight",
        kind: "manual_review",
        title: "Inspect staged diff",
        detail: "Review staged files, unstaged risk, and the commit test commitment.",
        requiresApproval: false,
      },
      {
        id: "commit",
        kind: "chat_command",
        title: "Request commit approval",
        detail: "Replace the placeholder, then use /commit <message> to route the commit through Approval Center.",
        command: "/commit <message>",
        requiresApproval: false,
      },
    ];
  }
  if (template.id === "memory-to-skill") {
    return [
      {
        id: "retrospective",
        kind: "chat_command",
        title: "Save retrospective",
        detail: "Replace the placeholder with the durable project lesson to save.",
        command: "/memory retrospective <lesson>",
        requiresApproval: false,
      },
      {
        id: "draft",
        kind: "manual_review",
        title: "Create skill draft",
        detail: "In Skills, create a project skill draft from the reviewed retrospective.",
        requiresApproval: false,
      },
      {
        id: "review-skill",
        kind: "manual_review",
        title: "Review SKILL.md",
        detail: "Inspect frontmatter, instructions, scope, and secret scan before installation.",
        requiresApproval: false,
      },
      {
        id: "install-skill",
        kind: "manual_review",
        title: "Install after approval",
        detail: "Use the project skill install control and complete its own Approval Center flow.",
        requiresApproval: false,
      },
    ];
  }
  if (template.id === "external-runtime-reconnect") {
    return [
      {
        id: "prepare",
        kind: "chat_command",
        title: "Prepare runtime context",
        detail: "Ask the chat bar to gather the runtime scope and restart constraints.",
        command: "/plan external runtime reconnect",
        requiresApproval: false,
      },
      {
        id: "runtime",
        kind: "external_runtime",
        title: "Reconnect external runtime",
        detail:
          "Reconnect or restart the external runtime through its provider-specific control plane; do not auto-run after restart.",
        requiresApproval: true,
      },
      {
        id: "verify",
        kind: "manual_review",
        title: "Confirm runtime result",
        detail:
          "Review runtime output, background task state, and scheduled monitor state before marking the workflow complete.",
        requiresApproval: false,
      },
    ];
  }
  if (template.id === "connector-digest") {
    return [
      {
        id: "review-context",
        kind: "manual_review",
        title: "Review Channel context",
        detail:
          "Open Channels, load read-only provider context, and visibly review the attachments before confirming this checkpoint. The workflow does not fetch provider data itself.",
        requiresApproval: false,
      },
      {
        id: "draft-brief",
        kind: "chat_command",
        title: "Draft connector brief",
        detail:
          "Ask Chat to synthesize only the reviewed Channel attachments already visible in the active thread.",
        command:
          "Prepare a concise task brief using only the reviewed Channel import attachments visible in this thread. Cite each attachment, separate facts from inferences, and do not fetch or send provider data.",
        requiresApproval: false,
      },
      {
        id: "verify-brief",
        kind: "manual_review",
        title: "Verify brief boundaries",
        detail:
          "Confirm every claim is traceable to a visible reviewed attachment and that no provider write or hidden network fetch occurred.",
        requiresApproval: false,
      },
    ];
  }
  return template.steps.map((step, index) => ({
    id: `step-${index + 1}`,
    kind: "manual_review",
    title: `Step ${index + 1}`,
    detail: step,
    requiresApproval: template.approvalRequired,
  }));
}

function createWorkflowRunId(templateId: string, createdAt: string): string {
  return `workflow:${templateId}:${Date.parse(createdAt).toString(36)}`;
}

async function listSyncedWorkflowTemplates(
  workspacePath: string,
): Promise<{ templates: DesktopWorkflowTemplate[]; lastSyncedAt?: string }> {
  const store = await readWorkflowMarketplaceImportStore();
  const entry = store.workspaces[workspaceKey(workspacePath)];
  if (!entry) return { templates: [] };
  return {
    templates: entry.templates.map((template) => ({
      ...template,
      steps: [...template.steps],
      requiredCapabilities: [...template.requiredCapabilities],
    })),
    lastSyncedAt: entry.syncedAt,
  };
}

async function readWorkflowMarketplaceImportStore(): Promise<WorkflowMarketplaceImportStore> {
  return (await readDurableJson(WORKFLOW_MARKETPLACE_IMPORTS_FILE, decodeWorkflowMarketplaceImportStore, { maxBytes: MAX_WORKFLOW_MARKETPLACE_STORE_BYTES }))?.value ?? { workspaces: {} };
}

function decodeWorkflowMarketplaceImportStore(parsed: unknown): WorkflowMarketplaceImportStore {
    if (!parsed || typeof parsed !== "object") throw new Error("Workflow marketplace store schema is invalid.");
    const rawWorkspaces = (parsed as WorkflowMarketplaceImportStore).workspaces;
    if (!rawWorkspaces || typeof rawWorkspaces !== "object" || Array.isArray(rawWorkspaces)) throw new Error("Workflow marketplace store schema is invalid.");
    const workspaces: WorkflowMarketplaceImportStore["workspaces"] = {};
    for (const [key, entry] of Object.entries(rawWorkspaces)) {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.templates)) {
        continue;
      }
      const validTemplates = entry.templates
        .map(normalizeSyncedTemplate)
        .filter((template): template is DesktopWorkflowTemplate => Boolean(template))
        .slice(0, MAX_SYNCED_TEMPLATES_PER_WORKSPACE);
      if (!validTemplates.length) continue;
      workspaces[key] = {
        workspacePath:
          typeof entry.workspacePath === "string" ? entry.workspacePath : "",
        sourcePath: typeof entry.sourcePath === "string" ? entry.sourcePath : "",
        syncedAt:
          typeof entry.syncedAt === "string"
            ? entry.syncedAt
            : new Date(0).toISOString(),
        templates: validTemplates,
      };
    }
    return { workspaces };
}

async function writeWorkflowMarketplaceImportStore(
  store: WorkflowMarketplaceImportStore,
): Promise<void> {
  await writeDurableJson(WORKFLOW_MARKETPLACE_IMPORTS_FILE, store, { maxBytes: MAX_WORKFLOW_MARKETPLACE_STORE_BYTES });
}

function validateSyncRequest(
  rawRequest: unknown,
): DesktopWorkflowMarketplaceSyncRequest {
  if (!rawRequest || typeof rawRequest !== "object") {
    throw new Error("Workflow marketplace sync request must be an object.");
  }
  const request = rawRequest as Partial<DesktopWorkflowMarketplaceSyncRequest>;
  return {
    workspacePath: sanitizeWorkspacePath(request.workspacePath),
    sourcePath:
      typeof request.sourcePath === "string" && request.sourcePath.trim()
        ? request.sourcePath.trim()
        : undefined,
  };
}

function resolveMarketplaceSourcePath(
  request: DesktopWorkflowMarketplaceSyncRequest,
): string {
  const workspacePath = realpathSync.native(resolve(request.workspacePath));
  const requestedPath = request.sourcePath
    ? resolve(request.sourcePath)
    : join(workspacePath, ".drsai", "workflow-marketplace.json");
  if (!existsSync(requestedPath)) {
    throw new Error("Workflow marketplace sync file was not found.");
  }
  const sourcePath = realpathSync.native(requestedPath);
  const relativePath = relative(workspacePath, sourcePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Workflow marketplace sync file must be inside the workspace.");
  }
  if (!/\.json$/i.test(sourcePath)) {
    throw new Error("Workflow marketplace sync file must be JSON.");
  }
  return sourcePath;
}

function normalizeSyncedTemplate(value: unknown): DesktopWorkflowTemplate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DesktopWorkflowTemplate>;
  const id = sanitizeTemplateId(raw.id);
  const name = sanitizeTemplateText(raw.name, 80);
  const category = sanitizeTemplateCategory(raw.category);
  const status = sanitizeTemplateStatus(raw.status);
  const summary = sanitizeTemplateText(raw.summary, MAX_TEMPLATE_TEXT_CHARS);
  const trigger = sanitizeTemplateText(raw.trigger, 180);
  const steps = sanitizeTextArray(raw.steps);
  const requiredCapabilities = sanitizeTextArray(raw.requiredCapabilities);
  const verification = sanitizeTemplateText(raw.verification, 240);
  const risk = sanitizeTemplateRisk(raw.risk);
  if (
    !id ||
    !name ||
    !category ||
    !status ||
    !summary ||
    !trigger ||
    !steps.length ||
    !requiredCapabilities.length ||
    !verification ||
    !risk
  ) {
    return null;
  }
  return {
    id: `synced-${id}`,
    name,
    category,
    status,
    summary,
    trigger,
    steps,
    requiredCapabilities,
    approvalRequired: Boolean(raw.approvalRequired),
    verification,
    risk,
  };
}

function sanitizeTemplateId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return id || null;
}

function sanitizeTemplateText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function sanitizeTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeTemplateText(item, MAX_TEMPLATE_TEXT_CHARS))
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_TEMPLATE_ARRAY_ITEMS);
}

function sanitizeTemplateCategory(
  value: unknown,
): DesktopWorkflowTemplate["category"] | null {
  if (
    value === "planning" ||
    value === "review" ||
    value === "testing" ||
    value === "release" ||
    value === "research" ||
    value === "automation"
  ) {
    return value;
  }
  return null;
}

function sanitizeTemplateStatus(
  value: unknown,
): DesktopWorkflowTemplate["status"] | null {
  if (value === "available" || value === "preview" || value === "planned") {
    return value;
  }
  return null;
}

function sanitizeTemplateRisk(value: unknown): DesktopWorkflowTemplate["risk"] | null {
  if (value === "low" || value === "medium" || value === "high") return value;
  return null;
}

function sanitizeWorkspacePath(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value)) {
    throw new Error("Workflow marketplace workspace path is invalid.");
  }
  return value.trim();
}

function workspaceKey(workspacePath: string): string {
  return createHash("sha256")
    .update(workspacePath.trim().toLowerCase())
    .digest("hex");
}
