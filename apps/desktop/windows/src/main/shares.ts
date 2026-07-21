import { createHash, randomUUID } from "crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";
import type {
  DesktopBackgroundTask,
  DesktopShareAuditEntry,
  DesktopShareAuditListRequest,
  DesktopShareComment,
  DesktopShareCommentAddRequest,
  DesktopShareCommentListRequest,
  DesktopShareCommentTask,
  DesktopShareCommentTaskCompleteRequest,
  DesktopShareCommentTaskCreateRequest,
  DesktopShareCommentTaskListRequest,
  DesktopShareCommentTaskPreview,
  DesktopShareCommentTaskPreviewRequest,
  DesktopShareCommentTaskUpdateRequest,
  DesktopShareContinuationRequest,
  DesktopShareContinuationResult,
  DesktopShareCreateRequest,
  DesktopShareInspectionRequest,
  DesktopShareInspectionResult,
  DesktopShareManifest,
  DesktopShareManifestObject,
  DesktopSharePermission,
  DesktopSharePermissionUpdateRequest,
  DesktopShareRevokeRequest,
  DesktopShareRevocationResult,
  DesktopShareVersionInspection,
  DesktopShareVersionInspectionRequest,
  DesktopShareVersionPublishRequest,
  DesktopShareVersionPublishResult,
  DesktopSharedArtifactDownloadRequest,
  DesktopSharedArtifactDownloadResult,
  DesktopSharedObjectOpenRequest,
  DesktopSharedObjectOpenResult,
  DesktopTaskArtifactLink,
} from "../shared/desktopApi";
import { requireAuthContext } from "./auth";
import { enqueueBackgroundTask, listBackgroundTasks, listOwnedBackgroundTasks, updateBackgroundTask } from "./backgroundTasks";
import { DRSAI_HOME } from "./paths";
import {
  publicSensitiveFindings,
  sanitizeSensitiveText,
  scanSensitiveText,
  validateSensitiveResolutions,
  type SensitiveMatch,
} from "../../../shared/main/shareSensitivity";

const SHARES_FILE = resolve(DRSAI_HOME, "desktop", "shares.json");
const SHARES_LOCK_FILE = resolve(DRSAI_HOME, "desktop", "shares.lock");
const MAX_SHARES = 500;
const MAX_TEXT_PREVIEW_BYTES = 100_000;
const MAX_SHARED_DOWNLOAD_BYTES = 25 * 1024 * 1024;
const MAX_SENSITIVE_SCAN_BYTES = 5 * 1024 * 1024;
const SANITIZED_SHARES_DIR = resolve(DRSAI_HOME, "desktop", "sanitized-shares");
const MAX_SHARE_COMMENTS = 500;
const MAX_SHARE_AUDIT_ENTRIES = 2_000;
const MAX_SHARE_COMMENT_TASKS = 500;

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
    sourceArtifactPath?: string;
    sourceSha256?: string;
    sharedTaskTitle?: string;
  }>;
  comments: DesktopShareComment[];
  commentTasks: DesktopShareCommentTask[];
  continuations: DesktopShareContinuationResult[];
  audit: DesktopShareAuditEntry[];
}

interface ShareStore { shares: StoredShare[]; revision: number }

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
    publicObjects.push({ objectType: "task", objectId: task.id, label: sharedTaskTitle, version: 1 });
    internalObjects.push({ objectType: "task", objectId: task.id, sharedTaskTitle });
  }
  for (const scan of scans) {
    const { artifact } = scan;
    const sharedLabel = scan.labelMatches.length
      ? sanitizeSensitiveText(artifact.label, scan.labelMatches, resolutions)
      : artifact.label;
    let sharedFile = scan.file;
    if (scan.matches.length > 0 && scan.text !== undefined) {
      const sanitized = sanitizeSensitiveText(scan.text, scan.matches, resolutions);
      sharedFile = Buffer.from(sanitized, "utf8");
    }
    const versionDirectory = join(sanitizedDirectory, "v1");
    await mkdir(versionDirectory, { recursive: true });
    const sharedPath = join(versionDirectory, `${createHash("sha256").update(artifact.id).digest("hex").slice(0, 16)}${extname(scan.filePath) || ".bin"}`);
    await writeFile(sharedPath, sharedFile);
    publicObjects.push({
      objectType: "artifact",
      objectId: artifact.id,
      label: sharedLabel,
      kind: artifact.kind,
      bytes: sharedFile.byteLength,
      sha256: createHash("sha256").update(sharedFile).digest("hex"),
      version: 1,
    });
    internalObjects.push({ objectType: "artifact", objectId: artifact.id, artifactPath: sharedPath, sourceArtifactPath: scan.filePath, sourceSha256: createHash("sha256").update(scan.file).digest("hex") });
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
    version: 1,
    versionUpdatedAt: createdAt,
    versionUpdatedByAccount: ownerAccount,
    status: "active",
    permission: typed.permission ?? "view",
    comments: [],
    commentTasks: [],
    continuations: [],
    audit: [],
    sensitiveReview: {
      findingsCount: findings.reduce((sum, item) => sum + item.occurrences, 0),
      redactedCount: findings.filter((item) => resolutions.find((resolution) => resolution.findingId === item.id)?.action === "redact").reduce((sum, item) => sum + item.occurrences, 0),
      removedCount: findings.filter((item) => resolutions.find((resolution) => resolution.findingId === item.id)?.action === "remove").reduce((sum, item) => sum + item.occurrences, 0),
      highRiskSecretsDirectlyShared: 0,
    },
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
  return store.shares.filter((share) => share.status === "active" && identities.has(share.recipientAccount)).map(publicManifest);
}

export async function revokeShare(request: unknown): Promise<DesktopShareRevocationResult> {
  const typed = normalizeRevokeRequest(request);
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId);
  if (!share || share.ownerUserId !== auth.userId) {
    if (share) {
      appendAudit(share, actorAccount, "revoke", "denied", "Only the share owner can revoke access.");
      await writeStore(store);
    }
    throw new Error("Only the share owner can revoke this share.");
  }
  if (share.status === "revoked") throw new Error("This share has already been revoked.");
  const revokedAt = new Date().toISOString();
  share.status = "revoked";
  share.revokedAt = revokedAt;
  share.revokedByAccount = actorAccount;
  appendAudit(share, actorAccount, "revoke", "allowed", `Access revoked for ${share.objects.length} shared object(s).`);
  const auditEntryId = share.audit[share.audit.length - 1]!.id;
  await writeStore(store);
  await rm(join(SANITIZED_SHARES_DIR, share.id.slice("share:".length)), { recursive: true, force: true }).catch(() => undefined);
  return {
    shareId: share.id,
    status: "revoked",
    revokedAt,
    recipientAccount: share.recipientAccount,
    objectsInvalidated: share.objects.length,
    auditEntryId,
  };
}

export async function inspectShareVersion(request: unknown): Promise<DesktopShareVersionInspection> {
  const typed = normalizeShareIdRequest(request, "Share version inspection request is required.") as DesktopShareVersionInspectionRequest;
  const auth = await requireAuthContext();
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  if (!share || share.ownerUserId !== auth.userId) throw new Error("Only the share owner can inspect a new version.");
  const scans = await scanStoredShareSources(share);
  const currentVersion = shareVersion(share);
  const artifacts = scans.map((scan) => {
    const published = share.objects.find((item) => item.objectType === "artifact" && item.objectId === scan.artifact.id);
    const internal = share.internalObjects.find((item) => item.objectType === "artifact" && item.objectId === scan.artifact.id);
    const sourceSha256 = createHash("sha256").update(scan.file).digest("hex");
    return { objectId: scan.artifact.id, label: published?.label ?? scan.artifact.label, publishedSha256: published?.sha256 ?? "", sourceSha256, changed: internal?.sourceSha256 !== sourceSha256 };
  });
  const currentCommentCount = (share.comments ?? []).filter((comment) => (comment.version ?? 1) === currentVersion).length;
  return {
    shareId: share.id,
    currentVersion,
    nextVersion: currentVersion + 1,
    hasChanges: artifacts.some((item) => item.changed),
    currentCommentCount,
    commentsThatWillBecomeStale: currentCommentCount,
    sourceFingerprints: artifacts.map((item) => ({ objectId: item.objectId, sha256: item.sourceSha256 })),
    artifacts,
  };
}

export async function publishShareVersion(request: unknown): Promise<DesktopShareVersionPublishResult> {
  const typed = normalizeVersionPublishRequest(request);
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  if (!share || share.ownerUserId !== auth.userId) throw new Error("Only the share owner can publish a new version.");
  const previousVersion = shareVersion(share);
  if (typed.expectedVersion !== previousVersion) {
    appendAudit(share, actorAccount, "version_conflict", "denied", `Version conflict: expected v${typed.expectedVersion}, current v${previousVersion}.`);
    await writeStore(store);
    throw new Error(`Version conflict: this share is now v${previousVersion}. Refresh before publishing; no content was overwritten.`);
  }
  const scans = await scanStoredShareSources(share);
  const actualFingerprints = scans.map((scan) => ({ objectId: scan.artifact.id, sha256: createHash("sha256").update(scan.file).digest("hex") }));
  if (!sameFingerprints(typed.sourceFingerprints, actualFingerprints)) {
    appendAudit(share, actorAccount, "version_conflict", "denied", "Source changed after version preview.");
    await writeStore(store);
    throw new Error("Version conflict: the source changed after preview. Refresh before publishing; no content was overwritten.");
  }
  if (!actualFingerprints.some((fingerprint) => share.internalObjects.find((item) => item.objectId === fingerprint.objectId)?.sourceSha256 !== fingerprint.sha256)) {
    throw new Error("There are no source changes to publish.");
  }
  const findings = publicSensitiveFindings(scans.flatMap((item) => [...item.labelMatches, ...item.matches]));
  const resolutions = typed.sensitiveResolutions ?? [];
  validateSensitiveResolutions(findings, resolutions);
  const currentVersion = previousVersion + 1;
  const versionDirectory = join(SANITIZED_SHARES_DIR, share.id.slice("share:".length), `v${currentVersion}-${randomUUID()}`);
  try {
    await mkdir(versionDirectory, { recursive: true });
    for (const scan of scans) {
      const publicObject = share.objects.find((item) => item.objectType === "artifact" && item.objectId === scan.artifact.id);
      const internalObject = share.internalObjects.find((item) => item.objectType === "artifact" && item.objectId === scan.artifact.id);
      if (!publicObject || !internalObject) throw new Error("The shared version manifest is incomplete.");
      const sharedLabel = scan.labelMatches.length ? sanitizeSensitiveText(scan.artifact.label, scan.labelMatches, resolutions) : scan.artifact.label;
      const sharedFile = scan.matches.length > 0 && scan.text !== undefined ? Buffer.from(sanitizeSensitiveText(scan.text, scan.matches, resolutions), "utf8") : scan.file;
      const sharedPath = join(versionDirectory, `${createHash("sha256").update(scan.artifact.id).digest("hex").slice(0, 16)}${extname(scan.filePath) || ".bin"}`);
      await writeFile(sharedPath, sharedFile);
      publicObject.label = sharedLabel;
      publicObject.bytes = sharedFile.byteLength;
      publicObject.sha256 = createHash("sha256").update(sharedFile).digest("hex");
      publicObject.version = currentVersion;
      internalObject.artifactPath = sharedPath;
      internalObject.sourceSha256 = createHash("sha256").update(scan.file).digest("hex");
    }
    for (const object of share.objects) object.version = currentVersion;
    const publishedAt = new Date().toISOString();
    share.version = currentVersion;
    share.versionUpdatedAt = publishedAt;
    share.versionUpdatedByAccount = actorAccount;
    share.sensitiveReview = {
      findingsCount: findings.reduce((sum, item) => sum + item.occurrences, 0),
      redactedCount: findings.filter((item) => resolutions.find((resolution) => resolution.findingId === item.id)?.action === "redact").reduce((sum, item) => sum + item.occurrences, 0),
      removedCount: findings.filter((item) => resolutions.find((resolution) => resolution.findingId === item.id)?.action === "remove").reduce((sum, item) => sum + item.occurrences, 0),
      highRiskSecretsDirectlyShared: 0,
    };
    const staleCommentCount = (share.comments ?? []).filter((comment) => (comment.version ?? 1) < currentVersion).length;
    appendAudit(share, actorAccount, "version_publish", "allowed", `Published v${currentVersion}; ${staleCommentCount} comment(s) are now stale.`);
    await writeStore(store);
    return { status: "published", shareId: share.id, previousVersion, currentVersion, publishedAt, staleCommentCount, manifest: publicManifest(share) };
  } catch (error) {
    await rm(versionDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
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
  return (share.comments ?? []).map((item) => publicComment(share, item));
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
  const targetObject = share.objects.find((item) => item.objectId === typed.objectId) ?? share.objects.find((item) => item.objectType === "artifact") ?? share.objects[0];
  if (!targetObject) throw new Error("The shared comment target is unavailable.");
  const anchorType = typed.anchorType ?? "whole_result";
  const anchorLabel = typed.anchorLabel?.trim() || (anchorType === "chart" ? "Chart" : anchorType === "paragraph" ? "Paragraph" : targetObject.label);
  if (publicSensitiveFindings([
    ...scanSensitiveText(typed.body, `comment:${share.id}`, "评论内容"),
    ...scanSensitiveText(anchorLabel, `comment-anchor:${share.id}`, "评论位置"),
  ]).length > 0) {
    appendAudit(share, actorAccount, "comment", "denied", "Sensitive information was detected in the comment.");
    await writeStore(store);
    throw new Error("Remove sensitive information from the comment before sending it.");
  }
  const comment: DesktopShareComment = {
    id: `share-comment:${randomUUID()}`, shareId: share.id, authorAccount: actorAccount, body: typed.body,
    target: { objectType: targetObject.objectType, objectId: targetObject.objectId, objectLabel: targetObject.label, anchorType, anchorLabel },
    createdAt: new Date().toISOString(), version: shareVersion(share), versionStatus: "current",
  };
  share.comments = [...(share.comments ?? []), comment].slice(-MAX_SHARE_COMMENTS);
  appendAudit(share, actorAccount, "comment", "allowed", "Comment added.");
  await writeStore(store);
  return publicComment(share, comment);
}

export async function previewShareCommentTask(request: unknown): Promise<DesktopShareCommentTaskPreview> {
  const typed = normalizeCommentTaskReference(request);
  const auth = await requireAuthContext();
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  if (!share || share.ownerUserId !== auth.userId) throw new Error("Only the share owner can turn comments into tasks.");
  const comment = (share.comments ?? []).find((item) => item.id === typed.commentId);
  if (!comment) throw new Error("The shared comment was not found.");
  return buildCommentTaskPreview(share, comment);
}

export async function createShareCommentTask(request: unknown): Promise<DesktopShareCommentTask> {
  const typed = normalizeCommentTaskCreateRequest(request);
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const share = store.shares.find((item) => item.id === typed.shareId && item.status === "active");
  if (!share || share.ownerUserId !== auth.userId) {
    if (share) { appendAudit(share, actorAccount, "comment_task", "denied", "Only the share owner can create a comment task."); await writeStore(store); }
    throw new Error("Only the share owner can turn comments into tasks.");
  }
  const comment = (share.comments ?? []).find((item) => item.id === typed.commentId);
  if (!comment) throw new Error("The shared comment was not found.");
  if ((share.commentTasks ?? []).some((item) => item.commentId === comment.id)) throw new Error("This comment already has a task.");
  validateSafeCommentTaskText(typed.title, typed.instructions);
  const now = new Date().toISOString();
  const taskId = `share-comment-task:${randomUUID()}`;
  const background = await enqueueBackgroundTask({
    kind: "agent_run", source: "manual", title: typed.title, workspacePath: share.internalWorkspacePath,
    targetId: taskId, status: "queued", progress: 0, currentStep: "Review the linked comment and source result.",
    message: typed.instructions, verification: `Complete the requested change and preserve the backlink to ${comment.id}.`,
  });
  const preview = buildCommentTaskPreview(share, comment);
  const task: DesktopShareCommentTask = {
    id: taskId, shareId: share.id, commentId: comment.id, backgroundTaskId: background.id,
    title: typed.title, instructions: typed.instructions, commentBody: comment.body,
    commentAuthorAccount: comment.authorAccount, target: preview.target, status: "ready", createdAt: now, updatedAt: now,
  };
  share.commentTasks = [...(share.commentTasks ?? []), task].slice(-MAX_SHARE_COMMENT_TASKS);
  appendAudit(share, actorAccount, "comment_task", "allowed", "Comment task created.");
  await writeStore(store);
  return cloneCommentTask(task);
}

export async function updateShareCommentTask(request: unknown): Promise<DesktopShareCommentTask> {
  const typed = normalizeCommentTaskUpdateRequest(request);
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const found = findCommentTask(store, typed.taskId);
  if (!found || found.share.ownerUserId !== auth.userId) {
    if (found) { appendAudit(found.share, actorAccount, "comment_task", "denied", "Only the share owner can update a comment task."); await writeStore(store); }
    throw new Error("Only the share owner can update this comment task.");
  }
  if (found.task.status === "completed") throw new Error("A completed comment task cannot be changed.");
  validateSafeCommentTaskText(typed.title, typed.instructions);
  found.task.title = typed.title;
  found.task.instructions = typed.instructions;
  found.task.updatedAt = new Date().toISOString();
  await updateBackgroundTask({ taskId: found.task.backgroundTaskId, status: "queued", title: typed.title, message: typed.instructions });
  appendAudit(found.share, actorAccount, "comment_task", "allowed", "Comment task updated.");
  await writeStore(store);
  return cloneCommentTask(found.task);
}

export async function completeShareCommentTask(request: unknown): Promise<DesktopShareCommentTask> {
  const typed = normalizeCommentTaskCompleteRequest(request);
  const auth = await requireAuthContext();
  const actorAccount = normalizeAccount(auth.session.user?.email || auth.userId);
  const store = await readStore();
  const found = findCommentTask(store, typed.taskId);
  if (!found || found.share.ownerUserId !== auth.userId) {
    if (found) { appendAudit(found.share, actorAccount, "comment_task", "denied", "Only the share owner can complete a comment task."); await writeStore(store); }
    throw new Error("Only the share owner can complete this comment task.");
  }
  if (found.task.status !== "completed") {
    const completedAt = new Date().toISOString();
    found.task.status = "completed";
    found.task.completedAt = completedAt;
    found.task.updatedAt = completedAt;
    await updateBackgroundTask({ taskId: found.task.backgroundTaskId, status: "completed", title: found.task.title, progress: 100, currentStep: "Completed from shared comment.", message: found.task.instructions, verification: `Result remains linked to comment ${found.task.commentId}.` });
    appendAudit(found.share, actorAccount, "comment_task", "allowed", "Comment task completed.");
    await writeStore(store);
  }
  return cloneCommentTask(found.task);
}

export async function listShareCommentTasks(request: unknown = {}): Promise<DesktopShareCommentTask[]> {
  const typed = normalizeCommentTaskListRequest(request);
  const auth = await requireAuthContext();
  const store = await readStore();
  return store.shares
    .filter((share) => share.ownerUserId === auth.userId && (!typed.shareId || share.id === typed.shareId))
    .flatMap((share) => (share.commentTasks ?? []).map(cloneCommentTask))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    await assertRecipientShareActive(share.id, identities);
    return {
      shareId: share.id, version: shareVersion(share), objectType: "task", objectId: task.id, label: internal.sharedTaskTitle || allowed.label, authorized: true,
      task: { id: task.id, title: internal.sharedTaskTitle || allowed.label, status: task.status, updatedAt: task.updatedAt, artifactIds: share.objects.filter((item) => item.objectType === "artifact").map((item) => item.objectId) },
    };
  }
  const artifact = findArtifact(await listBackgroundTasks({ limit: 100 }), share.sourceTaskId, typed.objectId);
  if (!artifact || !internal.artifactPath) throw new Error("The shared result is no longer available.");
  const file = await readFile(internal.artifactPath);
  await assertRecipientShareActive(share.id, identities);
  const content = isTextArtifact(artifact, internal.artifactPath) && file.byteLength <= MAX_TEXT_PREVIEW_BYTES ? file.toString("utf8") : undefined;
  return {
    shareId: share.id, version: shareVersion(share), objectType: "artifact", objectId: artifact.id, label: allowed.label, authorized: true,
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
  await assertRecipientShareActive(share.id, identities);
  return {
    shareId: share.id,
    version: shareVersion(share),
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

function normalizeRevokeRequest(request: unknown): DesktopShareRevokeRequest {
  if (!request || typeof request !== "object") throw new Error("Share revocation request is required.");
  const value = request as Partial<DesktopShareRevokeRequest>;
  const shareId = required(value.shareId, "Share id is required.");
  if (value.confirmation !== "REVOKE") throw new Error("Type REVOKE to confirm permanent access revocation.");
  return { shareId, confirmation: "REVOKE" };
}

function normalizeVersionPublishRequest(request: unknown): DesktopShareVersionPublishRequest {
  if (!request || typeof request !== "object") throw new Error("Share version publish request is required.");
  const value = request as Partial<DesktopShareVersionPublishRequest>;
  const shareId = required(value.shareId, "Share id is required.");
  if (!Number.isInteger(value.expectedVersion) || Number(value.expectedVersion) < 1) throw new Error("Expected share version is invalid.");
  if (!Array.isArray(value.sourceFingerprints) || value.sourceFingerprints.length === 0) throw new Error("Source version fingerprints are required.");
  const sourceFingerprints = value.sourceFingerprints.map((item) => ({
    objectId: required(item?.objectId, "Version object id is required."),
    sha256: typeof item?.sha256 === "string" && /^[a-f0-9]{64}$/i.test(item.sha256) ? item.sha256.toLowerCase() : (() => { throw new Error("Source version fingerprint is invalid."); })(),
  }));
  if (new Set(sourceFingerprints.map((item) => item.objectId)).size !== sourceFingerprints.length) throw new Error("Duplicate version fingerprints are not allowed.");
  const sensitiveResolutions = normalizeSensitiveResolutions(value.sensitiveResolutions);
  return { shareId, expectedVersion: Number(value.expectedVersion), sourceFingerprints, ...(sensitiveResolutions.length ? { sensitiveResolutions } : {}) };
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
  const value = request as Partial<DesktopShareCommentAddRequest>;
  const rawBody = value.body;
  if (typeof rawBody !== "string") throw new Error("Comment text is required.");
  const body = rawBody.trim();
  if (!body) throw new Error("Comment text is required.");
  if (body.length > 2_000) throw new Error("Comments are limited to 2,000 characters.");
  const objectId = typeof value.objectId === "string" && value.objectId.trim() ? required(value.objectId, "Comment object id is invalid.") : undefined;
  const anchorType = value.anchorType;
  if (anchorType !== undefined && anchorType !== "whole_result" && anchorType !== "paragraph" && anchorType !== "chart") throw new Error("Comment anchor type is invalid.");
  const anchorLabel = typeof value.anchorLabel === "string" && value.anchorLabel.trim() ? normalizeTaskText(value.anchorLabel, "Comment anchor label is invalid.", 300) : undefined;
  return { shareId: share.shareId, body, ...(objectId ? { objectId } : {}), ...(anchorType ? { anchorType } : {}), ...(anchorLabel ? { anchorLabel } : {}) };
}

function normalizeCommentTaskReference(request: unknown): DesktopShareCommentTaskPreviewRequest {
  if (!request || typeof request !== "object") throw new Error("Comment task preview request is required.");
  const value = request as Partial<DesktopShareCommentTaskPreviewRequest>;
  return { shareId: required(value.shareId, "Share id is required."), commentId: required(value.commentId, "Comment id is required.") };
}

function normalizeCommentTaskCreateRequest(request: unknown): DesktopShareCommentTaskCreateRequest {
  const reference = normalizeCommentTaskReference(request);
  const value = request as Partial<DesktopShareCommentTaskCreateRequest>;
  return { ...reference, title: normalizeTaskText(value.title, "Task title is required.", 160), instructions: normalizeTaskText(value.instructions, "Task instructions are required.", 4_000) };
}

function normalizeCommentTaskUpdateRequest(request: unknown): DesktopShareCommentTaskUpdateRequest {
  if (!request || typeof request !== "object") throw new Error("Comment task update request is required.");
  const value = request as Partial<DesktopShareCommentTaskUpdateRequest>;
  return { taskId: required(value.taskId, "Comment task id is required."), title: normalizeTaskText(value.title, "Task title is required.", 160), instructions: normalizeTaskText(value.instructions, "Task instructions are required.", 4_000) };
}

function normalizeCommentTaskCompleteRequest(request: unknown): DesktopShareCommentTaskCompleteRequest {
  if (!request || typeof request !== "object") throw new Error("Comment task completion request is required.");
  return { taskId: required((request as Partial<DesktopShareCommentTaskCompleteRequest>).taskId, "Comment task id is required.") };
}

function normalizeCommentTaskListRequest(request: unknown): DesktopShareCommentTaskListRequest {
  if (!request || typeof request !== "object") throw new Error("Comment task list request is invalid.");
  const shareId = (request as Partial<DesktopShareCommentTaskListRequest>).shareId;
  return typeof shareId === "string" && shareId.trim() ? { shareId: required(shareId, "Share id is invalid.") } : {};
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

async function scanStoredShareSources(share: StoredShare): Promise<ArtifactSensitivityScan[]> {
  const tasks = await listOwnedBackgroundTasks();
  const task = tasks.find((item) => item.id === share.sourceTaskId);
  if (!task) throw new Error("The source task for this share is unavailable.");
  const artifacts = share.objects.filter((item) => item.objectType === "artifact").map((object) => {
    const artifact = findArtifact(tasks, share.sourceTaskId, object.objectId);
    if (!artifact) throw new Error(`The source artifact ${object.objectId} is unavailable.`);
    return artifact;
  });
  return Promise.all(artifacts.map(async (artifact) => {
    const internal = share.internalObjects.find((item) => item.objectType === "artifact" && item.objectId === artifact.id);
    if (!internal?.sourceArtifactPath) throw new Error("This legacy share has no source snapshot link; create a new share before publishing a version.");
    const filePath = safeArtifactPath(share.internalWorkspacePath, internal.sourceArtifactPath);
    const file = await readFile(filePath);
    if (file.byteLength > MAX_SHARED_DOWNLOAD_BYTES) throw new Error("The source result is too large to publish as a shared version.");
    const text = isTextArtifact(artifact, filePath) && file.byteLength <= MAX_SENSITIVE_SCAN_BYTES ? file.toString("utf8") : undefined;
    const findingArtifactLabel = artifact.label;
    const labelMatches = scanSensitiveText(artifact.label, artifact.id, findingArtifactLabel);
    const matches = text === undefined ? [] : scanSensitiveText(text, artifact.id, findingArtifactLabel);
    return { artifact, filePath, file, text, matches, labelMatches };
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

function publicComment(share: StoredShare, comment: DesktopShareComment): DesktopShareComment {
  const fallback = share.objects.find((item) => item.objectType === "artifact") ?? share.objects[0];
  const target = comment.target ?? {
    objectType: fallback?.objectType ?? "artifact",
    objectId: fallback?.objectId ?? "missing-object",
    objectLabel: fallback?.label ?? "Shared result",
    anchorType: "whole_result" as const,
    anchorLabel: fallback?.label ?? "Shared result",
  };
  const version = comment.version ?? 1;
  return { ...comment, version, versionStatus: version === shareVersion(share) ? "current" : "stale", target: { ...target } };
}

function buildCommentTaskPreview(share: StoredShare, rawComment: DesktopShareComment): DesktopShareCommentTaskPreview {
  const comment = publicComment(share, rawComment);
  const anchor = comment.target.anchorLabel;
  return {
    shareId: share.id,
    commentId: comment.id,
    title: `处理评论：${anchor}`.slice(0, 160),
    instructions: `针对成果“${comment.target.objectLabel}”的${comment.target.anchorType === "chart" ? "图表" : comment.target.anchorType === "paragraph" ? "段落" : "整体成果"}“${anchor}”，处理来自 ${comment.authorAccount} 的评论：\n${comment.body}`,
    commentBody: comment.body,
    commentAuthorAccount: comment.authorAccount,
    target: { ...comment.target },
  };
}

function validateSafeCommentTaskText(title: string, instructions: string): void {
  const findings = publicSensitiveFindings([
    ...scanSensitiveText(title, "comment-task-title", "评论任务标题"),
    ...scanSensitiveText(instructions, "comment-task-instructions", "评论任务说明"),
  ]);
  if (findings.length > 0) throw new Error("Remove sensitive information before creating the comment task.");
}

function normalizeTaskText(value: unknown, message: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(message);
  const text = value.trim();
  if (!text || text.length > maxLength) throw new Error(message);
  return text;
}

function findCommentTask(store: ShareStore, taskId: string): { share: StoredShare; task: DesktopShareCommentTask } | undefined {
  for (const share of store.shares) {
    const task = (share.commentTasks ?? []).find((item) => item.id === taskId);
    if (task) return { share, task };
  }
  return undefined;
}

function cloneCommentTask(task: DesktopShareCommentTask): DesktopShareCommentTask { return { ...task, target: { ...task.target } }; }

function shareVersion(share: Pick<DesktopShareManifest, "version">): number { return Number.isInteger(share.version) && share.version > 0 ? share.version : 1; }

function sameFingerprints(left: Array<{ objectId: string; sha256: string }>, right: Array<{ objectId: string; sha256: string }>): boolean {
  if (left.length !== right.length) return false;
  const expected = new Map(left.map((item) => [item.objectId, item.sha256.toLowerCase()]));
  return right.every((item) => expected.get(item.objectId) === item.sha256.toLowerCase());
}

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

async function assertRecipientShareActive(shareId: string, identities: Set<string>): Promise<void> {
  const current = (await readStore()).shares.find((item) => item.id === shareId && item.status === "active");
  if (!current || !identities.has(current.recipientAccount)) {
    throw new Error("This shared result has been revoked or is no longer available.");
  }
}

function normalizeAccount(value: string): string { return value.trim().toLowerCase(); }
function safeFileName(value: string): string { const name = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_"); return name || "shared-result"; }
function required(value: unknown, message: string): string { if (typeof value !== "string" || !value.trim() || value.length > 300 || /[\r\n]/.test(value)) throw new Error(message); return value.trim(); }
function publicManifest(share: StoredShare): DesktopShareManifest { const { id, ownerAccount, recipientAccount, scope, sourceTaskId, selectedArtifactId, createdAt, status, revokedAt, revokedByAccount, sensitiveReview } = share; const version = shareVersion(share); return { id, ownerAccount, recipientAccount, scope, sourceTaskId, permission: share.permission ?? "view", ...(selectedArtifactId ? { selectedArtifactId } : {}), objects: share.objects.map((item) => ({ ...item, version: item.version ?? version })), createdAt, version, versionUpdatedAt: share.versionUpdatedAt ?? createdAt, versionUpdatedByAccount: share.versionUpdatedByAccount ?? ownerAccount, status, ...(revokedAt ? { revokedAt } : {}), ...(revokedByAccount ? { revokedByAccount } : {}), ...(sensitiveReview ? { sensitiveReview: { ...sensitiveReview } } : {}) }; }

async function readStore(): Promise<ShareStore> {
  try { const parsed = JSON.parse(await readFile(SHARES_FILE, "utf8")) as Partial<ShareStore>; return { shares: Array.isArray(parsed.shares) ? parsed.shares.filter(isStoredShare).slice(0, MAX_SHARES) : [], revision: Number.isInteger(parsed.revision) && Number(parsed.revision) >= 0 ? Number(parsed.revision) : 0 }; } catch { return { shares: [], revision: 0 }; }
}

async function writeStore(store: ShareStore): Promise<void> {
  await mkdir(dirname(SHARES_FILE), { recursive: true });
  const release = await acquireShareStoreLock();
  try {
    let currentRevision = 0;
    try { const current = JSON.parse(await readFile(SHARES_FILE, "utf8")) as Partial<ShareStore>; currentRevision = Number.isInteger(current.revision) && Number(current.revision) >= 0 ? Number(current.revision) : 0; } catch { currentRevision = 0; }
    if (currentRevision !== store.revision) throw new Error("Share conflict: another window changed collaboration data. Refresh and retry; no changes were overwritten.");
    store.revision = currentRevision + 1;
    const temporary = `${SHARES_FILE}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    try { await rename(temporary, SHARES_FILE); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error; await rm(SHARES_FILE, { force: true }); await rename(temporary, SHARES_FILE); }
  } finally {
    await release();
  }
}

async function acquireShareStoreLock(): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const handle = await open(SHARES_LOCK_FILE, "wx");
      return async () => { await handle.close().catch(() => undefined); await rm(SHARES_LOCK_FILE, { force: true }).catch(() => undefined); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(SHARES_LOCK_FILE);
        if (Date.now() - lockStat.mtimeMs > 30_000) { await rm(SHARES_LOCK_FILE, { force: true }); continue; }
      } catch { continue; }
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
  throw new Error("Share conflict: collaboration data is busy in another window. Refresh and retry; no changes were overwritten.");
}

function isStoredShare(value: unknown): value is StoredShare {
  const item = value as StoredShare;
  return Boolean(item && typeof item.id === "string" && item.id.startsWith("share:") && typeof item.ownerUserId === "string" && typeof item.ownerAccount === "string" && typeof item.recipientAccount === "string" && (item.scope === "result_only" || item.scope === "complete_task") && typeof item.sourceTaskId === "string" && Array.isArray(item.objects) && Array.isArray(item.internalObjects) && typeof item.createdAt === "string" && (item.status === "active" || item.status === "revoked") && (item.revokedAt === undefined || typeof item.revokedAt === "string") && (item.revokedByAccount === undefined || typeof item.revokedByAccount === "string") && typeof item.internalWorkspacePath === "string");
}
