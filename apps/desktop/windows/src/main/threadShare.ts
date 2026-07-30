import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import { shell } from "electron";
import type {
  ChatMessagePart,
  CreateThreadShareRequest,
  DesktopThreadMessageSnapshot,
  DesktopThreadShareResult,
} from "../shared/desktopApi";
import { renderThreadShareHtml, extractShareMessageText } from "../shared/threadShareHtml";
import { DRSAI_HOME } from "./paths";
import { getThreadSnapshot } from "./threads";
import { gfsShareUrl, gfsWrite } from "./gfs";

const SHARES_DIR = join(DRSAI_HOME, "desktop", "shares");
const SHARE_CACHE_FILE = join(SHARES_DIR, "public-share-cache.json");
const MAX_SHARE_MESSAGES = 500;
const MAX_MESSAGE_CHARS = 200_000;
const THREAD_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
const MESSAGE_ID_PATTERN = /^[a-zA-Z0-9_.:-]{1,160}$/;
/** Presigned URL lifetime. S3 SigV4 typically caps near 7 days. */
const GFS_SHARE_TTL_MINUTES = 60 * 24 * 7;
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";

type PublicShareCache = Record<
  string,
  {
    shareToken: string;
    publicShareUrl: string;
    title: string;
    updatedAt: string;
    gfsPath?: string;
  }
>;

export async function createThreadShare(
  rawRequest: unknown,
): Promise<DesktopThreadShareResult> {
  const request = validateCreateThreadShareRequest(rawRequest);
  const snapshot = await getThreadSnapshot(request.threadId);
  if (!snapshot) {
    throw new Error("Conversation not found or has no messages to share.");
  }

  const selectedIds = request.messageIds ? new Set(request.messageIds) : null;
  const messages = snapshot.messages
    .filter((message) => message.role !== "system")
    .filter((message) => (selectedIds ? selectedIds.has(message.id) : true))
    .slice(0, MAX_SHARE_MESSAGES)
    .map(sanitizeShareMessage);

  if (!messages.length) {
    throw new Error("Select at least one message to share.");
  }

  const shareId = `share-${randomUUID()}`;
  const title = (request.title?.trim() || snapshot.title || "Shared conversation").slice(0, 120);
  const createdAt = new Date().toISOString();
  await mkdir(SHARES_DIR, { recursive: true });
  const filePath = join(SHARES_DIR, `${shareId}.html`);
  const html = renderThreadShareHtml({
    shareId,
    title,
    createdAt,
    messages,
  });
  await writeFile(filePath, html, "utf8");

  const fileUrl = pathToFileURL(filePath).href;
  const cacheKey = buildShareCacheKey(request.threadId, messages.map((message) => message.id));
  const cached = await readPublicShareCacheEntry(cacheKey);
  let publicShareUrl =
    cached && (await isFreshPublicShareUrl(cached.publicShareUrl))
      ? cached.publicShareUrl
      : undefined;
  let shareToken = publicShareUrl ? cached?.shareToken : undefined;
  let publishError: string | undefined;

  // Production WebUI /share?token=… still spins on empty CREATED runs, so publish
  // a self-contained HTML page via GFS (Content-Type text/html) instead.
  if (!publicShareUrl || !shareToken) {
    try {
      const published = await publishShareViaGfs({
        shareId,
        html,
      });
      publicShareUrl = published.publicShareUrl;
      shareToken = published.shareToken;
      await writePublicShareCacheEntry(cacheKey, {
        shareToken,
        publicShareUrl,
        title,
        updatedAt: createdAt,
        gfsPath: published.gfsPath,
      });
    } catch (error) {
      publishError = error instanceof Error ? error.message : String(error);
      console.warn("[threadShare] GFS publish failed:", publishError);
    }
  }

  return {
    shareId: shareToken || shareId,
    threadId: request.threadId,
    title,
    messageCount: messages.length,
    filePath,
    fileUrl,
    publicShareUrl,
    shareToken,
    deepLink: `opendrsai://share/${encodeURIComponent(shareToken || shareId)}`,
    createdAt,
    readOnly: true,
    ...(publishError ? { publishError } : {}),
  };
}

export async function openThreadShare(rawPath: unknown): Promise<boolean> {
  const filePath = asNonEmptyString(rawPath, "filePath", 4096);
  const error = await shell.openPath(filePath);
  if (error) {
    throw new Error(error);
  }
  return true;
}

export async function revealThreadShare(rawPath: unknown): Promise<boolean> {
  const filePath = asNonEmptyString(rawPath, "filePath", 4096);
  shell.showItemInFolder(filePath);
  return true;
}

async function publishShareViaGfs(input: {
  shareId: string;
  html: string;
}): Promise<{ publicShareUrl: string; shareToken: string; gfsPath: string }> {
  const gfsPath = `desktop-shares/${input.shareId}.html`;
  await gfsWrite(gfsPath, input.html, HTML_CONTENT_TYPE);
  // Do NOT pass responseContentType: the storage gateway returns 403 when that
  // query param is present. Object ContentType from write is already text/html.
  const shared = await gfsShareUrl(gfsPath, GFS_SHARE_TTL_MINUTES);
  const publicShareUrl = typeof shared?.url === "string" ? shared.url.trim() : "";
  if (!publicShareUrl.startsWith("http")) {
    throw new Error("GFS 未返回可用的 https 分享链接。");
  }
  await assertHtmlShareUrl(publicShareUrl);
  return {
    shareToken: input.shareId,
    publicShareUrl,
    gfsPath,
  };
}

async function assertHtmlShareUrl(url: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "text/html,*/*" },
    });
    if (!response.ok) {
      throw new Error(`分享链接不可访问（HTTP ${response.status}）。`);
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      throw new Error(
        `分享链接 Content-Type 异常（${contentType || "unknown"}），浏览器可能显示源码。`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("验证分享链接超时，请检查网络后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isUsablePublicShareUrl(url: string | undefined): boolean {
  if (!url || !url.startsWith("http")) return false;
  // Cached WebUI share pages currently hang on "Processing" in production.
  if (/\/share\/?\?token=/i.test(url) || /opendrsai\.ihep\.ac\.cn\/share/i.test(url)) {
    return false;
  }
  return true;
}

async function isFreshPublicShareUrl(url: string | undefined): Promise<boolean> {
  if (!isUsablePublicShareUrl(url) || !url) return false;
  try {
    const expires = Number(new URL(url).searchParams.get("Expires") || 0);
    if (Number.isFinite(expires) && expires > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      // Refresh a day before expiry so recipients don't hit a dead link immediately.
      if (expires <= nowSec + 60 * 60 * 24) return false;
    }
    await assertHtmlShareUrl(url);
    return true;
  } catch {
    return false;
  }
}

function buildShareCacheKey(threadId: string, messageIds: string[]): string {
  const digest = createHash("sha256")
    .update(`${threadId}\n${messageIds.slice().sort().join(",")}`)
    .digest("hex")
    .slice(0, 24);
  return `${threadId}:${digest}`;
}

async function readPublicShareCache(): Promise<PublicShareCache> {
  try {
    const raw = await readFile(SHARE_CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as PublicShareCache;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function readPublicShareCacheEntry(
  key: string,
): Promise<PublicShareCache[string] | null> {
  const cache = await readPublicShareCache();
  const entry = cache[key];
  if (!entry?.publicShareUrl || !entry.shareToken) return null;
  if (!isUsablePublicShareUrl(entry.publicShareUrl)) return null;
  return entry;
}

async function writePublicShareCacheEntry(
  key: string,
  entry: PublicShareCache[string],
): Promise<void> {
  await mkdir(SHARES_DIR, { recursive: true });
  const cache = await readPublicShareCache();
  cache[key] = entry;
  const keys = Object.keys(cache);
  if (keys.length > 200) {
    const sorted = keys.sort(
      (left, right) =>
        Date.parse(cache[right]?.updatedAt || "0") - Date.parse(cache[left]?.updatedAt || "0"),
    );
    for (const stale of sorted.slice(200)) delete cache[stale];
  }
  await writeFile(SHARE_CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function validateCreateThreadShareRequest(raw: unknown): CreateThreadShareRequest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid share request.");
  }
  const request = raw as Partial<CreateThreadShareRequest>;
  const threadId = asNonEmptyString(request.threadId, "threadId", 160);
  if (!THREAD_ID_PATTERN.test(threadId)) {
    throw new Error("Invalid thread id.");
  }
  let messageIds: string[] | undefined;
  if (request.messageIds !== undefined) {
    if (!Array.isArray(request.messageIds)) {
      throw new Error("messageIds must be an array.");
    }
    messageIds = request.messageIds.map((id) => {
      const value = asNonEmptyString(id, "messageId", 160);
      if (!MESSAGE_ID_PATTERN.test(value)) {
        throw new Error("Invalid message id.");
      }
      return value;
    });
  }
  const title =
    request.title === undefined || request.title === null
      ? undefined
      : asNonEmptyString(request.title, "title", 120);
  return { threadId, messageIds, title };
}

function sanitizeShareMessage(
  message: DesktopThreadMessageSnapshot,
): DesktopThreadMessageSnapshot {
  const visibleContent = truncate(extractShareMessageText(message), MAX_MESSAGE_CHARS);
  return {
    id: message.id,
    role: message.role,
    content: visibleContent,
    parts:
      message.role === "assistant"
        ? [{ id: `${message.id}:text`, type: "text", text: visibleContent, format: "markdown", status: "completed" }]
        : message.parts
            ?.filter((part) => part.type !== "reasoning")
            .map(sanitizePart),
    attachments: message.attachments?.map((attachment) => ({
      kind: attachment.kind,
      path: attachment.path,
      name: attachment.name,
      title: attachment.title,
      note: attachment.note,
    })),
    toolTimeline: undefined,
    reasoningContent: undefined,
    statusContent:
      message.role === "assistant"
        ? undefined
        : message.statusContent
          ? truncate(message.statusContent, 4_000)
          : undefined,
  };
}

function sanitizePart(part: ChatMessagePart): ChatMessagePart {
  if (part.type === "text" || part.type === "reasoning" || part.type === "status") {
    return { ...part, text: truncate(part.text, MAX_MESSAGE_CHARS) };
  }
  if (part.type === "error") {
    return { ...part, message: truncate(part.message, 8_000) };
  }
  if (part.type === "tool") {
    return {
      ...part,
      event: {
        ...part.event,
        content: part.event.content ? truncate(part.event.content, 8_000) : undefined,
      },
    };
  }
  if (part.type === "patch") {
    return { ...part, diff: truncate(part.diff, 20_000) };
  }
  if (part.type === "approval") {
    return { ...part, prompt: truncate(part.prompt, 4_000) };
  }
  return part;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…`;
}

function asNonEmptyString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${field}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new Error(`${field} is too long.`);
  }
  return trimmed;
}
