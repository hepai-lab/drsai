import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CompletionNotificationClickEvent,
  CompletionNotificationPreference,
  CompletionNotificationTarget,
  DesktopBackgroundTask,
  DesktopTaskDeliverySummary,
} from "../api/desktopApi";
import type { DesktopNotificationHandle, DesktopNotificationService } from "../api";
import { replaceFileSafely } from "./atomicFileReplace";
import { DRSAI_HOME } from "./paths";
import { redactSensitiveData } from "../api/sensitiveData";

type WindowVisibility = "foreground" | "minimized" | "hidden";
interface Handlers {
  notifications: DesktopNotificationService;
  focusApp: () => void;
  publishClick: (event: CompletionNotificationClickEvent) => void;
  getWindowVisibility: () => WindowVisibility;
}
export interface CompletionNotificationDiagnostic {
  key: string; title: string; body: string; target: CompletionNotificationTarget;
  visibility: WindowVisibility; shownAt: string; clickedAt?: string;
  deliverySummary?: DesktopTaskDeliverySummary;
}

const SETTINGS_FILE = join(DRSAI_HOME, "desktop", "completion-notifications.json");
const shownKeys = new Set<string>();
const activeNotifications = new Map<string, DesktopNotificationHandle>();
const diagnostics: CompletionNotificationDiagnostic[] = [];
let preference: CompletionNotificationPreference = { enabled: true, language: "zh" };
let preferenceWriteQueue: Promise<void> = Promise.resolve();
let handlers: Handlers = {
  notifications: { supported: () => false, create: () => { throw new Error("Notification service is not configured."); } },
  focusApp: () => undefined,
  publishClick: () => undefined,
  getWindowVisibility: () => "hidden",
};

export function configureCompletionNotifications(next: Handlers): void { handlers = next; }

export async function restoreCompletionNotificationPreference(): Promise<CompletionNotificationPreference> {
  try {
    preference = normalizePreference(JSON.parse(await readFile(SETTINGS_FILE, "utf8")));
  } catch {
    // Default to enabled for users who never persisted a preference; a stored
    // preference is always respected as-is.
    preference = { enabled: true, language: "zh" };
  }
  return { ...preference };
}

/** Read the in-memory preference without touching disk. */
export function getCompletionNotificationPreference(): CompletionNotificationPreference {
  return { ...preference };
}

export async function setCompletionNotificationPreference(raw: CompletionNotificationPreference): Promise<CompletionNotificationPreference> {
  const next = normalizePreference(raw);
  preference = next;
  const write = preferenceWriteQueue.catch(() => undefined).then(() => persist(next));
  preferenceWriteQueue = write;
  await write;
  return { ...next };
}

async function persist(next: CompletionNotificationPreference): Promise<void> {
  await mkdir(dirname(SETTINGS_FILE), { recursive: true, mode: 0o700 });
  const temporaryPath = `${SETTINGS_FILE}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await replaceFileSafely(temporaryPath, SETTINGS_FILE);
    await chmod(SETTINGS_FILE, 0o600).catch(() => undefined);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export function notifyBackgroundTaskCompleted(task: DesktopBackgroundTask, target: CompletionNotificationTarget): boolean {
  if (!preference.enabled || task.status !== "completed" || !handlers.notifications.supported()) return false;
  const key = `${target.kind}:${target.targetId}:completed`;
  if (shownKeys.has(key)) return false;
  shownKeys.add(key);
  const deliverySummary = task.deliverySummary ? redactDeliverySummary(task.deliverySummary) : undefined;
  const title = "OpenDrSai";
  const body = message(task.title, deliverySummary);
  return presentNotification(key, title, body, target, deliverySummary);
}

/**
 * Notify that a chat turn finished while its conversation was not the one on
 * screen. The active conversation already raises a notification from the
 * renderer on its own terminal event, so only backgrounded turns reach here.
 */
export function notifyConversationCompleted(input: {
  threadId: string;
  title?: string;
  workspacePath?: string;
  failed: boolean;
  /** Latest user input of the finished turn; preferred over the title. */
  prompt?: string;
}): boolean {
  if (!preference.enabled || !handlers.notifications.supported()) return false;
  const key = `chat_run:${input.threadId}:${input.failed ? "failed" : "completed"}`;
  if (shownKeys.has(key)) return false;
  shownKeys.add(key);
  const title = "OpenDrSai";
  const body = conversationMessage(input.prompt || input.title, input.failed);
  return presentNotification(key, title, body, {
    kind: "chat_run",
    targetId: input.threadId,
    threadId: input.threadId,
    ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
  }, undefined);
}

function presentNotification(
  key: string,
  title: string,
  body: string,
  target: CompletionNotificationTarget,
  deliverySummary?: DesktopTaskDeliverySummary,
): boolean {
  const notification = handlers.notifications.create({ title, body, silent: false });
  const record: CompletionNotificationDiagnostic = {
    key, title, body, target: { ...target }, visibility: handlers.getWindowVisibility(),
    shownAt: new Date().toISOString(), ...(deliverySummary ? { deliverySummary } : {}),
  };
  diagnostics.push(record);
  if (diagnostics.length > 100) diagnostics.splice(0, diagnostics.length - 100);
  activeNotifications.set(key, notification);
  notification.once("click", () => {
    record.clickedAt = new Date().toISOString();
    handlers.focusApp();
    handlers.publishClick({ target: { ...target }, clickedAt: record.clickedAt });
  });
  notification.once("close", () => activeNotifications.delete(key));
  notification.show();
  return true;
}

function message(taskTitle: string, summary?: DesktopTaskDeliverySummary): string {
  if (summary) return preference.language === "zh"
    ? [`发现：${summary.findingSummary}`, `重要程度：${importanceLabel(summary.importance, true)} — ${summary.importanceReason}`, `成果入口：${summary.artifacts[0]?.label || "打开对应任务"}（点击查看）`, `建议操作：${summary.suggestedAction}`].join("\n")
    : [`Finding: ${summary.findingSummary}`, `Importance: ${importanceLabel(summary.importance, false)} — ${summary.importanceReason}`, `Result: ${summary.artifacts[0]?.label || "Open the task"} (click to view)`, `Next step: ${summary.suggestedAction}`].join("\n");
  const safe = redactNotificationText(taskTitle);
  return preference.language === "zh"
    ? safe ? `任务“${safe}”已完成，点击查看结果。` : "任务已完成，点击查看结果。"
    : safe ? `“${safe}” is complete. Click to view the result.` : "Your task is complete. Click to view the result.";
}

/**
 * A conversation title comes from the user's first message and can be very
 * long. Notifications only need a short hint, so clamp it before composing
 * the body.
 */
function shortTaskLabel(threadTitle: string | undefined): string {
  const safe = threadTitle ? redactNotificationText(threadTitle) : "";
  const MAX_TITLE_LENGTH = 30;
  return safe.length > MAX_TITLE_LENGTH ? `${safe.slice(0, MAX_TITLE_LENGTH)}…` : safe;
}

function conversationMessage(threadTitle: string | undefined, failed: boolean): string {
  const safe = shortTaskLabel(threadTitle);
  // Windows toasts render plain text only, so the task is highlighted by
  // putting it on its own line inside corner brackets instead of inline.
  if (failed) {
    return preference.language === "zh"
      ? safe ? `您的任务：\n「${safe}」\n执行失败，请点击查看详情。` : "您的任务执行失败，请点击查看详情。"
      : safe ? `Your task:\n"${safe}"\nfailed. Click to view details.` : "Your task failed. Click to view details.";
  }
  return preference.language === "zh"
    ? safe ? `您的任务：\n「${safe}」\n已经完成，请点击查看。` : "您的任务已经完成，请点击查看。"
    : safe ? `Your task:\n"${safe}"\nis complete. Click to view the result.` : "Your task is complete. Click to view the result.";
}

export function getCompletionNotificationDiagnostics(): CompletionNotificationDiagnostic[] {
  return structuredClone(diagnostics);
}

export function clickLatestCompletionNotificationForE2e(): boolean {
  if (process.env.OPENDRSAI_E2E_AGENT_RUN !== "1" && process.env.OPENDRSAI_E2E_PRESENTATION_PDF_ACTION !== "1") return false;
  const latest = [...activeNotifications.values()].at(-1);
  if (!latest) return false;
  latest.emit("click");
  return true;
}

export function redactNotificationText(value: string): string {
  return redactSensitiveData(value.replace(/[\r\n\t]+/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, 120);
}

function normalizePreference(raw: Partial<CompletionNotificationPreference>): CompletionNotificationPreference {
  return { enabled: raw?.enabled === true, language: raw?.language === "en" ? "en" : "zh" };
}
function redactDeliverySummary(summary: DesktopTaskDeliverySummary): DesktopTaskDeliverySummary {
  return {
    ...summary,
    findingSummary: redactNotificationText(summary.findingSummary),
    importanceReason: redactNotificationText(summary.importanceReason),
    artifacts: summary.artifacts.map((artifact) => ({ ...artifact, label: redactNotificationText(artifact.label) })),
    suggestedAction: redactNotificationText(summary.suggestedAction),
    workSummary: redactNotificationText(summary.workSummary), coreConclusion: redactNotificationText(summary.coreConclusion),
    verification: redactNotificationText(summary.verification), remainingRisks: redactNotificationText(summary.remainingRisks),
    ...(summary.completionCriteria ? { completionCriteria: { passed: summary.completionCriteria.passed.map(redactNotificationText), incomplete: summary.completionCriteria.incomplete.map(redactNotificationText) } } : {}),
  };
}
function importanceLabel(level: DesktopTaskDeliverySummary["importance"], zh: boolean): string {
  if (level === "high") return zh ? "高" : "High";
  if (level === "low") return zh ? "低" : "Low";
  return zh ? "中" : "Medium";
}
