import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CreateThreadShareRequest, DesktopThreadShareResult } from "../api/desktopApi";
import { renderThreadShareHtml } from "../api/threadShareHtml";
import { gfsShareUrl, gfsWrite } from "./gatewayManagedResources";
import { DRSAI_HOME } from "./paths";
import { getThreadSnapshot } from "./threads";

export const THREAD_SHARES_DIRECTORY = join(DRSAI_HOME, "desktop", "shares");
const idPattern = /^[A-Za-z0-9_.:-]{1,160}$/;

export async function createThreadShare(raw: CreateThreadShareRequest): Promise<DesktopThreadShareResult> {
  if (!raw || !idPattern.test(raw.threadId) || (raw.messageIds && (!Array.isArray(raw.messageIds) || raw.messageIds.length > 500 || raw.messageIds.some((id) => !idPattern.test(id))))) throw new Error("Thread share request is invalid.");
  const snapshot = await getThreadSnapshot(raw.threadId);
  if (!snapshot) throw new Error("Conversation not found or has no messages to share.");
  const selected = raw.messageIds ? new Set(raw.messageIds) : undefined;
  const messages = snapshot.messages.filter((message) => message.role !== "system" && (!selected || selected.has(message.id))).slice(0, 500);
  if (!messages.length) throw new Error("Select at least one message to share.");
  const shareId = `share-${randomUUID()}`;
  const title = (raw.title?.trim() || snapshot.title || "Shared conversation").slice(0, 120);
  const createdAt = new Date().toISOString();
  const html = renderThreadShareHtml({ shareId, title, createdAt, messages });
  await mkdir(THREAD_SHARES_DIRECTORY, { recursive: true });
  const filePath = join(THREAD_SHARES_DIRECTORY, `${shareId}.html`);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try { await writeFile(temporaryPath, html, { encoding: "utf8", flag: "wx", mode: 0o600 }); await rename(temporaryPath, filePath); }
  catch (error) { await unlink(temporaryPath).catch(() => undefined); throw error; }
  let publicShareUrl: string | undefined;
  let publishError: string | undefined;
  try {
    const gfsPath = `desktop-shares/${shareId}.html`;
    await gfsWrite(gfsPath, html, "text/html; charset=utf-8");
    const result = await gfsShareUrl(gfsPath, 60 * 24 * 7);
    const parsed = new URL(result.url);
    if (parsed.protocol !== "https:") throw new Error("GFS share URL must use HTTPS.");
    publicShareUrl = result.url;
  } catch (error) { publishError = error instanceof Error ? error.message : String(error); }
  return { shareId, threadId: raw.threadId, title, messageCount: messages.length, filePath, fileUrl: pathToFileURL(filePath).href, publicShareUrl, shareToken: publicShareUrl ? shareId : undefined, publishError, deepLink: `opendrsai://share/${encodeURIComponent(shareId)}`, createdAt, readOnly: true };
}

export function assertThreadSharePath(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > 4096 || /[\r\n\0]/.test(raw)) throw new Error("Thread share path is invalid.");
  const target = resolve(raw);
  const rel = relative(resolve(THREAD_SHARES_DIRECTORY), target);
  if (rel.startsWith("..") || isAbsolute(rel) || !target.endsWith(".html")) throw new Error("Thread share path is outside the managed share directory.");
  return target;
}
