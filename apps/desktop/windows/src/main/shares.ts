import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";
import type {
  DesktopBackgroundTask,
  DesktopShareAuditEntry,
  DesktopShareAuditListRequest,
  DesktopShareComment,
  DesktopShareCommentAddRequest,
  DesktopShareCommentListRequest,
  DesktopShareContinuationRequest,
  DesktopShareContinuationResult,
  DesktopShareCreateRequest,
  DesktopShareInspectionRequest,
  DesktopShareInspectionResult,
  DesktopShareManifest,
  DesktopShareManifestObject,
  DesktopSharePermission,
  DesktopSharePermissionUpdateRequest,
  DesktopSharedArtifactDownloadRequest,
  DesktopSharedArtifactDownloadResult,
  DesktopSharedObjectOpenRequest,
  DesktopSharedObjectOpenResult,
  DesktopTaskArtifactLink,
} from "../shared/desktopApi";
import { requireAuthContext } from "./auth";
import { listBackgroundTasks, listOwnedBackgroundTasks } from "./backgroundTasks";
import { DRSAI_HOME } from "./paths";
import {
  publicSensitiveFindings,
  sanitizeSensitiveText,
  scanSensitiveText,
  validateSensitiveResolutions,
  type SensitiveMatch,
} from "./shareSensitivity";

const SHARES_FILE = resolve(DRSAI_HOME, "desktop", "shares.json");
const MAX_SHARES = 500;
const MAX_TEXT_PREVIEW_BYTES = 100_000;
const MAX_SHARED_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_SENSITIVE_SCAN_BYTES = 5 * 1024 * 1024;
const SANITIZED_SHARES_DIR = resolve(DRSAI_HOME, "desktop", "sanitized-shares");
const MAX_SHARE_COMMENTS = 500;
const MAX_SHARE_AUDIT_ENTRIES = 2_000;

interface ArtifactSensitivityScan {
  artifact: DesktopTaskArtifactLink;
  filePath: string;
  file: Buffer;
  text?: string;
  matches: SensitiveMatch[];
  labelMatches: SensitiveMatch[];
}

interface StoredShare extends DesktopShareManifest {
  ownerUserId: string;
  internalWorkspacePath: string;
  internalObjects: Array<{
    objectType: "task" | "artifact";
    objectId: string;
    artifactPath?: string;
    sharedTaskTitle?: string;
  }>;
  comments: DesktopShareComment[];
  continuations: DesktopShareContinuationResult[];
  audit: DesktopShareAuditEntry[];
}

interface ShareStore { shares: StoredShare[] }

export async function inspectShare(request: unknown): Promise<DesktopShareInspectionResult> {
  const typed = normalizeInspectionRequest(request);
  const { task, sharedArtifacts } = await resolveOwnedShareSource(typed);
  const scans = await scanShareArtifacts(task, sharedArtifacts);
  const taskTitleMatches = typed.scope === "complete_task" ? scanSensitiveText(task.title, task.id, "任务名称") : [];
  const findings = publicSensitiveFindings([...taskTitleMatches, ...scans.flatMap((item) => [...item.labelMatches, ...item.matches])]);
  return {
    sourceTaskId: task.id,
    scope: typed.scope,
    ...(typed.artifactId ? { artifactId: typed.artifactId } : {}),
    scannedArtifactCount: scans.filter((item) => item.text !== undefined).length,
    findings,
    requiresResolution: findings.length > 0,
  };
}

export async function createShare(request: unknown): Promise<DesktopShareManifest> {
  const typed = normalizeCreateRequest(request);
  const auth = await requireAuthContext();
  const { task, selected, sharedArtifacts } = await resolveOwnedShareSource(typed);
  const scans = await scanShareArtifacts(task, sharedArtifacts);
  const taskTitleMatches = typed.scope === "complete_task" ? scanSensitiveText(task.title, task.id, "任务名称") : [];
  const findings = publicSensitiveFindings([...taskTitleMatches, ...scans.flatMap((item) => [...item.labelMatches, ...item.matches])]);
  const resolutions = typed.sensitiveResolutions ?? [];
  validateSensitiveResolutions(findings, resolutions);
  const shareId = `share:${randomUUID()}`;
  const sanitizedDirectory = join(SANITIZED_SHARES_DIR, shareId.slice("share:".length));
  const publicObjects: DesktopShareManifestObject[] = [];
  const internalObjects: StoredShare["internalObjects"] = [];
  if (typed.scope === "complete_task") {
    const sharedTaskTitle = taskTitleMatches.length ? sanitizeSensitiveText(task.title, taskTitleMatches, resolutions) : task.title;
    publicObjects.push({ objectType: "task", objectId: task.id, label: sharedTaskTitle });
    internalObjects.push({ objectType: "task", objectId: task.id, sharedTaskTitle });
  }
  for (const scan of scans) {
    const { artifact } = scan;
    const sharedLabel = scan.labelMatches.length
      ? sanitizeSensitiveText(artifact.label, scan.labelMatches, resolutions)
      : artifact.label;
    let sharedFile = scan.file;
    let sharedPath = scan.filePath;
    if (scan.matches.length > 0 && scan.text !== undefined) {
      const sanitized = sanitizeSensitiveText(scan.text, scan.matches, resolutions);
      sharedFile = Buffer.from(sanitized, "utf8");
      await mkdir(sanitizedDirectory, { recursive: true });
      sharedPath = join(sanitizedDirectory, `${createHash("sha256").update(artifact.id).digest("hex").slice(0, 16)}${extname(scan.filePath) || ".txt"}`);
      await writeFile(sharedPath, sharedFile);
    }
    publicObjects.push({
      objectType: "artifact",
      objectId: artifact.id,
      label: sharedLabel,
      kind: artifact.kind,
      bytes: sharedFile.byteLength,
      sha256: createHash("sha256").update(sharedFile).digest("hex"),
    });
    internalObjects.push({ objectType: "artifact", objectId: artifact.id, artifactPath: sharedPath });
  }
  const createdAt = new Date().toISOString();
  const ownerAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const share: StoredShare = {
    id: shareId,
    ownerAccount,
    ownerUserId: auth.userId,
    recipientAccount: typed.recipientAccount,
    scope: typed.scope,
    sourceTaskId: task.id,
    ...(selected ? { selectedArtifactId: selected.id } : {}),
    objects: publicObjects,
    internalWorkspacePath: task.workspacePath!,
    internalObjects,
    createdAt,
    status: "active",
    permission: typed.permission ?? "view",
    sensitiveReview: {
      findingsCount: findings.reduce((sum, item) => sum + item.occurrences, 0),
      redactedCount: findings.filter((item) => resolutions.find((resolution) => resolution.findingId === item.id)?.action === "redact").reduce((sum, item) => sum + item.occurrences, 0),
      removedCount: findings.filter((item) => resolutions.find((resolution) => resolution.findingId === item.id)?.action === "remove").reduce((sum, item) => sum + item.occurrences, 0),
      highRiskSecretsDirectlyShared: 0,
    },
    comments: [],
    continuations: [],
    audit: [],
  };
  const store = await readStore();
  store.shares = [share, ...store.shares].slice(0, MAX_SHARES);
  try {
    await writeStore(store);
  } catch (error) {
    await rm(sanitizedDirectory, { recursive: true, force: true });
    throw error;
  }
  return publicManifest(share);
}

export async function listIncomingShares(): Promise<DesktopShareManifest[]> {
  const auth = await requireAuthContext();
  const identities = currentAccounts(auth.userId, auth.session.user?.email);
  const store = await readStore();
  return store.shares.filter((share) => identities.has(share.recipientAccount)).map(publicManifest);
}

export async function listOutgoingShares(): Promise<DesktopShareManifest[]> {
  const auth = await requireAuthContext();
  const store = await readStore();
  return store.shares.filter((share) => share.ownerUserId === auth.userId).map(publicManifest);
}

export async function updateSharePermission(request: unknown): Promise<DesktopShareManifest> {
  const typed = normalizePermissionUpdateRequest(request);
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  if (!share || share.ownerUserId !== auth.userId) {
    if (share) {
      appendAudit(share, actorAccount, "permission_update", "denied", "Only the share owner can change permissions.");
      await writeStore(store);
    }
    throw new Error("Only the share owner can change permissions.");
  }
  share.permission = typed.permission;
  appendAudit(share, actorAccount, "permission_update", "allowed", `Permission changed to ${typed.permission}.`);
  await writeStore(store);
  return publicManifest(share);
}

export async function listShareComments(request: unknown): Promise<DesktopShareComment[]> {
  const typed = normalizeShareIdRequest(request, "Share comment list request is required.") as DesktopShareCommentListRequest;
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  const isOwner = share?.ownerUserId === auth.userId;
  const isRecipient = Boolean(share && currentAccounts(auth.userId, auth.session.user?.email).has(share.recipientAccount));
  if (!share || (!isOwner && (!isRecipient || !canComment(share.permission ?? "view")))) {
    if (share) {
      appendAudit(share, actorAccount, "comment", "denied", isRecipient ? "The current permission does not allow reading comments." : "The account cannot access these comments.");
      await writeStore(store);
    }
    throw new Error("The current share permission does not allow comments.");
  }
  return (share.comments ?? []).map((item) => ({ ...item }));
}

export async function addShareComment(request: unknown): Promise<DesktopShareComment> {
  const typed = normalizeCommentAddRequest(request);
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  const recipient = share && currentAccounts(auth.userId, auth.session.user?.email).has(share.recipientAccount);
  if (!share || !recipient || !canComment(share.permission ?? "view")) {
    if (share) {
      appendAudit(share, actorAccount, "comment", "denied", recipient ? "The current permission does not allow comments." : "The account is not the share recipient.");
      await writeStore(store);
    }
    throw new Error("The current share permission does not allow comments.");
  }
  if (publicSensitiveFindings(scanSensitiveText(typed.body, `comment:${share.id}`, "评论内容")).length > 0) {
    appendAudit(share, actorAccount, "comment", "denied", "Sensitive information was detected in the comment.");
    await writeStore(store);
    throw new Error("Remove sensitive information from the comment before sending it.");
  }
  const comment: DesktopShareComment = { id: `share-comment:${randomUUID()}`, shareId: share.id, authorAccount: actorAccount, body: typed.body, createdAt: new Date().toISOString() };
  share.comments = [...(share.comments ?? []), comment].slice(-MAX_SHARE_COMMENTS);
  appendAudit(share, actorAccount, "comment", "allowed", "Comment added.");
  await writeStore(store);
  return { ...comment };
}

export async function continueSharedTask(request: unknown): Promise<DesktopShareContinuationResult> {
  const typed = normalizeShareIdRequest(request, "Share continuation request is required.") as DesktopShareContinuationRequest;
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  const recipient = share && currentAccounts(auth.userId, auth.session.user?.email).has(share.recipientAccount);
  if (!share || !recipient || (share.permission ?? "view") !== "continue") {
    if (share) {
      appendAudit(share, actorAccount, "continue", "denied", recipient ? "The current permission does not allow continued processing." : "The account is not the share recipient.");
      await writeStore(store);
    }
    throw new Error("The current share permission does not allow continued processing.");
  }
  const continuation: DesktopShareContinuationResult = {
    id: `share-continuation:${randomUUID()}`, shareId: share.id, requesterAccount: actorAccount,
    sourceTaskId: share.sourceTaskId,
    artifactIds: share.objects.filter((item) => item.objectType === "artifact").map((item) => item.objectId),
    status: "requested", createdAt: new Date().toISOString(),
  };
  share.continuations = [...(share.continuations ?? []), continuation].slice(-MAX_SHARE_COMMENTS);
  appendAudit(share, actorAccount, "continue", "allowed", "Continuation requested.");
  await writeStore(store);
  return { ...continuation, artifactIds: [...continuation.artifactIds] };
}

export async function listShareAudit(request: unknown): Promise<DesktopShareAuditEntry[]> {
  const typed = normalizeShareIdRequest(request, "Share audit request is required.") as DesktopShareAuditListRequest;
  const auth = await requireAuthContext();
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId);
  if (!share || share.ownerUserId !== auth.userId) throw new Error("Only the share owner can view its audit trail.");
  return (share.audit ?? []).map((item) => ({ ...item }));
}

export async function openSharedObject(request: unknown): Promise<DesktopSharedObjectOpenResult> {
  const typed = normalizeOpenRequest(request);
  const auth = await requireAuthContext();
  const identities = currentAccounts(auth.userId, auth.session.user?.email);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  if (!share || !identities.has(share.recipientAccount)) {
    throw new Error("This shared item is not available to the signed-in account.");
  }
  const allowed = share.objects.find((item) => item.objectType === typed.objectType && item.objectId === typed.objectId);
  const internal = share.internalObjects.find((item) => item.objectType === typed.objectType && item.objectId === typed.objectId);
  if (!allowed || !internal) throw new Error("This object is not included in the share manifest.");
  if (typed.objectType === "task") {
    const task = (await listBackgroundTasks({ limit: 100 })).find((item) => item.id === typed.objectId);
    if (!task) throw new Error("The shared task is no longer available.");
    return {
      shareId: share.id, objectType: "task", objectId: task.id, label: internal.sharedTaskTitle || allowed.label, authorized: true,
      task: { id: task.id, title: internal.sharedTaskTitle || allowed.label, status: task.status, updatedAt: task.updatedAt, artifactIds: share.objects.filter((item) => item.objectType === "artifact").map((item) => item.objectId) },
    };
  }
  const artifact = findArtifact(await listBackgroundTasks({ limit: 100 }), share.sourceTaskId, typed.objectId);
  if (!artifact || !internal.artifactPath) throw new Error("The shared result is no longer available.");
  const file = await readFile(internal.artifactPath);
  const content = isTextArtifact(artifact, internal.artifactPath) && file.byteLength <= MAX_TEXT_PREVIEW_BYTES ? file.toString("utf8") : undefined;
  return {
    shareId: share.id, objectType: "artifact", objectId: artifact.id, label: allowed.label, authorized: true,
    artifact: { id: artifact.id, label: allowed.label, kind: artifact.kind, bytes: file.byteLength, sha256: createHash("sha256").update(file).digest("hex"), ...(content !== undefined ? { content } : {}) },
  };
}

export async function downloadSharedArtifact(request: unknown): Promise<DesktopSharedArtifactDownloadResult> {
  const typed = normalizeDownloadRequest(request);
  const auth = await requireAuthContext();
  const identities = currentAccounts(auth.userId, auth.session.user?.email);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  if (!share || !identities.has(share.recipientAccount)) {
    throw new Error("This shared result is not available to the signed-in account.");
  }
  const allowed = share.objects.find((item) => item.objectType === "artifact" && item.objectId === typed.objectId);
  const internal = share.internalObjects.find((item) => item.objectType === "artifact" && item.objectId === typed.objectId);
  if (!allowed || !internal?.artifactPath) throw new Error("This result is not included in the share manifest.");
  const artifact = findArtifact(await listBackgroundTasks({ limit: 100 }), share.sourceTaskId, typed.objectId);
  if (!artifact) throw new Error("The shared result is no longer available.");
  const file = await readFile(internal.artifactPath);
  if (file.byteLength > MAX_SHARED_DOWNLOAD_BYTES) throw new Error("The shared result is too large for in-app download preparation.");
  return {
    shareId: share.id,
    artifactId: artifact.id,
    fileName: safeFileName(allowed.label),
    kind: artifact.kind,
    bytes: file.byteLength,
    sha256: createHash("sha256").update(file).digest("hex"),
    base64: file.toString("base64"),
  };
}

function normalizeCreateRequest(request: unknown): DesktopShareCreateRequest {
  if (!request || typeof request !== "object") throw new Error("Share request is required.");
  const value = request as Partial<DesktopShareCreateRequest>;
  if (value.scope !== "result_only" && value.scope !== "complete_task") throw new Error("Share scope is invalid.");
  const sourceTaskId = required(value.sourceTaskId, "Source task id is required.");
  const recipientAccount = normalizeAccount(required(value.recipientAccount, "Recipient account is required."));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientAccount)) throw new Error("Recipient account must be a valid email address.");
  const artifactId = typeof value.artifactId === "string" ? value.artifactId.trim() : "";
  if (value.scope === "result_only" && !artifactId) throw new Error("A result must be selected for result-only sharing.");
  const sensitiveResolutions = normalizeSensitiveResolutions(value.sensitiveResolutions);
  const permission = value.permission === undefined ? "view" : normalizePermission(value.permission);
  return { sourceTaskId, scope: value.scope, recipientAccount, permission, ...(artifactId ? { artifactId } : {}), ...(sensitiveResolutions.length ? { sensitiveResolutions } : {}) };
}

function normalizePermissionUpdateRequest(request: unknown): DesktopSharePermissionUpdateRequest {
  if (!request || typeof request !== "object") throw new Error("Share permission update request is required.");
  const value = request as Partial<DesktopSharePermissionUpdateRequest>;
  return { shareId: required(value.shareId, "Share id is required."), permission: normalizePermission(value.permission) };
}

function normalizePermission(value: unknown): DesktopSharePermission {
  if (value !== "view" && value !== "comment" && value !== "continue") throw new Error("Share permission is invalid.");
  return value;
}

function normalizeShareIdRequest(request: unknown, message: string): { shareId: string } {
  if (!request || typeof request !== "object") throw new Error(message);
  return { shareId: required((request as { shareId?: unknown }).shareId, "Share id is required.") };
}

function normalizeCommentAddRequest(request: unknown): DesktopShareCommentAddRequest {
  const share = normalizeShareIdRequest(request, "Share comment request is required.");
  const rawBody = (request as { body?: unknown }).body;
  if (typeof rawBody !== "string") throw new Error("Comment text is required.");
  const body = rawBody.trim();
  if (!body) throw new Error("Comment text is required.");
  if (body.length > 2_000) throw new Error("Comments are limited to 2,000 characters.");
  return { shareId: share.shareId, body };
}

function normalizeInspectionRequest(request: unknown): DesktopShareInspectionRequest {
  if (!request || typeof request !== "object") throw new Error("Share inspection request is required.");
  const value = request as Partial<DesktopShareInspectionRequest>;
  if (value.scope !== "result_only" && value.scope !== "complete_task") throw new Error("Share scope is invalid.");
  const sourceTaskId = required(value.sourceTaskId, "Source task id is required.");
  const artifactId = typeof value.artifactId === "string" ? value.artifactId.trim() : "";
  if (value.scope === "result_only" && !artifactId) throw new Error("A result must be selected for result-only sharing.");
  return { sourceTaskId, scope: value.scope, ...(artifactId ? { artifactId } : {}) };
}

function normalizeSensitiveResolutions(value: DesktopShareCreateRequest["sensitiveResolutions"]): NonNullable<DesktopShareCreateRequest["sensitiveResolutions"]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 200) throw new Error("Sensitive information resolutions are invalid.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || (item.action !== "redact" && item.action !== "remove")) throw new Error("Sensitive information resolution is invalid.");
    return { findingId: required(item.findingId, "Sensitive finding id is required."), action: item.action };
  });
}

async function resolveOwnedShareSource(request: DesktopShareInspectionRequest): Promise<{
  task: DesktopBackgroundTask;
  selected?: DesktopTaskArtifactLink;
  sharedArtifacts: DesktopTaskArtifactLink[];
}> {
  const tasks = await listOwnedBackgroundTasks({ limit: 100 });
  const task = tasks.find((item) => item.id === request.sourceTaskId);
  if (!task || task.status !== "completed" || !task.workspacePath || !task.deliverySummary) throw new Error("Only a completed task with results can be shared.");
  const selected = request.scope === "result_only" ? task.deliverySummary.artifacts.find((artifact) => artifact.id === request.artifactId) : undefined;
  if (request.scope === "result_only" && !selected) throw new Error("The selected result was not found in the source task.");
  const sharedArtifacts = selected ? [selected] : task.deliverySummary.artifacts;
  if (sharedArtifacts.length === 0) throw new Error("The task has no results to share.");
  return { task, ...(selected ? { selected } : {}), sharedArtifacts };
}

async function scanShareArtifacts(task: DesktopBackgroundTask, artifacts: DesktopTaskArtifactLink[]): Promise<ArtifactSensitivityScan[]> {
  if (!task.workspacePath) throw new Error("The source workspace is not available.");
  return Promise.all(artifacts.map(async (artifact) => {
    const filePath = safeArtifactPath(task.workspacePath!, artifact.path);
    const file = await readFile(filePath);
    const labelMatches = scanSensitiveText(artifact.label, artifact.id, "成果名称");
    const findingArtifactLabel = labelMatches.length ? "成果名称含敏感信息" : artifact.label;
    if (!isTextArtifact(artifact, filePath)) return { artifact, filePath, file, matches: [], labelMatches };
    if (file.byteLength > MAX_SENSITIVE_SCAN_BYTES) throw new Error("A text result is too large for the required sensitive information scan.");
    const text = file.toString("utf8");
    return { artifact, filePath, file, text, matches: scanSensitiveText(text, artifact.id, findingArtifactLabel), labelMatches };
  }));
}

function normalizeOpenRequest(request: unknown): DesktopSharedObjectOpenRequest {
  if (!request || typeof request !== "object") throw new Error("Shared object request is required.");
  const value = request as Partial<DesktopSharedObjectOpenRequest>;
  if (value.objectType !== "task" && value.objectType !== "artifact") throw new Error("Shared object type is invalid.");
  return { shareId: required(value.shareId, "Share id is required."), objectType: value.objectType, objectId: required(value.objectId, "Shared object id is required.") };
}

function normalizeDownloadRequest(request: unknown): DesktopSharedArtifactDownloadRequest {
  if (!request || typeof request !== "object") throw new Error("Shared result download request is required.");
  const value = request as Partial<DesktopSharedArtifactDownloadRequest>;
  return { shareId: required(value.shareId, "Share id is required."), objectId: required(value.objectId, "Shared result id is required.") };
}

function safeArtifactPath(workspacePath: string, candidate: string): string {
  const base = resolve(workspacePath);
  const target = resolve(isAbsolute(candidate) ? candidate : resolve(base, candidate));
  const rel = relative(base, target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    if (target !== base) throw new Error("A result outside the source workspace cannot be shared.");
  }
  return target;
}

function findArtifact(tasks: DesktopBackgroundTask[], taskId: string, artifactId: string): DesktopTaskArtifactLink | undefined {
  return tasks.find((task) => task.id === taskId)?.deliverySummary?.artifacts.find((artifact) => artifact.id === artifactId);
}

function isTextArtifact(artifact: DesktopTaskArtifactLink, path: string): boolean {
  return artifact.kind === "report" || /\.(?:md|txt|csv|json|html?)$/i.test(path);
}

function currentAccounts(userId: string, email?: string): Set<string> {
  return new Set([userId, email].filter(Boolean).map((item) => normalizeAccount(String(item))));
}

function canComment(permission: DesktopSharePermission): boolean { return permission === "comment" || permission === "continue"; }

function appendAudit(
  share: StoredShare,
  actorAccount: string,
  action: DesktopShareAuditEntry["action"],
  outcome: DesktopShareAuditEntry["outcome"],
  reason: string,
): void {
  const entry: DesktopShareAuditEntry = {
    id: `share-audit:${randomUUID()}`, shareId: share.id, actorAccount, action, outcome,
    permission: share.permission ?? "view", reason, createdAt: new Date().toISOString(),
  };
  share.audit = [...(share.audit ?? []), entry].slice(-MAX_SHARE_AUDIT_ENTRIES);
}

function normalizeAccount(value: string): string { return value.trim().toLowerCase(); }
function safeFileName(value: string): string { const name = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_"); return name || "shared-result"; }
function required(value: unknown, message: string): string { if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\r\n]/.test(value)) throw new Error(message); return value.trim(); }
function publicManifest(share: StoredShare): DesktopShareManifest { const { id, ownerAccount, recipientAccount, scope, sourceTaskId, selectedArtifactId, objects, createdAt, status, sensitiveReview } = share; return { id, ownerAccount, recipientAccount, scope, sourceTaskId, permission: share.permission ?? "view", ...(selectedArtifactId ? { selectedArtifactId } : {}), objects: objects.map((item) => ({ ...item })), createdAt, status, ...(sensitiveReview ? { sensitiveReview: { ...sensitiveReview } } : {}) }; }

async function readStore(): Promise<ShareStore> {
  try { const parsed = JSON.parse(await readFile(SHARES_FILE, "utf8")) as Partial<ShareStore>; return { shares: Array.isArray(parsed.shares) ? parsed.shares.filter(isStoredShare).slice(0, MAX_SHARES) : [] }; } catch { return { shares: [] }; }
}

async function writeStore(store: ShareStore): Promise<void> {
  await mkdir(dirname(SHARES_FILE), { recursive: true });
  const temporary = `${SHARES_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  try { await rename(temporary, SHARES_FILE); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error; await rm(SHARES_FILE, { force: true }); await rename(temporary, SHARES_FILE); }
}

function isStoredShare(value: unknown): value is StoredShare {
  const item = value as StoredShare;
  return Boolean(item && typeof item.id === "string" && item.id.startsWith("share:") && typeof item.ownerUserId === "string" && typeof item.ownerAccount === "string" && typeof item.recipientAccount === "string" && (item.scope === "result_only" || item.scope === "complete_task") && typeof item.sourceTaskId === "string" && Array.isArray(item.objects) && Array.isArray(item.internalObjects) && typeof item.createdAt === "string" && item.status === "active" && typeof item.internalWorkspacePath === "string");
}
