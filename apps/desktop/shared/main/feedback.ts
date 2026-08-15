import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import type { FeedbackAdminRecord, FeedbackDraft, FeedbackPackagePreview, FeedbackStatus, FeedbackSubmitResult, PendingFeedbackItem } from "../api/feedback";
import { DRSAI_HOME } from "./paths";
import { desktopDiagnostics } from "./diagnostics";
import { getGatewayRequestHeaders, getGatewaySnapshot, startGateway } from "./gateway";
import { replaceFileSafely } from "./atomicFileReplace";
import { latestCrashDumpBase64 } from "./crashFeedback";

const ROOT = join(DRSAI_HOME, "desktop", "feedback");
const QUEUE_FILE = join(ROOT, "pending.enc.json");
const KEY_FILE = join(ROOT, "queue.key");
const MAX_PENDING = 100;
const MAX_DESCRIPTION = 8_000;
const MAX_BREADCRUMBS = 100;

interface QueueEnvelope { version: 1; iv: string; authTag: string; payload: string }
interface QueuedFeedback { draft: FeedbackDraft; created_at: string; attempts: number; last_error?: string }
interface PreparedFeedback { payload: Record<string, unknown>; preview: FeedbackPackagePreview }

export class DesktopFeedbackService {
  private operation: Promise<unknown> = Promise.resolve();

  constructor() {
    void recordFeedbackMetric("feedback_entry_exposed", "Feedback entry is available");
  }

  preview(draft: FeedbackDraft): Promise<FeedbackPackagePreview> {
    return this.prepare(draft).then(async (value) => {
      await recordFeedbackMetric("feedback_opened", "Feedback panel opened", draft);
      return value.preview;
    });
  }

  submit(draft: FeedbackDraft): Promise<FeedbackSubmitResult> {
    return this.serial(async () => {
      const prepared = await this.prepare(draft);
      try {
        const result = await this.transmit(draft.client_feedback_id, prepared.payload);
        await recordFeedbackMetric("feedback_submitted", "Feedback submitted", draft);
        return result;
      } catch (error) {
        await recordFeedbackMetric("feedback_submit_failed", "Feedback submission failed", draft, "waiting");
        await this.enqueue(draft, error);
        await recordFeedbackMetric("feedback_queued", "Feedback queued for retry", draft, "waiting");
        return {
          client_feedback_id: draft.client_feedback_id,
          status: "queued",
          queued: true,
          idempotent_replay: false,
          message: "Feedback is encrypted on this device and will retry when the Runtime is available.",
        };
      }
    });
  }

  flush(): Promise<{ sent: number; remaining: number }> {
    return this.serial(async () => {
      const queue = await this.readQueue();
      const remaining: QueuedFeedback[] = [];
      let sent = 0;
      for (const item of queue) {
        try {
          const prepared = await this.prepare(item.draft);
          await this.transmit(item.draft.client_feedback_id, prepared.payload);
          sent += 1;
        } catch (error) {
          remaining.push({ ...item, attempts: item.attempts + 1, last_error: safeError(error) });
        }
      }
      await this.writeQueue(remaining);
      if (sent > 0) await recordFeedbackMetric("feedback_retry_succeeded", "Queued feedback retry succeeded", undefined, "completed", { sent });
      if (remaining.length > 0) await recordFeedbackMetric("feedback_retry_failed", "Queued feedback retry remains pending", undefined, "waiting", { remaining: remaining.length });
      return { sent, remaining: remaining.length };
    });
  }

  listPending(): Promise<PendingFeedbackItem[]> {
    return this.readQueue().then((queue) => queue.map((item) => ({
      client_feedback_id: item.draft.client_feedback_id,
      created_at: item.created_at,
      category: item.draft.category,
      source: item.draft.source,
      attempts: item.attempts,
      last_error: item.last_error,
    })));
  }

  deletePending(clientFeedbackId: string): Promise<boolean> {
    return this.serial(async () => {
      const queue = await this.readQueue();
      const next = queue.filter((item) => item.draft.client_feedback_id !== clientFeedbackId);
      if (next.length === queue.length) return false;
      await this.writeQueue(next);
      return true;
    });
  }

  async listAdmin(status?: FeedbackStatus): Promise<FeedbackAdminRecord[]> {
    const response = await this.gatewayRequest(`/v1/feedback${status ? `?status=${encodeURIComponent(status)}` : ""}`);
    return (await response.json() as { items?: FeedbackAdminRecord[] }).items ?? [];
  }

  async updateAdmin(feedbackId: string, update: { status: FeedbackStatus; fixed_in_version?: string; recommended_owner?: string; note?: string }): Promise<FeedbackAdminRecord> {
    const response = await this.gatewayRequest(`/v1/feedback/${encodeURIComponent(feedbackId)}/status`, { method: "POST", body: JSON.stringify(update) });
    return await response.json() as FeedbackAdminRecord;
  }

  async deleteAdmin(feedbackId: string): Promise<boolean> {
    await this.gatewayRequest(`/v1/feedback/${encodeURIComponent(feedbackId)}`, { method: "DELETE" });
    return true;
  }

  private async prepare(input: FeedbackDraft): Promise<PreparedFeedback> {
    const draft = validateDraft(input);
    if (process.env.OPENDRSAI_FEEDBACK_DISABLED === "1") throw new Error("Feedback transmission is disabled by enterprise policy.");
    if (draft.consent.screenshot && process.env.OPENDRSAI_FEEDBACK_ALLOW_SCREENSHOT === "0") throw new Error("Screenshot attachments are disabled by enterprise policy.");
    if (draft.consent.diagnostics && process.env.OPENDRSAI_FEEDBACK_ALLOW_DIAGNOSTICS === "0") throw new Error("Diagnostic attachments are disabled by enterprise policy.");
    const snapshot = draft.consent.diagnostics ? JSON.parse(await desktopDiagnostics.serializeExport()) : undefined;
    const redactedDescription = redact(draft.user_description);
    const diagnosticEvents = Array.isArray(snapshot?.snapshot?.events) ? snapshot.snapshot.events : [];
    const generatedBreadcrumbs = diagnosticEvents.slice(-MAX_BREADCRUMBS).map((event: Record<string, unknown>) => ({
      timestamp: event.timestamp,
      module: event.module,
      operation: event.operation,
      status: event.status,
      error_code: event.errorCode,
    }));
    const redactedContext = redact({
      module: draft.context.module || "unknown",
      page: draft.context.page || "unknown",
      app_version: draft.context.app_version || "unknown",
      runtime_version: draft.context.runtime_version || "unknown",
      electron_version: draft.context.electron_version || process.versions.electron || "unknown",
      platform: draft.context.platform || process.platform,
      locale: draft.context.locale || "unknown",
      workspace_id: draft.context.workspace_id,
      thread_id: draft.context.thread_id,
      run_id: draft.context.run_id,
      trace_id: draft.context.trace_id,
      error_code: draft.context.error_code,
      error_type: draft.context.error_type,
      breadcrumbs: (draft.context.breadcrumbs?.length ? draft.context.breadcrumbs : generatedBreadcrumbs).slice(-MAX_BREADCRUMBS),
    });
    const diagnosticsSource = snapshot === undefined ? undefined : (draft.consent.detailed_logs ? snapshot : basicDiagnosticSummary(snapshot));
    const diagnostics = diagnosticsSource === undefined ? undefined : redact(diagnosticsSource);
    const crashDump = draft.source === "recovery" && draft.consent.diagnostics ? await latestCrashDumpBase64() : null;
    const attachmentManifest: FeedbackPackagePreview["attachment_manifest"] = [];
    if (diagnostics) attachmentManifest.push({ kind: "diagnostics", name: "OpenDrSai diagnostic snapshot", byte_length: Buffer.byteLength(JSON.stringify(diagnostics.value)), requires_explicit_consent: false });
    if (diagnostics && draft.consent.detailed_logs) attachmentManifest.push({ kind: "detailed_logs", name: "Redacted diagnostic history", byte_length: Buffer.byteLength(JSON.stringify(diagnostics.value)), requires_explicit_consent: true });
    if (draft.consent.screenshot && draft.screenshot_data_url) attachmentManifest.push({ kind: "screenshot", name: "Redacted current window", byte_length: Buffer.byteLength(draft.screenshot_data_url), requires_explicit_consent: true });
    if (crashDump) attachmentManifest.push({ kind: "crash_dump", name: crashDump.name, byte_length: crashDump.byteLength, requires_explicit_consent: false });
    const payload = {
      client_feedback_id: draft.client_feedback_id,
      category: draft.category,
      source: draft.source,
      user_description: redactedDescription.value,
      contact_address: draft.consent.contact ? draft.contact_address : undefined,
      context: redactedContext.value,
      consent: draft.consent,
      diagnostics: diagnostics?.value,
      screenshot_data_url: draft.consent.screenshot ? draft.screenshot_data_url : undefined,
      crash_dump_base64: crashDump?.data,
      crash_dump_name: crashDump?.name,
      attachment_manifest: attachmentManifest,
    };
    const encoded = JSON.stringify(payload);
    return {
      payload,
      preview: {
        client_feedback_id: draft.client_feedback_id,
        category: draft.category,
        source: draft.source,
        data_categories: ["feedback", "app_environment", "correlation_ids", ...(diagnostics ? [draft.consent.detailed_logs ? "redacted_detailed_diagnostics" : "redacted_diagnostic_summary"] : [])],
        attachment_manifest: payload.attachment_manifest as FeedbackPackagePreview["attachment_manifest"],
        estimated_byte_length: Buffer.byteLength(encoded),
        sensitive_matches_removed: redactedDescription.removed + redactedContext.removed + (diagnostics?.removed || 0),
        retention_days: 30,
        includes_screenshot: draft.consent.screenshot,
        includes_conversation_context: draft.consent.conversation_context,
        warnings: [
          ...(draft.consent.screenshot ? ["Screenshot capture is not attached until the explicit capture step succeeds."] : []),
          ...(draft.consent.conversation_context ? ["Conversation context requires a separate explicit attachment."] : []),
        ],
      },
    };
  }

  private async transmit(clientFeedbackId: string, payload: Record<string, unknown>): Promise<FeedbackSubmitResult> {
    const configuredUrl = process.env.OPENDRSAI_FEEDBACK_SERVICE_URL?.trim().replace(/\/$/, "");
    if (!configuredUrl && !await startGateway()) throw new Error("Runtime is unavailable.");
    const baseUrl = configuredUrl || getGatewaySnapshot().baseUrl;
    const intakeToken = process.env.OPENDRSAI_FEEDBACK_INTAKE_TOKEN?.trim();
    const response = await fetch(`${baseUrl}/v1/feedback`, {
      method: "POST",
      headers: {
        ...(configuredUrl ? {} : getGatewayRequestHeaders()),
        ...(configuredUrl && intakeToken ? { Authorization: `Bearer ${intakeToken}` } : {}),
        "Content-Type": "application/json",
        "Idempotency-Key": clientFeedbackId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Feedback service returned HTTP ${response.status}.`);
    const result = await response.json() as { feedback_id?: string; status?: string; idempotent_replay?: boolean };
    return {
      feedback_id: result.feedback_id,
      client_feedback_id: clientFeedbackId,
      status: (result.status as FeedbackSubmitResult["status"]) || "received",
      queued: false,
      idempotent_replay: result.idempotent_replay === true,
      message: result.idempotent_replay ? "Feedback was already received." : "Feedback received. Thank you.",
    };
  }

  private async gatewayRequest(path: string, init: RequestInit = {}): Promise<Response> {
    if (!await startGateway()) throw new Error("Runtime is unavailable.");
    const adminToken = process.env.OPENDRSAI_FEEDBACK_ADMIN_TOKEN?.trim();
    if (!adminToken) throw new Error("Feedback console is not configured for this installation.");
    const response = await fetch(`${getGatewaySnapshot().baseUrl}${path}`, { ...init, headers: { ...getGatewayRequestHeaders(), "Content-Type": "application/json", "X-OpenDrSai-Feedback-Admin": adminToken, ...(init.headers || {}) }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Feedback service returned HTTP ${response.status}.`);
    return response;
  }

  private async enqueue(draft: FeedbackDraft, error: unknown): Promise<void> {
    const queue = await this.readQueue();
    if (queue.some((item) => item.draft.client_feedback_id === draft.client_feedback_id)) return;
    queue.push({ draft, created_at: new Date().toISOString(), attempts: 0, last_error: safeError(error) });
    await this.writeQueue(queue.slice(-MAX_PENDING));
  }

  private async readQueue(): Promise<QueuedFeedback[]> {
    try {
      const envelope = JSON.parse(await readFile(QUEUE_FILE, "utf8")) as QueueEnvelope;
      if (envelope.version !== 1) return [];
      const decipher = createDecipheriv("aes-256-gcm", await this.key(), Buffer.from(envelope.iv, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
      const clear = Buffer.concat([decipher.update(Buffer.from(envelope.payload, "base64")), decipher.final()]);
      const value = JSON.parse(clear.toString("utf8"));
      return Array.isArray(value) ? value.slice(-MAX_PENDING) : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      await rename(QUEUE_FILE, `${QUEUE_FILE}.corrupt-${Date.now()}`).catch(() => undefined);
      return [];
    }
  }

  private async writeQueue(queue: QueuedFeedback[]): Promise<void> {
    await mkdir(ROOT, { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(queue), "utf8"), cipher.final()]);
    await atomicJson(QUEUE_FILE, { version: 1, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), payload: encrypted.toString("base64") });
  }

  private async key(): Promise<Buffer> {
    try {
      const existing = Buffer.from(await readFile(KEY_FILE, "utf8"), "base64");
      if (existing.length === 32) return existing;
    } catch { /* create below */ }
    await mkdir(ROOT, { recursive: true });
    const value = randomBytes(32);
    await writeFile(KEY_FILE, value.toString("base64"), { encoding: "utf8", mode: 0o600 });
    return value;
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }
}

function basicDiagnosticSummary(snapshot: any): Record<string, unknown> {
  const detail = snapshot?.snapshot ?? {};
  const events = Array.isArray(detail.events) ? detail.events.slice(-20).map((event: Record<string, unknown>) => ({
    timestamp: event.timestamp, module: event.module, component: event.component,
    operation: event.operation, status: event.status, errorCode: event.errorCode, fingerprint: event.fingerprint,
  })) : [];
  const health = Array.isArray(detail.health) ? detail.health.slice(0, 100).map((item: Record<string, unknown>) => ({
    id: item.id, status: item.status, component: item.component,
  })) : [];
  return {
    product: snapshot?.product, schemaVersion: snapshot?.schemaVersion, exportedAt: snapshot?.exportedAt,
    snapshot: { generatedAt: detail.generatedAt, events, health, droppedEvents: detail.droppedEvents, storage: detail.storage },
  };
}

async function recordFeedbackMetric(
  operation: string,
  message: string,
  draft?: FeedbackDraft,
  status: "completed" | "waiting" = "completed",
  attributes: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  await desktopDiagnostics.record({
    kind: "log",
    level: status === "waiting" ? "warn" : "info",
    status,
    module: "feedback",
    component: "desktop-feedback",
    operation,
    message,
    domain: "app",
    visibility: "detail",
    attributes: {
      category: draft?.category ?? "unknown",
      source: draft?.source ?? "unknown",
      ...attributes,
    },
  }).catch(() => undefined);
}

function validateDraft(input: FeedbackDraft): FeedbackDraft {
  if (!input || typeof input !== "object") throw new Error("Feedback draft is required.");
  if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(input.client_feedback_id || "")) throw new Error("Feedback id is invalid.");
  if (!["bug", "usability", "suggestion", "feature_request"].includes(input.category)) throw new Error("Feedback category is invalid.");
  if (!["global", "error", "message", "tool", "crash", "recovery"].includes(input.source)) throw new Error("Feedback source is invalid.");
  const description = String(input.user_description || "").trim().slice(0, MAX_DESCRIPTION);
  if (["suggestion", "feature_request"].includes(input.category) && !description) throw new Error("A short description is required.");
  return { ...input, user_description: description, context: input.context || {}, consent: { ...input.consent } };
}

function redact(input: unknown): { value: any; removed: number } {
  let removed = 0;
  const replace = (): string => { removed += 1; return "[REDACTED]"; };
  const visit = (value: unknown, key = ""): unknown => {
    if (/token|secret|password|cookie|authorization|api.?key|credential|private.?key/i.test(key)) return replace();
    if (typeof value === "string") return value
      .replace(/\bBearer\s+[^\s"']+|(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{8,}|\b(?:token|secret|password|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, replace)
      .replace(/(?:[A-Za-z]:\\Users\\[^\\\s]+|\/Users\/[^/\s]+|\/home\/[^/\s]+)/g, () => { removed += 1; return "[USER_PATH]"; })
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, () => { removed += 1; return "[EMAIL]"; })
      .slice(0, 64_000);
    if (Array.isArray(value)) return value.slice(0, 5_000).map((item) => visit(item, key));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 5_000).map(([childKey, child]) => [childKey, visit(child, childKey)]));
    return value;
  };
  return { value: visit(input), removed };
}

function safeError(error: unknown): string {
  return String(redact(error instanceof Error ? error.message : String(error)).value).slice(0, 500);
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await replaceFileSafely(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } finally { await rm(temporary, { force: true }); }
}

export const desktopFeedback = new DesktopFeedbackService();
