/**
 * SkillsManager — desktop Skills UI.
 *
 * Two views (not bundled-in-code preinstall):
 * - 本地技能: skills already on disk under the user skills directory (list / import / CRUD)
 * - 在线技能: WebUI public catalog; download ZIP → extract to local before use (= 安装)
 *
 * 「预装」三件套（presentation / dox / ragflow）指在线平台发布的公共 skill，用户从在线列表安装，
 * 不是把 skill 放进仓库、也不是启动时自动写入本地。
 *
 * Temporarily hide Online tab / market install UI. Set true to re-enable.
 */
const ENABLE_ONLINE_SKILLS = false;

import {
  AlignLeft,
  ArrowDownAZ,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Cloud,
  Download,
  FilePlus,
  FileText,
  FolderInput,
  Globe,
  HardDrive,
  Info,
  List,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Store,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DesktopPublicSkill, DesktopPublicSkillDetail, GatewaySkill } from "@shared/desktopApi";
import { useAuth } from "../auth/AuthProvider";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { requestAppDecision } from "./AppDecisionDialog";

// ── Types ──────────────────────────────────────────────────────────────────────

type SkillsTab = "local" | "online";
type SquareFilter = "not_installed" | "all" | "installed";
type SquareSort = "time" | "name";
type OnlineDetailTab = "info" | "description" | "content";

type ManagerView =
  | { kind: "list" }
  | { kind: "detail"; skill: GatewaySkill; content: string }
  | { kind: "editor"; mode: "create" | "edit"; skill?: GatewaySkill; name: string; content: string };

// ── Default SKILL.md template ───────────────────────────────────────────────────

function defaultSkillContent(name: string): string {
  const title = name.trim() || "my_skill";
  return `---
name: ${title}
description: 把用户给出的要点整理成简洁摘要。用户说帮我总结、提炼要点时立即使用。
category: user
compatibility: ["drsai"]
---

# ${title}

当用户给出一段文字、笔记或聊天记录并要求总结时：

1. 用 1 句话概括主题
2. 列出 3-5 条关键要点（每条不超过 1 句）
3. 如有行动项，单独列出

用中文 Markdown 输出；不要编造原文没有的信息。
`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms * 1000).toLocaleString();
}

function skillDirName(skill: GatewaySkill): string {
  const path = skill.path?.replace(/[\\/]+$/, "") ?? "";
  return path.split(/[\\/]/).pop()?.trim() || skill.name;
}

/** Newest installs first so square downloads are visible without scrolling. */
function sortInstalled(skills: GatewaySkill[]): GatewaySkill[] {
  return [...skills].sort((a, b) => {
    const mt = (b.mtime ?? 0) - (a.mtime ?? 0);
    if (mt !== 0) return mt;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function preferSquareInstallName(skill: DesktopPublicSkill): string {
  const name = skill.name?.trim() || "";
  if (name && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) return name;
  return skill.slug;
}

function formatRelativeTime(iso: string, zh: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay > 0) return zh ? `${diffDay} 天前` : `${diffDay}d ago`;
  if (diffHour > 0) return zh ? `${diffHour} 小时前` : `${diffHour}h ago`;
  if (diffMin > 0) return zh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  return zh ? "刚刚" : "just now";
}

async function fetchPublicSkillDetail(slug: string): Promise<DesktopPublicSkillDetail> {
  const bridge = window.openDrSai;
  const direct = bridge?.getPublicSkillDetail;
  if (typeof direct === "function") {
    return direct.call(bridge, { slug });
  }
  // Preload hot-reload does not refresh IPC bridges; reuse listPublicSkillsSquare.
  const page = await desktopApi.listPublicSkillsSquare({ detailSlug: slug, page: 1, pageSize: 1 });
  if (page.detail) return page.detail;
  throw new Error("Public skill detail unavailable");
}

type SkillBodyTocItem = { id: string; level: number; text: string };

function skillHeadingId(text: string): string {
  return `md-h-${text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")}`;
}

function extractSkillBodyToc(body: string): SkillBodyTocItem[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const items: SkillBodyTocItem[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(body)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    items.push({ id: skillHeadingId(text), level, text });
  }
  return items;
}

function SkillMarkdownContent({ body, zh }: { body: string; zh: boolean }): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const tocItems = useMemo(() => extractSkillBodyToc(body), [body]);

  useEffect(() => {
    if (!bodyRef.current) return;
    const headings = bodyRef.current.querySelectorAll("h1, h2, h3");
    headings.forEach((heading) => {
      const text = (heading.textContent || "").trim();
      heading.id = skillHeadingId(text);
    });
  }, [body]);

  return (
    <div className="skills-online-detail-content-layout">
      <div ref={bodyRef} className="skills-online-detail-markdown gfs-preview-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
      </div>
      {tocItems.length > 1 ? (
        <nav className="skills-online-detail-toc" aria-label={zh ? "目录" : "On this page"}>
          <p className="skills-online-detail-toc-title">
            <List size={12} aria-hidden />
            {zh ? "目录" : "On this page"}
          </p>
          <ul className="skills-online-detail-toc-list">
            {tocItems.map((item) => (
              <li key={`${item.id}-${item.text}`} className={`skills-online-detail-toc-item level-${item.level}`}>
                <a
                  href={`#${item.id}`}
                  title={item.text}
                  onClick={(event) => {
                    event.preventDefault();
                    bodyRef.current?.querySelector(`#${CSS.escape(item.id)}`)?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}

function isGatewayNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|gateway.*(not|un)available|not ready|28643/i.test(message);
}

async function ensureGatewayReady(maxAttempts = 12): Promise<void> {
  if (typeof desktopApi.startGateway === "function") {
    try {
      await desktopApi.startGateway();
    } catch {
      // Keep retrying list calls while the process is still booting.
    }
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (typeof desktopApi.getGatewayStatus === "function") {
        const status = await desktopApi.getGatewayStatus();
        if (status?.ready) return;
      } else {
        // Fallback probe used when status API is unavailable.
        await desktopApi.listInstalledSkills();
        return;
      }
    } catch (error) {
      lastError = error;
      if (!isGatewayNotReadyError(error) && attempt >= 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(400 * attempt, 2000)));
    if (typeof desktopApi.startGateway === "function") {
      try {
        await desktopApi.startGateway();
      } catch {
        // ignore and continue polling
      }
    }
  }
  if (lastError) throw lastError;
  throw new Error("OpenDrSai gateway is not ready.");
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface SkillsManagerProps {
  language: AppLanguage;
  activeThreadId?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SkillsManager({ language, activeThreadId }: SkillsManagerProps): React.JSX.Element {
  const zh = language === "zh";
  const { session } = useAuth();
  // Gateway storage is keyed by OIDC subject (user.id), not email.
  const userId = session.user?.id?.trim() || undefined;

  const [tab, setTab] = useState<SkillsTab>("local");
  const [squareFilter, setSquareFilter] = useState<SquareFilter>("all");
  const [squareSort, setSquareSort] = useState<SquareSort>("time");
  const [squareTag, setSquareTag] = useState<string | null>(null);
  const [publicAvailableTags, setPublicAvailableTags] = useState<string[]>([]);
  const [view, setView] = useState<ManagerView>({ kind: "list" });
  const [skills, setSkills] = useState<GatewaySkill[]>([]);
  const [publicItems, setPublicItems] = useState<DesktopPublicSkill[]>([]);
  const [publicPage, setPublicPage] = useState(1);
  const [publicHasNext, setPublicHasNext] = useState(false);
  const [publicTotal, setPublicTotal] = useState(0);
  const [publicPageSize, setPublicPageSize] = useState(20);
  const [publicInstalledCount, setPublicInstalledCount] = useState(0);
  const [publicNotInstalledCount, setPublicNotInstalledCount] = useState(0);
  const [squareQuery, setSquareQuery] = useState("");
  const [squareQueryDraft, setSquareQueryDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [squareLoading, setSquareLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [squareError, setSquareError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importingFolder, setImportingFolder] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [onlineDetail, setOnlineDetail] = useState<{
    summary: DesktopPublicSkill;
    detail: DesktopPublicSkillDetail | null;
    loading: boolean;
    error: string | null;
    tab: OnlineDetailTab;
  } | null>(null);
  const [actionToast, setActionToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const actionToastTimerRef = useRef<number | null>(null);

  // editor dirty-state for the unsaved-changes guard
  const [editorDirty, setEditorDirty] = useState(false);

  useEffect(() => () => {
    if (actionToastTimerRef.current !== null) {
      window.clearTimeout(actionToastTimerRef.current);
    }
  }, []);

  function showActionToast(type: "success" | "error", message: string): void {
    setActionToast({ type, message });
    if (actionToastTimerRef.current !== null) {
      window.clearTimeout(actionToastTimerRef.current);
    }
    actionToastTimerRef.current = window.setTimeout(() => {
      setActionToast(null);
      actionToastTimerRef.current = null;
    }, 2600);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await ensureGatewayReady();
        if (cancelled) return;
        const data = await desktopApi.listInstalledSkills({ userId });
        if (cancelled) return;
        setSkills(sortInstalled(data ?? []));
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    // Online skills temporarily disabled.
    if (!ENABLE_ONLINE_SKILLS) return;
    if (tab === "online" && view.kind === "list") {
      void loadPublicSquare(1, squareQuery, squareFilter, squareSort, squareTag);
    }
  }, [tab, view.kind, squareQuery, squareFilter, squareSort, squareTag]);

  async function loadSkills(options?: { notify?: boolean; silent?: boolean }): Promise<void> {
    if (!options?.silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      await ensureGatewayReady();
      const data = await desktopApi.listInstalledSkills({ userId });
      setSkills(sortInstalled(data ?? []));
      if (options?.notify) {
        showActionToast("success", zh ? "列表已刷新" : "List refreshed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!options?.silent) setLoadError(message);
      if (options?.notify) {
        showActionToast("error", `${zh ? "刷新失败" : "Refresh failed"}: ${message}`);
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  async function handleImportFolder(): Promise<void> {
    if (typeof desktopApi.pickFolder !== "function" || typeof desktopApi.importSkillFolder !== "function") {
      showActionToast("error", zh ? "当前环境不支持文件夹导入。" : "Folder import is unavailable in this environment.");
      return;
    }
    setImportingFolder(true);
    try {
      const picked = await desktopApi.pickFolder();
      if (picked.canceled || !picked.paths[0]) return;
      const result = await desktopApi.importSkillFolder({
        folderPath: picked.paths[0],
        threadId: activeThreadId,
      });
      await loadSkills({ silent: true });
      showActionToast(
        "success",
        zh
          ? `已导入「${result.name}」（${result.files} 个文件）`
          : `Imported '${result.name}' (${result.files} files)`,
      );
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "导入失败" : "Import failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setImportingFolder(false);
    }
  }

  async function loadPublicSquare(
    page = 1,
    q = squareQuery,
    installFilter: SquareFilter = squareFilter,
    sort: SquareSort = squareSort,
    tag: string | null = squareTag,
    options?: { silent?: boolean },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (typeof desktopApi.listPublicSkillsSquare !== "function") {
      const error = zh ? "当前环境不支持 WebUI 技能广场。" : "WebUI Skills Square is unavailable.";
      setPublicItems([]);
      setSquareError(error);
      return { ok: false, error };
    }
    if (!options?.silent) {
      setSquareLoading(true);
      setSquareError(null);
    }
    try {
      // 广场列表走 WebUI HTTP；installed 标记在 main 内 best-effort 拉取，不阻塞搜索/刷新。
      const data = await desktopApi.listPublicSkillsSquare({
        page,
        pageSize: 20,
        q: q.trim() || undefined,
        sort,
        tags: tag?.trim() || undefined,
        installFilter,
        userId,
      });
      setPublicItems(data.items ?? []);
      setPublicPage(data.page ?? page);
      setPublicPageSize(data.pageSize ?? 20);
      setPublicTotal(data.total ?? (data.items?.length ?? 0));
      setPublicInstalledCount(data.installedCount ?? 0);
      setPublicNotInstalledCount(data.notInstalledCount ?? 0);
      setPublicAvailableTags(data.availableTags ?? []);
      const total = data.total ?? (data.items?.length ?? 0);
      const size = data.pageSize ?? 20;
      const current = data.page ?? page;
      setPublicHasNext(
        Boolean(data.hasNext) || current * size < total,
      );
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      setSquareError(error);
      return { ok: false, error };
    } finally {
      if (!options?.silent) setSquareLoading(false);
    }
  }

  function handleSquareSearch(): void {
    const next = squareQueryDraft.trim();
    setSquareQuery(next);
    void loadPublicSquare(1, next, squareFilter, squareSort, squareTag);
  }

  async function handleSquareRefresh(): Promise<void> {
    const next = squareQueryDraft.trim();
    if (next !== squareQuery) setSquareQuery(next);
    const result = await loadPublicSquare(1, next, squareFilter, squareSort, squareTag);
    if (result.ok) {
      showActionToast("success", zh ? "列表已刷新" : "List refreshed");
    } else {
      showActionToast("error", `${zh ? "刷新失败" : "Refresh failed"}: ${result.error}`);
    }
  }

  async function handleReload(): Promise<void> {
    setBusy(true);
    try {
      await desktopApi.reloadSkills({ threadId: activeThreadId, userId });
      showActionToast("success", zh ? "Skills 已热重载" : "Skills hot-reloaded");
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "热重载失败" : "Hot-reload failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleShowOnlineDetail(skill: DesktopPublicSkill): Promise<void> {
    setOnlineDetail({
      summary: skill,
      detail: null,
      loading: true,
      error: null,
      tab: "info",
    });
    try {
      const detail = await fetchPublicSkillDetail(skill.slug);
      setOnlineDetail((prev) => (
        prev && prev.summary.slug === skill.slug
          ? { ...prev, detail, loading: false }
          : prev
      ));
    } catch (err) {
      setOnlineDetail((prev) => (
        prev && prev.summary.slug === skill.slug
          ? {
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          }
          : prev
      ));
    }
  }

  function closeOnlineDetail(): void {
    setOnlineDetail(null);
  }

  async function handleShowDetail(skill: GatewaySkill): Promise<void> {
    setBusy(true);
    try {
      const res = await desktopApi.getSkillContent({ skillPath: skill.path });
      setView({ kind: "detail", skill, content: res.content });
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "读取失败" : "Read failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(skill: GatewaySkill): Promise<void> {
    setBusy(true);
    try {
      const res = await desktopApi.getSkillContent({ skillPath: skill.path });
      setEditorDirty(false);
      setView({ kind: "editor", mode: "edit", skill, name: skill.name, content: res.content });
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "读取失败" : "Read failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function handleCreate(): void {
    setEditorDirty(false);
    const name = "my_skill";
    setView({ kind: "editor", mode: "create", name, content: defaultSkillContent(name) });
  }

  async function handleInstallFromSquare(skill: DesktopPublicSkill): Promise<void> {
    if (skill.installed || installingSlug) return;
    setInstallingSlug(skill.slug);
    try {
      const result = await desktopApi.installPublicSkillSquare({
        slug: skill.slug,
        name: preferSquareInstallName(skill),
        userId,
        threadId: activeThreadId,
      });
      await Promise.all([
        loadSkills({ silent: true }),
        loadPublicSquare(publicPage, squareQuery, squareFilter, squareSort, squareTag, { silent: true }),
      ]);
      setOnlineDetail((prev) => (
        prev && prev.summary.slug === skill.slug
          ? { ...prev, summary: { ...prev.summary, installed: true } }
          : prev
      ));
      setPublicItems((prev) =>
        prev.map((item) => (item.slug === skill.slug ? { ...item, installed: true } : item)),
      );
      showActionToast(
        "success",
        zh
          ? `已安装「${result.name}」（${result.files} 个文件）`
          : `Installed '${result.name}' (${result.files} files)`,
      );
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "安装失败" : "Install failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setInstallingSlug(null);
    }
  }

  async function handleSave(mode: "create" | "edit", name: string, content: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showActionToast("error", zh ? "技能名称不能为空。" : "Skill name cannot be empty.");
      return;
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(trimmedName) || trimmedName.length > 64) {
      showActionToast(
        "error",
        zh
          ? "名称只能包含字母、数字、_ 和 -，最长 64 个字符。"
          : "Name must match [a-zA-Z0-9_-] and be at most 64 chars.",
      );
      return;
    }
    setBusy(true);
    try {
      if (mode === "create") {
        await desktopApi.installSkill({ name: trimmedName, content });
      } else {
        await desktopApi.updateSkill({ name: trimmedName, content });
      }
      let reloadNote = "";
      try {
        await desktopApi.reloadSkills({ threadId: activeThreadId });
      } catch (reloadErr) {
        reloadNote = zh
          ? `（已写入磁盘，但热重载失败：${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}。可点「热重载」或新开对话后再用。）`
          : ` (Saved to disk, but hot-reload failed: ${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}. Click Hot-reload or start a new chat.)`;
      }
      await loadSkills();
      setEditorDirty(false);
      setView({ kind: "list" });
      showActionToast(
        reloadNote ? "error" : "success",
        zh
          ? `「${trimmedName}」已${mode === "create" ? "创建" : "更新"}${reloadNote}`
          : `'${trimmedName}' ${mode === "create" ? "created" : "updated"}.${reloadNote}`,
      );
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "保存失败" : "Save failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRequest(skill: GatewaySkill): Promise<void> {
    const approved = await requestAppDecision({
      id: `delete-skill-${skillDirName(skill)}`,
      tone: "danger",
      title: zh ? "确认删除技能？" : "Delete skill?",
      description: zh
        ? `将永久删除「${skill.name}」及其目录，此操作不可撤销。`
        : `Permanently delete '${skill.name}' and its directory. This cannot be undone.`,
      impact: zh
        ? (ENABLE_ONLINE_SKILLS
          ? "删除后需重新导入或从在线技能安装。"
          : "删除后需重新导入或新建。")
        : (ENABLE_ONLINE_SKILLS
          ? "Re-import or install from Online to use it again."
          : "Re-import or create again to use it."),
      confirmLabel: zh ? "确认删除" : "Delete",
    });
    if (!approved) return;
    await handleDeleteConfirmed(skill);
  }

  async function handleDeleteConfirmed(skill: GatewaySkill): Promise<void> {
    setBusy(true);
    // Gateway deletes by directory name under configs/skills, not SKILL.md frontmatter name.
    const installId = skillDirName(skill);
    try {
      await desktopApi.uninstallSkill({ name: installId, userId });
      try {
        await desktopApi.reloadSkills({ threadId: activeThreadId, userId });
      } catch {
        // Disk delete already succeeded; stale in-memory skills clear on next chat.
      }
      setSkills((prev) =>
        prev.filter((s) => (s.path || s.name) !== (skill.path || skill.name) && skillDirName(s) !== installId),
      );
      setPublicItems((prev) =>
        prev.map((item) =>
          item.slug === installId || item.slug === skill.name || item.name === skill.name || item.name === installId
            ? { ...item, installed: false }
            : item,
        ),
      );
      showActionToast("success", zh ? `「${skill.name}」已删除` : `'${skill.name}' deleted`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const inUse = /skill_in_use|referenced by one or more Agents/i.test(raw);
      const agents = Array.from(raw.matchAll(/"agent_name"\s*:\s*"([^"]+)"/g)).map((m) => m[1]);
      const agentHint = agents.length > 0 ? agents.join("、") : "opendrsai";
      showActionToast(
        "error",
        inUse
          ? (zh
            ? `无法删除「${skill.name}」：智能体 ${agentHint} 仍引用该技能`
            : `Cannot delete '${skill.name}': agent ${agentHint} still references it`)
          : `${zh ? "删除失败" : "Delete failed"}: ${raw}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function goBack(): Promise<void> {
    if (view.kind === "editor" && editorDirty) {
      if (!await requestAppDecision({ id: "discard-skill-editor", tone: "danger", title: zh ? "放弃未保存的更改？" : "Discard unsaved changes?", description: zh ? "技能编辑器中的未保存内容会丢失。" : "Unsaved content in the skill editor will be lost.", impact: zh ? "已保存的技能内容不会改变。" : "Previously saved skill content is unchanged.", confirmLabel: zh ? "放弃更改" : "Discard changes" })) return;
    }
    setEditorDirty(false);
    setView({ kind: "list" });
  }

  function switchTab(next: SkillsTab): void {
    if (!ENABLE_ONLINE_SKILLS && next === "online") return;
    setTab(next);
    setView({ kind: "list" });
    setOnlineDetail(null);
  }

  // ── Loading / error (installed bootstrap) ─────────────────────────────────────

  if (loading && view.kind === "list" && tab === "local") {
    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <p className="skills-loading">{zh ? "正在连接网关并加载 Skills…" : "Connecting to gateway and loading Skills…"}</p>
      </div>
    );
  }

  if (loadError && tab === "local" && view.kind === "list") {
    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <p className="skills-error">{loadError}</p>
        <button type="button" className="skills-btn" onClick={() => { void loadSkills(); }}>
          {zh ? "重试" : "Retry"}
        </button>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────

  if (view.kind === "list") {
    return (
      <div className={`skills-manager${tab === "online" ? " skills-manager-online" : ""}${onlineDetail ? " skills-manager-online-detail" : ""}`}>
        <SkillsHeader zh={zh} />

        {/* Keep Local tab visible; only hide Online while ENABLE_ONLINE_SKILLS is false. */}
        {!onlineDetail ? (
        <div className="skills-tabs" role="tablist" aria-label={zh ? "Skills 视图" : "Skills views"}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "local"}
            className={`skills-tab${tab === "local" ? " active" : ""}`}
            onClick={() => switchTab("local")}
          >
            <HardDrive size={13} />
            {zh ? "本地技能" : "Local"}
          </button>
          {ENABLE_ONLINE_SKILLS ? (
            <button
              type="button"
              role="tab"
              aria-selected={tab === "online"}
              className={`skills-tab${tab === "online" ? " active" : ""}`}
              onClick={() => switchTab("online")}
            >
              <Store size={13} />
              {zh ? "在线技能" : "Online"}
            </button>
          ) : null}
        </div>
        ) : null}

        {tab === "local" ? (
          <div className="skills-local">
            <div className="skills-toolbar">
              <button
                type="button"
                className="skills-btn primary"
                onClick={handleCreate}
                title={zh ? "新建 Skill" : "New Skill"}
              >
                <FilePlus size={14} />
                {zh ? "新建" : "New"}
              </button>
              <button
                type="button"
                className="skills-btn"
                onClick={() => { void handleImportFolder(); }}
                disabled={importingFolder}
                title={zh ? "从文件夹导入（复制到 skills 目录）" : "Import folder into skills directory"}
              >
                {importingFolder ? <Loader2 size={14} className="spin" /> : <FolderInput size={14} />}
                {importingFolder ? (zh ? "导入中" : "Importing") : (zh ? "导入" : "Import")}
              </button>
              <button
                type="button"
                className="skills-btn"
                onClick={() => { void loadSkills({ notify: true }); }}
                disabled={loading}
                title={zh ? "刷新列表" : "Refresh"}
              >
                <RefreshCw size={14} className={loading ? "spin" : ""} />
                {zh ? "刷新" : "Refresh"}
              </button>
              <button
                type="button"
                className="skills-btn"
                onClick={() => { void handleReload(); }}
                disabled={busy}
                title={zh ? "重新加载到 Agent" : "Reload into agent"}
              >
                <Zap size={14} />
                {zh ? "热重载" : "Hot-reload"}
              </button>
            </div>

            <div className="skills-divider" />

            <div className="skills-local-body">
              {skills.length === 0 ? (
                <div className="skills-empty">
                  <p>{zh ? "尚未安装任何 Skill。" : "No skills installed yet."}</p>
                  <p className="skills-hint">
                    {zh
                      ? (ENABLE_ONLINE_SKILLS
                        ? "本地目录为空。可从「在线技能」下载安装，或使用「导入 / 新建」。"
                        : "本地目录为空。请使用「导入」或「新建」。")
                      : (ENABLE_ONLINE_SKILLS
                        ? "No local skills yet. Install from Online, or use Import / New."
                        : "No local skills yet. Use Import or New.")}
                  </p>
                  {ENABLE_ONLINE_SKILLS ? (
                    <button type="button" className="skills-btn primary" onClick={() => switchTab("online")}>
                      <Store size={14} />
                      {zh ? "浏览在线技能" : "Browse online skills"}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="skills-list">
                  {skills.map((skill) => {
                    const dirName = skillDirName(skill);
                    const showDir = Boolean(dirName && dirName !== skill.name);
                    return (
                    <div key={skill.path || `${dirName}:${skill.name}`} className="skills-row">
                      <button
                        type="button"
                        className="skills-row-main"
                        onClick={() => { void handleShowDetail(skill); }}
                        disabled={busy}
                      >
                        <span className="skills-row-name">{skill.name}</span>
                        {showDir ? (
                          <span className="skills-row-desc skills-row-dirname" title={dirName}>
                            {zh ? `目录：${dirName}` : `Folder: ${dirName}`}
                          </span>
                        ) : null}
                        {skill.description && (
                          <span className="skills-row-desc">
                            {skill.description.length > 80
                              ? skill.description.slice(0, 77) + "…"
                              : skill.description}
                          </span>
                        )}
                        <span className="skills-row-meta">
                          {skill.category && <span className="skills-tag">{skill.category}</span>}
                          {skill.size != null && <span className="skills-meta-text">{formatBytes(skill.size)}</span>}
                          {skill.mtime != null && <span className="skills-meta-text">{formatDate(skill.mtime)}</span>}
                        </span>
                      </button>
                      <div className="skills-row-actions">
                        <button
                          type="button"
                          className="skills-icon-btn"
                          title={zh ? "编辑" : "Edit"}
                          disabled={busy}
                          onClick={() => { void handleEdit(skill); }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="skills-icon-btn danger"
                          title={zh ? "删除" : "Delete"}
                          disabled={busy}
                          onClick={() => { void handleDeleteRequest(skill); }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="skills-divider" />
            <p className="skills-hint-bar">
              {zh
                ? (ENABLE_ONLINE_SKILLS
                  ? "点击技能名称查看详情 · 导入=复制文件夹 · 安装请到「在线技能」下载 · 热重载立即生效"
                  : "点击技能名称查看详情 · 导入=复制文件夹 · 热重载立即生效")
                : (ENABLE_ONLINE_SKILLS
                  ? "Click skill name to view · Import copies a folder · Install via Online download · hot-reload to apply"
                  : "Click skill name to view · Import copies a folder · hot-reload to apply")}
            </p>
          </div>
        ) : ENABLE_ONLINE_SKILLS ? (
          <div className="skills-online">
            {!onlineDetail ? (
            <>
            {installingSlug ? (
              <div className="skills-online-install-banner" role="status" aria-live="polite">
                <Loader2 size={14} className="spin" aria-hidden />
                {zh ? "正在安装技能，请稍候…" : "Installing skill…"}
              </div>
            ) : null}
            <div className="skills-online-toolbar">
              <form
                className="skills-online-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSquareSearch();
                }}
              >
                <Search size={15} className="skills-online-search-icon" aria-hidden />
                <input
                  type="search"
                  className="skills-input skills-online-search-input"
                  placeholder={zh ? "搜索技能名称、描述…" : "Search skills…"}
                  value={squareQueryDraft}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSquareQueryDraft(value);
                    if (!value.trim() && squareQuery) {
                      setSquareQuery("");
                    }
                  }}
                />
                <button type="submit" className="skills-btn primary skills-online-search-btn" disabled={squareLoading}>
                  {zh ? "搜索" : "Search"}
                </button>
              </form>
              <div className="skills-online-toolbar-actions">
                <button
                  type="button"
                  className="skills-btn"
                  onClick={() => { void handleSquareRefresh(); }}
                  disabled={squareLoading}
                  title={zh ? "刷新列表" : "Refresh list"}
                >
                  <RefreshCw size={14} className={squareLoading ? "spin" : ""} />
                </button>
                <button
                  type="button"
                  className="skills-btn"
                  onClick={() => { void handleReload(); }}
                  disabled={busy}
                  title={zh ? "热重载 Agent" : "Hot-reload agent"}
                >
                  <Zap size={14} />
                </button>
              </div>
            </div>

            <div className="skills-filter-row skills-online-filters" role="group" aria-label={zh ? "筛选" : "Filter"}>
              {(
                [
                  ["all", zh ? "全部" : "All"],
                  ["not_installed", zh ? "未安装" : "Not installed"],
                  ["installed", zh ? "已安装" : "Installed"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`skills-filter-chip${squareFilter === id ? " active" : ""}`}
                  onClick={() => setSquareFilter(id)}
                >
                  {label}
                </button>
              ))}
              <SquareSortMenu value={squareSort} zh={zh} onChange={setSquareSort} />
            </div>

            {publicAvailableTags.length > 0 ? (
              <div className="skills-online-tag-filters" role="group" aria-label={zh ? "标签" : "Tags"}>
                <button
                  type="button"
                  className={`skills-filter-chip${!squareTag ? " active" : ""}`}
                  onClick={() => setSquareTag(null)}
                >
                  {zh ? "全部标签" : "All tags"}
                </button>
                {publicAvailableTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`skills-filter-chip skills-online-tag-chip${squareTag === tag ? " active" : ""}`}
                    onClick={() => setSquareTag((current) => (current === tag ? null : tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            ) : null}
            </>
            ) : null}

            <div className="skills-online-body">
              {onlineDetail ? (
                <OnlineSkillDetailPanel
                  zh={zh}
                  installing={installingSlug === onlineDetail.summary.slug}
                  state={onlineDetail}
                  onClose={closeOnlineDetail}
                  onTabChange={(tab) => {
                    setOnlineDetail((prev) => (prev ? { ...prev, tab } : null));
                  }}
                  onInstall={() => { void handleInstallFromSquare(onlineDetail.summary); }}
                />
              ) : (() => {
                if (squareLoading && publicItems.length === 0) {
                  return (
                    <div className="skills-online-grid">
                      {Array.from({ length: 6 }, (_, i) => (
                        <div key={i} className="skills-online-card skills-online-card-skeleton" aria-hidden />
                      ))}
                    </div>
                  );
                }
                if (squareError) {
                  return (
                    <div className="skills-online-empty">
                      <div className="skills-online-empty-icon skills-online-empty-icon-error">
                        <Cloud size={28} strokeWidth={1.5} />
                      </div>
                      <p className="skills-online-empty-title">{zh ? "加载失败" : "Failed to load"}</p>
                      <p className="skills-error">{squareError}</p>
                      <button type="button" className="skills-btn primary" onClick={() => { void loadPublicSquare(1, squareQuery, squareFilter, squareSort, squareTag); }}>
                        {zh ? "重试" : "Retry"}
                      </button>
                    </div>
                  );
                }
                if (publicItems.length === 0) {
                  const hasCatalog = (publicInstalledCount + publicNotInstalledCount) > 0;
                  return (
                    <div className="skills-online-empty">
                      <div className="skills-online-empty-icon">
                        <Store size={28} strokeWidth={1.5} />
                      </div>
                      <p className="skills-online-empty-title">
                        {hasCatalog && squareFilter !== "all"
                          ? (zh ? "当前筛选下没有技能" : "No skills match this filter")
                          : (zh ? "暂无匹配的公共技能" : "No public skills found")}
                      </p>
                      {hasCatalog && squareFilter !== "all" ? (
                        <button type="button" className="skills-btn" onClick={() => setSquareFilter("all")}>
                          {zh ? "查看全部" : "Show all"}
                        </button>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <div className="skills-online-grid">
                    {publicItems.map((skill) => (
                      <OnlineSkillCard
                        key={skill.slug}
                        skill={skill}
                        zh={zh}
                        installing={installingSlug === skill.slug}
                        installLocked={installingSlug !== null && installingSlug !== skill.slug}
                        onOpen={() => { void handleShowOnlineDetail(skill); }}
                        onInstall={() => { void handleInstallFromSquare(skill); }}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>

            {publicTotal > 0 && !onlineDetail && (
              <div className="skills-online-pager" role="navigation" aria-label={zh ? "在线技能分页" : "Online skills pagination"}>
                <button
                  type="button"
                  className="skills-online-pager-nav"
                  disabled={squareLoading || publicPage <= 1}
                  onClick={() => { void loadPublicSquare(Math.max(1, publicPage - 1), squareQuery, squareFilter, squareSort, squareTag); }}
                >
                  <ChevronLeft size={15} aria-hidden />
                  {zh ? "上一页" : "Prev"}
                </button>
                <span className="skills-online-pager-meta">
                  {zh
                    ? `${publicPage} / ${Math.max(1, Math.ceil(publicTotal / publicPageSize))}`
                    : `${publicPage} / ${Math.max(1, Math.ceil(publicTotal / publicPageSize))}`}
                </span>
                <button
                  type="button"
                  className="skills-online-pager-nav"
                  disabled={
                    squareLoading
                    || !(publicHasNext || publicPage * publicPageSize < publicTotal)
                  }
                  onClick={() => { void loadPublicSquare(publicPage + 1, squareQuery, squareFilter, squareSort, squareTag); }}
                >
                  {zh ? "下一页" : "Next"}
                  <ChevronRight size={15} aria-hidden />
                </button>
              </div>
            )}
          </div>
        ) : null}
        {actionToast ? (
          <SkillsActionToast toast={actionToast} />
        ) : null}
      </div>
    );
  }

  // ── Detail view ──────────────────────────────────────────────────────────────

  if (view.kind === "detail") {
    const { skill, content } = view;
    return (
      <div className="skills-manager skills-manager-local-detail">
        <SkillsHeader zh={zh} />
        <div className="skills-detail-header">
          <button type="button" className="skills-btn" onClick={goBack}>
            <ArrowLeft size={14} />
            {zh ? "返回" : "Back"}
          </button>
          <span className="skills-detail-name">{skill.name}</span>
          <button
            type="button"
            className="skills-btn"
            onClick={() => { void handleEdit(skill); }}
            disabled={busy}
          >
            <Pencil size={14} />
            {zh ? "编辑" : "Edit"}
          </button>
        </div>
        <div className="skills-divider" />
        <div className="skills-local-detail-body">
          <SkillMarkdownContent body={content} zh={zh} />
        </div>
        {actionToast ? (
          <SkillsActionToast toast={actionToast} />
        ) : null}
      </div>
    );
  }

  // ── Editor view ──────────────────────────────────────────────────────────────

  if (view.kind === "editor") {
    const { mode, name, content } = view;
    const currentName = name;
    const currentContent = content;

    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <div className="skills-detail-header">
          <button type="button" className="skills-btn" onClick={goBack}>
            <ArrowLeft size={14} />
            {zh ? "取消" : "Cancel"}
          </button>
          <span className="skills-detail-name">
            {mode === "create" ? (zh ? "新建 Skill" : "New Skill") : (zh ? `编辑 ${currentName}` : `Edit ${currentName}`)}
          </span>
          <button
            type="button"
            className="skills-btn primary"
            disabled={busy}
            onClick={() => { void handleSave(mode, currentName, currentContent); }}
          >
            <Save size={14} />
            {zh ? "保存" : "Save"}
          </button>
        </div>
        <div className="skills-divider" />

        {mode === "create" && (
          <div className="skills-field">
            <label className="skills-label" htmlFor="skill-name">
              {zh ? "技能名称" : "Skill name"}
              <span className="skills-label-hint">{zh ? "（字母、数字、_ 或 -）" : "(letters, digits, _ or -)"}</span>
            </label>
            <input
              id="skill-name"
              type="text"
              className="skills-input"
              placeholder={zh ? "my_skill" : "my_skill"}
              value={currentName}
              maxLength={64}
              onChange={(e) => {
                const nextName = e.target.value;
                setEditorDirty(true);
                // Keep SKILL.md name/title in sync while the user is still on the starter template.
                let nextContent = currentContent;
                const prevTitle = currentName.trim() || "my_skill";
                const nextTitle = nextName.trim() || "my_skill";
                if (currentContent.includes(`name: ${prevTitle}`) || currentContent.includes(`# ${prevTitle}`)) {
                  nextContent = currentContent
                    .replace(new RegExp(`^name:\\s*${prevTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"), `name: ${nextTitle}`)
                    .replace(new RegExp(`^#\\s*${prevTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"), `# ${nextTitle}`);
                }
                setView({ kind: "editor", mode, name: nextName, content: nextContent });
              }}
              autoFocus
            />
          </div>
        )}

        <div className="skills-field skills-field-grow">
          <label className="skills-label" htmlFor="skill-content">
            SKILL.md
          </label>
          <textarea
            id="skill-content"
            className="skills-textarea"
            value={currentContent}
            spellCheck={false}
            onChange={(e) => {
              setEditorDirty(true);
              setView({ kind: "editor", mode, name: currentName, content: e.target.value });
            }}
          />
        </div>

        <p className="skills-hint-bar">
          {zh
            ? "保存后会自动热重载到当前 Agent 会话"
            : "Saving will automatically hot-reload into the current agent session"}
        </p>
        {actionToast ? (
          <SkillsActionToast toast={actionToast} />
        ) : null}
      </div>
    );
  }

  return <></>;
}

// ── Header sub-component ───────────────────────────────────────────────────────

function SquareSortMenu({
  value,
  zh,
  onChange,
}: {
  value: SquareSort;
  zh: boolean;
  onChange: (value: SquareSort) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const options = [
    { id: "time" as const, Icon: Clock, label: zh ? "最新" : "Latest" },
    { id: "name" as const, Icon: ArrowDownAZ, label: zh ? "名称" : "Name" },
  ];
  const current = options.find((option) => option.id === value) ?? options[0];

  return (
    <div className="skills-online-sort-menu" ref={rootRef}>
      <button
        type="button"
        className={`skills-filter-chip skills-online-sort-trigger${open ? " active" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((prev) => !prev); }}
      >
        <current.Icon size={12} aria-hidden />
        {current.label}
        <ChevronDown size={12} className={`skills-online-sort-chevron${open ? " open" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="skills-online-sort-dropdown" role="listbox" aria-label={zh ? "排序方式" : "Sort by"}>
          {options.map(({ id, Icon, label }) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={value === id}
              className={`skills-online-sort-option${value === id ? " active" : ""}`}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
            >
              <Icon size={13} aria-hidden />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SkillsActionToast({ toast }: { toast: { type: "success" | "error"; message: string } }): React.JSX.Element {
  return (
    <div
      className={`skills-action-toast skills-action-toast-${toast.type}`}
      role="status"
      aria-live="polite"
    >
      {toast.message}
    </div>
  );
}

function SkillsHeader({ zh }: { zh: boolean }): React.JSX.Element {
  return (
    <div className="skills-header">
      <Zap size={16} />
      <h2 className="skills-title">{zh ? "⚡ Skills 管理" : "⚡ Skills Manager"}</h2>
    </div>
  );
}

function skillAvatarLabel(name: string, slug: string): string {
  const base = (name || slug).trim();
  if (!base) return "?";
  const first = [...base][0];
  return first?.toUpperCase() ?? "?";
}

function SkillAvatar({
  name,
  slug,
  profile,
  className = "",
}: {
  name: string;
  slug: string;
  profile?: string;
  className?: string;
}): React.JSX.Element {
  const label = skillAvatarLabel(name, slug);
  if (profile?.trim()) {
    return (
      <img
        src={profile}
        alt={name}
        className={`skills-skill-avatar-img${className ? ` ${className}` : ""}`}
      />
    );
  }
  return (
    <div className={`skills-online-card-avatar${className ? ` ${className}` : ""}`} aria-hidden>
      {label}
    </div>
  );
}

interface OnlineSkillCardProps {
  skill: DesktopPublicSkill;
  zh: boolean;
  installing: boolean;
  installLocked: boolean;
  onOpen: () => void;
  onInstall: () => void;
}

function OnlineSkillCard({ skill, zh, installing, installLocked, onOpen, onInstall }: OnlineSkillCardProps): React.JSX.Element {
  const displayName = skill.name || skill.slug;
  const tags = (skill.tags ?? []).slice(0, 2);

  return (
    <article
      className={`skills-online-card is-clickable${skill.installed ? " is-installed" : ""}${installing ? " is-installing" : ""}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={zh ? `查看 ${displayName} 详情` : `View ${displayName} details`}
    >
      <div className="skills-online-card-head">
        <SkillAvatar name={displayName} slug={skill.slug} />
        <div className="skills-online-card-title-wrap">
          <h3 className="skills-online-card-title" title={displayName}>{displayName}</h3>
          <p className="skills-online-card-slug" title={skill.slug}>{skill.slug}</p>
        </div>
        {skill.installed ? (
          <span className="skills-online-badge skills-online-badge-ok">
            <CheckCircle2 size={12} />
            {zh ? "已安装" : "Installed"}
          </span>
        ) : null}
      </div>

      <p className="skills-online-card-desc">
        {skill.description || (zh ? "暂无描述" : "No description")}
      </p>

      <div className="skills-online-card-meta">
        {skill.source ? <span className="skills-online-meta-chip">{skill.source}</span> : null}
        {skill.version ? <span className="skills-online-meta-chip">v{skill.version}</span> : null}
        {typeof skill.downloads === "number" ? (
          <span className="skills-online-meta-chip">
            <Download size={11} />
            {skill.downloads}
          </span>
        ) : null}
        {tags.map((tag) => (
          <span key={tag} className="skills-online-meta-chip skills-online-meta-tag">{tag}</span>
        ))}
      </div>

      <div className="skills-online-card-foot">
        {skill.owner ? (
          <span className="skills-online-card-owner" title={skill.owner}>
            {skill.owner}
          </span>
        ) : (
          <span className="skills-online-card-owner skills-online-card-owner-muted">
            {zh ? "公共技能" : "Public"}
          </span>
        )}
        {skill.installed ? (
          <button type="button" className="skills-btn skills-online-install-btn is-done" disabled>
            <CheckCircle2 size={14} />
            {zh ? "已安装" : "Installed"}
          </button>
        ) : (
          <button
            type="button"
            className="skills-btn primary skills-online-install-btn"
            disabled={installing || installLocked}
            onClick={(event) => {
              event.stopPropagation();
              onInstall();
            }}
          >
            {installing ? (
              <>
                <Loader2 size={14} className="spin" />
                {zh ? "安装中" : "Installing"}
              </>
            ) : (
              <>
                <Download size={14} />
                {zh ? "安装" : "Install"}
              </>
            )}
          </button>
        )}
      </div>
    </article>
  );
}

interface OnlineSkillDetailPanelProps {
  zh: boolean;
  installing: boolean;
  state: {
    summary: DesktopPublicSkill;
    detail: DesktopPublicSkillDetail | null;
    loading: boolean;
    error: string | null;
    tab: OnlineDetailTab;
  };
  onClose: () => void;
  onTabChange: (tab: OnlineDetailTab) => void;
  onInstall: () => void;
}

function OnlineSkillDetailPanel({
  zh,
  installing,
  state,
  onClose,
  onTabChange,
  onInstall,
}: OnlineSkillDetailPanelProps): React.JSX.Element {
  const { summary, detail, loading, error, tab } = state;
  const display = detail ?? summary;
  const displayName = display.name || display.slug;
  const tags = display.tags ?? summary.tags ?? [];

  return (
    <div className={`skills-online-detail${installing ? " is-installing" : ""}`}>
      <div className="skills-online-detail-header">
        <button type="button" className="skills-btn" onClick={onClose}>
          <ArrowLeft size={14} />
          {zh ? "返回列表" : "Back"}
        </button>
        <div className="skills-online-detail-title-wrap">
          <SkillAvatar
            name={displayName}
            slug={display.slug}
            profile={detail?.profile}
            className="skills-online-detail-avatar"
          />
          <div className="skills-online-detail-title-meta">
            <h3 className="skills-online-detail-title">{displayName}</h3>
            <div className="skills-online-detail-submeta">
              {display.source ? (
                <span className="skills-online-detail-source">
                  <Globe size={12} />
                  {display.source}
                </span>
              ) : null}
              {display.version && display.version !== "0.0.0" ? (
                <span>v{display.version}</span>
              ) : null}
              {typeof display.downloads === "number" ? (
                <span>
                  <Download size={11} />
                  {display.downloads}
                </span>
              ) : null}
              {display.owner ? <span>{display.owner}</span> : null}
            </div>
          </div>
        </div>
        {summary.installed ? (
          <button type="button" className="skills-btn skills-online-install-btn is-done" disabled>
            <CheckCircle2 size={14} />
            {zh ? "已安装" : "Installed"}
          </button>
        ) : (
          <button
            type="button"
            className="skills-btn primary skills-online-install-btn"
            disabled={installing || loading}
            onClick={onInstall}
          >
            {installing ? (
              <>
                <Loader2 size={14} className="spin" />
                {zh ? "安装中" : "Installing"}
              </>
            ) : (
              <>
                <Download size={14} />
                {zh ? "安装" : "Install"}
              </>
            )}
          </button>
        )}
      </div>

      {installing ? (
        <div className="skills-online-install-banner" role="status" aria-live="polite">
          <Loader2 size={14} className="spin" aria-hidden />
          {zh ? `正在安装「${displayName}」…` : `Installing '${displayName}'…`}
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className="skills-online-detail-tags">
          {tags.map((tag) => (
            <span key={tag} className="skills-online-meta-chip skills-online-meta-tag">{tag}</span>
          ))}
        </div>
      ) : null}

      <div className="skills-online-detail-tabs" role="tablist">
        {([
          ["info", Info, zh ? "基本信息" : "Info"],
          ["description", AlignLeft, zh ? "描述" : "Description"],
          ["content", FileText, zh ? "技能内容" : "Skill Content"],
        ] as const).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`skills-online-detail-tab${tab === id ? " active" : ""}`}
            onClick={() => { onTabChange(id); }}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="skills-online-detail-body">
        {loading ? (
          <div className="skills-online-detail-loading">
            <Loader2 size={22} className="spin" />
            <span>{zh ? "加载详情…" : "Loading details…"}</span>
          </div>
        ) : error ? (
          <div className="skills-online-empty">
            <p className="skills-online-empty-title">{zh ? "加载失败" : "Failed to load"}</p>
            <p className="skills-error">{error}</p>
          </div>
        ) : tab === "info" ? (
          <div className="skills-online-detail-info-grid">
            {detail?.compatibility ? (
              <div className="skills-online-detail-info-card">
                <p className="skills-online-detail-info-label">{zh ? "兼容性" : "Compatibility"}</p>
                <p>{detail.compatibility}</p>
              </div>
            ) : null}
            <div className="skills-online-detail-info-card">
              <p className="skills-online-detail-info-label">{zh ? "标识符" : "Slug"}</p>
              <p className="skills-online-detail-slug">{display.slug}</p>
            </div>
            {detail?.createdAt ? (
              <div className="skills-online-detail-info-card">
                <p className="skills-online-detail-info-label">{zh ? "创建时间" : "Created"}</p>
                <p title={new Date(detail.createdAt).toLocaleString()}>{formatRelativeTime(detail.createdAt, zh)}</p>
              </div>
            ) : null}
            {(detail?.updatedAt || summary.updatedAt) ? (
              <div className="skills-online-detail-info-card">
                <p className="skills-online-detail-info-label">{zh ? "更新时间" : "Updated"}</p>
                <p title={new Date(detail?.updatedAt || summary.updatedAt || "").toLocaleString()}>
                  {formatRelativeTime(detail?.updatedAt || summary.updatedAt || "", zh)}
                </p>
              </div>
            ) : null}
          </div>
        ) : tab === "description" ? (
          <p className="skills-online-detail-desc">
            {display.description || (zh ? "暂无描述" : "No description")}
          </p>
        ) : detail?.body && !detail.restricted ? (
          <SkillMarkdownContent body={detail.body} zh={zh} />
        ) : (
          <p className="skills-online-detail-desc skills-online-detail-desc-muted">
            {detail?.restricted
              ? (zh ? "该技能内容受限制，无法预览。" : "Skill content is restricted.")
              : (zh ? "暂无技能内容" : "No skill content available")}
          </p>
        )}

        {detail?.changelog && tab === "info" ? (
          <div className="skills-online-detail-changelog">
            <p className="skills-online-detail-info-label">{zh ? "更新日志" : "Changelog"}</p>
            <p>{detail.changelog}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
