import { Notification } from "electron";
import { mkdir, readFile, rename, rm, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import type {
  CompletionNotificationClickEvent,
  CompletionNotificationPreference,
  CompletionNotificationTarget,
  DesktopBackgroundTask,
  DesktopTaskDeliverySummary,
} from "../shared/desktopApi";
import { DRSAI_HOME } from "./paths";

type WindowVisibility = "foreground" | "minimized" | "hidden";

export interface CompletionNotificationDiagnostic {
  key: string;
  title: string;
  body: string;
  target: CompletionNotificationTarget;
  visibility: WindowVisibility;
  shownAt: string;
  clickedAt?: string;
  deliverySummary?: DesktopTaskDeliverySummary;
}

interface CompletionNotificationHandlers {
  focusApp: () => void;
  publishClick: (event: CompletionNotificationClickEvent) => void;
  getWindowVisibility: () => WindowVisibility;
}

const SETTINGS_FILE = join(DRSAI_HOME, "desktop", "completion-notifications.json");
const MAX_DIAGNOSTICS = 100;
const FILE_REPLACE_RETRY_DELAYS_MS = [0, 25, 50, 100, 200, 400];
const RETRYABLE_FILE_ERROR_CODES = new Set(["EACCES", "EBUSY", "EEXIST", "EPERM"]);
const shownKeys = new Set<string>();
const activeNotifications = new Map<string, Notification>();
const diagnostics: CompletionNotificationDiagnostic[] = [];
let preference: CompletionNotificationPreference = { enabled: false, language: "zh" };
let preferenceWriteQueue: Promise<void> = Promise.resolve();
let handlers: CompletionNotificationHandlers = {
  focusApp: () => undefined,
  publishClick: () => undefined,
  getWindowVisibility: () => "hidden",
};

export function configureCompletionNotifications(next: CompletionNotificationHandlers): void {
  handlers = next;
}

export async function restoreCompletionNotificationPreference(): Promise<CompletionNotificationPreference> {
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_FILE, "utf8")) as Partial<CompletionNotificationPreference>;
    preference = normalizePreference(parsed);
  } catch {
    preference = { enabled: false, language: "zh" };
  }
  return { ...preference };
}

export async function setCompletionNotificationPreference(
  raw: CompletionNotificationPreference,
): Promise<CompletionNotificationPreference> {
  const nextPreference = normalizePreference(raw);
  preference = nextPreference;
  const pendingWrite = preferenceWriteQueue
    .catch(() => undefined)
    .then(() => persistCompletionNotificationPreference(nextPreference));
  preferenceWriteQueue = pendingWrite;
  await pendingWrite;
  return { ...nextPreference };
}

async function persistCompletionNotificationPreference(
  nextPreference: CompletionNotificationPreference,
): Promise<void> {
  await mkdir(dirname(SETTINGS_FILE), { recursive: true });
  const temporaryPath = `${SETTINGS_FILE}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(nextPreference, null, 2)}\n`, "utf8");
    await replaceFileWithRetry(temporaryPath, SETTINGS_FILE);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

async function replaceFileWithRetry(source: string, destination: string): Promise<void> {
  for (const [attempt, delayMs] of FILE_REPLACE_RETRY_DELAYS_MS.entries()) {
    if (delayMs > 0) await delay(delayMs);
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const isLastAttempt = attempt === FILE_REPLACE_RETRY_DELAYS_MS.length - 1;
      if (isLastAttempt || !isRetryableFileError(error)) throw error;
    }
  }
}

function isRetryableFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && RETRYABLE_FILE_ERROR_CODES.has(String(error.code));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function notifyBackgroundTaskCompleted(
  task: DesktopBackgroundTask,
  target: CompletionNotificationTarget,
): boolean {
  if (!preference.enabled || task.status !== "completed" || !Notification.isSupported()) return false;
  const key = `${target.kind}:${target.targetId}:completed`;
  if (shownKeys.has(key)) return false;
  shownKeys.add(key);

  const title = "OpenDrSai";
  const safeTaskTitle = redactNotificationText(task.title);
  const deliverySummary = task.deliverySummary ? redactDeliverySummary(task.deliverySummary) : undefined;
  const body = deliverySummary
    ? preference.language === "zh"
      ? [
          `发现：${deliverySummary.findingSummary}`,
          `重要程度：${importanceLabel(deliverySummary.importance, true)} — ${deliverySummary.importanceReason}`,
          `成果入口：${deliverySummary.artifacts[0]?.label || "打开对应任务"}（点击查看）`,
          `建议操作：${deliverySummary.suggestedAction}`,
        ].join("\n")
      : [
          `Finding: ${deliverySummary.findingSummary}`,
          `Importance: ${importanceLabel(deliverySummary.importance, false)} — ${deliverySummary.importanceReason}`,
          `Result: ${deliverySummary.artifacts[0]?.label || "Open the task"} (click to view)`,
          `Next step: ${deliverySummary.suggestedAction}`,
        ].join("\n")
    : preference.language === "zh"
      ? safeTaskTitle ? `任务“${safeTaskTitle}”已完成，点击查看结果。` : "任务已完成，点击查看结果。"
      : safeTaskTitle ? `“${safeTaskTitle}” is complete. Click to view the result.` : "Your task is complete. Click to view the result.";
  const notification = new Notification({ title, body, silent: false });
  const record: CompletionNotificationDiagnostic = {
    key,
    title,
    body,
    target: { ...target },
    visibility: handlers.getWindowVisibility(),
    shownAt: new Date().toISOString(),
    ...(deliverySummary ? { deliverySummary } : {}),
  };
  diagnostics.push(record);
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTICS);
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

export function getCompletionNotificationDiagnostics(): CompletionNotificationDiagnostic[] {
  return diagnostics.map((record) => ({
    ...record,
    target: { ...record.target },
    ...(record.deliverySummary ? {
      deliverySummary: {
        ...record.deliverySummary,
        artifacts: record.deliverySummary.artifacts.map((artifact) => ({ ...artifact })),
        ...(record.deliverySummary.completionCriteria ? {
          completionCriteria: {
            passed: [...record.deliverySummary.completionCriteria.passed],
            incomplete: [...record.deliverySummary.completionCriteria.incomplete],
          },
        } : {}),
      },
    } : {}),
  }));
}

export function clickLatestCompletionNotificationForE2e(): boolean {
  if (process.env.OPENDRSAI_E2E_AGENT_RUN !== "1"
    && process.env.OPENDRSAI_E2E_PRESENTATION_PDF_ACTION !== "1") return false;
  const latest = [...activeNotifications.values()].at(-1);
  if (!latest) return false;
  latest.emit("click");
  return true;
}

export function redactNotificationText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "[已隐藏凭据]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, "[已隐藏凭据]")
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=[已隐藏]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[已隐藏邮箱]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function normalizePreference(raw: Partial<CompletionNotificationPreference>): CompletionNotificationPreference {
  return {
    enabled: raw.enabled === true,
    language: raw.language === "en" ? "en" : "zh",
  };
}

function redactDeliverySummary(summary: DesktopTaskDeliverySummary): DesktopTaskDeliverySummary {
  return {
    ...summary,
    findingSummary: redactNotificationText(summary.findingSummary),
    importanceReason: redactNotificationText(summary.importanceReason),
    artifacts: summary.artifacts.map((artifact) => ({
      ...artifact,
      label: redactNotificationText(artifact.label),
      path: artifact.path,
    })),
    suggestedAction: redactNotificationText(summary.suggestedAction),
    workSummary: redactNotificationText(summary.workSummary),
    coreConclusion: redactNotificationText(summary.coreConclusion),
    verification: redactNotificationText(summary.verification),
    remainingRisks: redactNotificationText(summary.remainingRisks),
    ...(summary.completionCriteria ? {
      completionCriteria: {
        passed: summary.completionCriteria.passed.map(redactNotificationText),
        incomplete: summary.completionCriteria.incomplete.map(redactNotificationText),
      },
    } : {}),
  };
}

function importanceLabel(level: DesktopTaskDeliverySummary["importance"], zh: boolean): string {
  if (level === "high") return zh ? "高" : "High";
  if (level === "low") return zh ? "低" : "Low";
  return zh ? "中" : "Medium";
}
