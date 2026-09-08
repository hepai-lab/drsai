/**
 * SkillsSquarePanel — Desktop Skills Square (public / created / collected / publish).
 * Uses desktopApi Skills Square IPC and existing `.skills-online*` CSS.
 */

import {
  AlignLeft,
  ArrowDownAZ,
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  Bot,
  Boxes,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Info,
  Link2,
  List,
  Loader2,
  Lock,
  MessageSquare,
  Music,
  Package,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Share2,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  User,
  Video,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type JSX,
  type RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  DesktopSquareShareInfo,
  DesktopSquareSkill,
  DesktopSquareSkillDetail,
  DesktopSquareSkillStats,
  DesktopSquareSkillTag,
  SkillsSquareStatus,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import { copyTextSafely } from "../clipboard";
import type { AppLanguage } from "../navigation";
import { requestAppDecision } from "./AppDecisionDialog";
import {
  extractMarkdownToc,
  fileToBase64,
  formatBytes,
  listFolderFileEntries,
  listZipFileEntries,
  zipFolderFileListToZipFile,
  type PackPreviewEntry,
} from "./skillsSquarePack";

// ── Props / types ──────────────────────────────────────────────────────────────

export interface SkillsSquarePanelProps {
  language: AppLanguage;
  userId?: string;
  userEmail?: string;
  /** Optional thread for post-install skill reload. */
  threadId?: string;
  /** Optional initial square surface (defaults to public). */
  initialMode?: SquareMode;
  /** Admin can manage skill tags. */
  isAdmin?: boolean;
}

export type SquareMode = "public" | "created" | "collected" | "publish";
type PublishVisibility = "public" | "private" | "team";

type SortBy = "time" | "name" | "downloads";
type DetailTab = "info" | "description" | "content";
type ToastState = { type: "success" | "error"; message: string } | null;

const PAGE_SIZE = 20;
const USER_PAGE_SIZE = 200;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHARE_EXPIRY_PRESETS = [
  { hours: 1, label: "1h" },
  { hours: 24, label: "24h" },
  { hours: 168, label: "7d" },
  { hours: 720, label: "30d" },
] as const;

const PUBLISH_ICON_OPTIONS: { id: string; Icon: LucideIcon }[] = [
  { id: "package", Icon: Package },
  { id: "wrench", Icon: Wrench },
  { id: "code2", Icon: Code2 },
  { id: "sparkles", Icon: Sparkles },
  { id: "bot", Icon: Bot },
  { id: "file-text", Icon: FileText },
  { id: "search", Icon: Search },
  { id: "database", Icon: Database },
  { id: "globe", Icon: Globe },
  { id: "palette", Icon: Palette },
  { id: "camera", Icon: Camera },
  { id: "music", Icon: Music },
  { id: "video", Icon: Video },
  { id: "book-open", Icon: BookOpen },
  { id: "message-square", Icon: MessageSquare },
  { id: "settings", Icon: Settings },
  { id: "image", Icon: ImageIcon },
  { id: "boxes", Icon: Boxes },
];
const PUBLISH_ICON_IDS = new Set(PUBLISH_ICON_OPTIONS.map((o) => o.id));

// ── Helpers ────────────────────────────────────────────────────────────────────

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sanitizeChangelog(v?: string | null): string {
  return v && v !== "undefined" ? v : "";
}

/** Backend naive datetimes (no Z/offset) are UTC instants — match WebUI `parseApiDateAsUtc`. */
function parseApiDateAsUtc(isoLike: string | undefined | null): Date | null {
  if (isoLike == null) return null;
  const s = String(isoLike).trim();
  if (!s) return null;
  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized);
  const date = hasTz ? new Date(normalized) : new Date(`${normalized}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeTime(iso: string | undefined, zh: boolean): string {
  if (!iso) return "";
  const date = parseApiDateAsUtc(iso);
  if (!date) return iso;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return zh ? "刚刚" : "just now";
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay > 0) return zh ? `${diffDay} 天前` : `${diffDay}d ago`;
  if (diffHour > 0) return zh ? `${diffHour} 小时前` : `${diffHour}h ago`;
  if (diffMin > 0) return zh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  return zh ? "刚刚" : "just now";
}

function skillAvatarLabel(name: string, slug: string): string {
  const base = (name || slug).trim();
  if (!base) return "?";
  return ([...base][0] ?? "?").toUpperCase();
}

function isEmojiIcon(icon: string | undefined): boolean {
  if (!icon) return false;
  if (/^https?:\/\//.test(icon) || icon === "__profile__") return false;
  return /[^\x00-\x7F]/.test(icon) && icon.length <= 8;
}

function ownerInitial(owner: string | undefined): string {
  const label = (owner || "").trim();
  if (!label) return "";
  return ([...label][0] ?? "").toUpperCase();
}

function formatVersionPill(version: string | undefined): string | null {
  if (!version || version === "0.0.0") return null;
  return version.startsWith("v") ? version : `v${version}`;
}

const SKILLS_SQUARE_TEST_PORTAL = "https://drsaiv2.ihep.ac.cn";
const SKILLS_SQUARE_PROD_PORTAL = "https://opendrsai.ihep.ac.cn";

/** Match main `resolveSkillsSquareApiRoot` when IPC has not yet stamped portalUrl. */
function resolveDefaultSkillsPortalUrl(): string {
  const mode = (import.meta.env.VITE_OPENDRSAI_LAUNCH_MODE || "").trim().toLowerCase();
  if (mode === "development" || mode === "dev") return SKILLS_SQUARE_TEST_PORTAL;
  if (mode === "production" || mode === "prod") return SKILLS_SQUARE_PROD_PORTAL;
  if (import.meta.env.DEV) return SKILLS_SQUARE_TEST_PORTAL;
  return SKILLS_SQUARE_PROD_PORTAL;
}

/** Prefer main-built URL (test=drsaiv2 / prod=opendrsai). */
function shareLandingUrl(
  shareId: string,
  portalUrl?: string | null,
  shareUrl?: string | null,
): string {
  const fromApi = (shareUrl || "").trim();
  if (fromApi) return fromApi;
  const id = shareId.trim();
  if (!id) return "";
  const origin =
    (portalUrl || "").trim() || resolveDefaultSkillsPortalUrl();
  return `${origin.replace(/\/+$/, "")}/share/skill/${encodeURIComponent(id)}`;
}

/** Collected if collector_ids contains my email or OIDC subject. */
function isCollectedRow(
  skill: DesktopSquareSkill,
  email?: string,
  subject?: string,
): boolean {
  // Main may clear isCollected via local uncollect overlay while host still
  // returns stale OIDC collector ids — trust the resolved flag when false.
  if (skill.isCollected === false) return false;
  const needles = [email, subject]
    .map((v) => (v || "").trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) {
    return skill.uskillsType === "imported" || skill.isCollected === true;
  }
  if ((skill.collectorIds || []).some((id) => needles.includes(normalizeEmail(id)))) {
    return true;
  }
  return skill.isCollected === true || skill.uskillsType === "imported";
}

/** Created if I own it (email or subject) and it is not collected. */
function isCreatedRow(
  skill: DesktopSquareSkill,
  email?: string,
  subject?: string,
): boolean {
  if (skill.uskillsType === "imported" || isCollectedRow(skill, email, subject)) {
    return false;
  }
  const needles = [email, subject]
    .map((v) => (v || "").trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) return skill.uskillsType === "created";
  return (
    needles.includes(normalizeEmail(skill.ownerId)) ||
    needles.includes(normalizeEmail(skill.owner))
  );
}

function normalizeEmail(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function isSkillOwner(
  skill: DesktopSquareSkill,
  email?: string,
  subject?: string,
): boolean {
  const needles = [email, subject]
    .map((v) => (v || "").trim().toLowerCase())
    .filter(Boolean);
  if (needles.length === 0) return false;
  return (
    needles.includes(normalizeEmail(skill.ownerId)) ||
    needles.includes(normalizeEmail(skill.owner))
  );
}

function statusBannerClass(state: SkillsSquareStatus["state"]): string {
  if (state === "error" || state === "forbidden" || state === "requires_login") {
    return "agent-square-error";
  }
  return "agent-square-notice";
}

function statusBannerText(status: SkillsSquareStatus, zh: boolean): string {
  const raw = status.message?.trim() || "";
  if (raw) {
    if (zh && /OIDC session required for Skills Square/i.test(raw)) {
      return "需要 HepAI OIDC 登录才能使用技能广场。";
    }
    if (zh && /Sign in with HepAI OIDC/i.test(raw)) {
      return "请先使用 HepAI OIDC 登录桌面端。";
    }
    return raw;
  }
  if (status.state === "requires_login") {
    return zh
      ? "需要 HepAI OIDC 登录才能使用技能广场。"
      : "Sign in with HepAI OIDC to use Skills Square.";
  }
  if (status.state === "forbidden") {
    return zh ? "当前账号无权访问技能广场。" : "This account cannot access Skills Square.";
  }
  if (status.state === "error") {
    return zh ? "技能广场暂时不可用。" : "Skills Square is temporarily unavailable.";
  }
  return zh ? "技能广场未就绪。" : "Skills Square is not ready.";
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SkillsSquarePanel(props: SkillsSquarePanelProps): JSX.Element {
  const {
    language,
    userId,
    userEmail,
    threadId,
    initialMode = "public",
    isAdmin = false,
  } = props;
  const zh = language === "zh";
  // WebUI uses account email as skills user_id / collector identity — never a bare OIDC sub.
  const operatorEmail =
    (userEmail?.trim() && userEmail.includes("@") ? userEmail.trim() : undefined) ||
    (userId?.trim() && userId.includes("@") ? userId.trim() : undefined);
  const operatorSubject =
    userId?.trim() && !userId.includes("@") ? userId.trim() : undefined;
  const operatorId = userId?.trim() || operatorEmail;

  const [mode, setMode] = useState<SquareMode>(initialMode);

  const [toast, setToast] = useState<ToastState>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((type: "success" | "error", message: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ type, message });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const [status, setStatus] = useState<SkillsSquareStatus | null>(null);
  const [stats, setStats] = useState<DesktopSquareSkillStats | null>(null);
  const [tags, setTags] = useState<DesktopSquareSkillTag[]>([]);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [activeTag, setActiveTag] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("time");
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<DesktopSquareSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasNext, setHasNext] = useState(false);
  const pageRef = useRef(1);
  const fetchGenRef = useRef(0);
  const hasNextRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<DesktopSquareSkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("info");
  const [busySlug, setBusySlug] = useState<string | null>(null);

  // Publish form
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [zipFileName, setZipFileName] = useState<string | null>(null);
  const [zipFileSize, setZipFileSize] = useState<number | null>(null);
  const [zipBase64, setZipBase64] = useState<string | null>(null);
  const [publishDisplayName, setPublishDisplayName] = useState("");
  const [publishSlug, setPublishSlug] = useState("");
  const [publishVersion, setPublishVersion] = useState("1.0.0");
  const [publishChangelog, setPublishChangelog] = useState("");
  const [publishDescription, setPublishDescription] = useState("");
  const [publishTags, setPublishTags] = useState("");
  const [publishVisibility, setPublishVisibility] = useState<PublishVisibility>("private");
  const [publishIcon, setPublishIcon] = useState("");
  const [profileBase64, setProfileBase64] = useState<string | null>(null);
  const [profileFileName, setProfileFileName] = useState<string | null>(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState<string | null>(null);
  const [packPreview, setPackPreview] = useState<PackPreviewEntry[]>([]);
  const [packingFolder, setPackingFolder] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);

  // Tag admin modal
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [tagEditId, setTagEditId] = useState<number | null>(null);
  const [tagEditName, setTagEditName] = useState("");
  const [tagEditOrder, setTagEditOrder] = useState(0);
  const [tagBusy, setTagBusy] = useState(false);

  // Share dialog
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [shareName, setShareName] = useState("");
  /** Prefer SkillMeta.owner_id from detail — legacy share APIs match it exactly. */
  const [shareOwnerId, setShareOwnerId] = useState<string | null>(null);
  const [sharePassword, setSharePassword] = useState("");
  const [shareExpiryHours, setShareExpiryHours] = useState(24);
  const [shareList, setShareList] = useState<DesktopSquareShareInfo[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCreating, setShareCreating] = useState(false);
  const [lastShareUrl, setLastShareUrl] = useState("");

  const availableTagNames = useMemo(
    () => [...tags].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((t) => t.name),
    [tags],
  );

  const filteredRows = useMemo(() => {
    if (mode === "public" || mode === "publish") return rows;
    const q = search.trim().toLowerCase();
    let source = rows;
    if (mode === "created") {
      source = rows.filter((r) => isCreatedRow(r, operatorEmail, operatorSubject));
    } else if (mode === "collected") {
      source = rows.filter((r) => isCollectedRow(r, operatorEmail, operatorSubject));
    }
    if (activeTag) {
      source = source.filter((r) => (r.tags || []).includes(activeTag));
    }
    if (q) {
      source = source.filter((r) => {
        const hay = `${r.name ?? ""} ${r.description ?? ""} ${r.owner ?? ""} ${r.slug}`.toLowerCase();
        return hay.includes(q);
      });
    }
    return [...source].sort((a, b) => {
      if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
      if (sortBy === "downloads") return (b.downloads ?? 0) - (a.downloads ?? 0);
      return (
        (parseApiDateAsUtc(b.updatedAt)?.getTime() || 0) -
        (parseApiDateAsUtc(a.updatedAt)?.getTime() || 0)
      );
    });
  }, [rows, mode, operatorEmail, operatorSubject, search, activeTag, sortBy]);

  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const clearProfilePreview = useCallback(() => {
    setProfilePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setProfileBase64(null);
    setProfileFileName(null);
  }, []);

  const resetPublishForm = useCallback(() => {
    setEditingSlug(null);
    setZipFileName(null);
    setZipFileSize(null);
    setZipBase64(null);
    setPublishDisplayName("");
    setPublishSlug("");
    setPublishVersion("1.0.0");
    setPublishChangelog("");
    setPublishDescription("");
    setPublishTags("");
    setPublishVisibility("private");
    setPublishIcon("");
    setPackPreview([]);
    clearProfilePreview();
    if (zipInputRef.current) zipInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
    if (profileInputRef.current) profileInputRef.current.value = "";
  }, [clearProfilePreview]);

  useEffect(() => {
    setDetailSlug(null);
    setDetail(null);
    setSearch("");
    setSearchExpanded(false);
    setActiveTag("");
    setSortBy("time");
    if (mode !== "publish") {
      setEditingSlug(null);
      setPublishDescription("");
      setPackPreview([]);
      clearProfilePreview();
    }
  }, [mode, clearProfilePreview]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const tasks: Promise<void>[] = [
        (async () => {
          try {
            const s = await desktopApi.getSkillsSquareStatus();
            if (!cancelled) setStatus(s);
          } catch (e) {
            if (!cancelled) {
              setStatus({
                state: "error",
                message: errMsg(e),
                lastCheckedAt: new Date().toISOString(),
              });
            }
          }
        })(),
        (async () => {
          try {
            const tagRows = await desktopApi.listSkillsSquareTags({
              operatorUserId: operatorEmail || operatorId,
            });
            if (!cancelled) setTags(tagRows ?? []);
          } catch {
            /* ignore */
          }
        })(),
      ];
      if (mode === "public") {
        tasks.push(
          (async () => {
            try {
              const st = await desktopApi.getSkillsSquareStats();
              if (!cancelled) setStats(st);
            } catch {
              /* ignore */
            }
          })(),
        );
      }
      await Promise.all(tasks);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, operatorEmail, operatorId]);

  const loadPublicPage = useCallback(
    async (page: number, append: boolean) => {
      const gen = append ? fetchGenRef.current : ++fetchGenRef.current;
      if (append) {
        if (loadingMoreRef.current || !hasNextRef.current) return;
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoading(true);
        setLoadingMore(false);
        loadingMoreRef.current = false;
        setRows([]);
        pageRef.current = 1;
        setHasNext(false);
        hasNextRef.current = false;
      }
      try {
        const data = await desktopApi.listSkillsSquare({
          scope: "public",
          page,
          pageSize: PAGE_SIZE,
          q: debouncedSearch || undefined,
          tags: activeTag || undefined,
          sort: sortBy,
          userId: operatorEmail || operatorId,
          userEmail: operatorEmail,
        });
        if (gen !== fetchGenRef.current) return;
        if (data.status) setStatus(data.status);
        setRows((prev) => {
          if (!append) return data.items ?? [];
          const seen = new Set(prev.map((r) => r.slug));
          const extra = (data.items ?? []).filter((r) => r.slug && !seen.has(r.slug));
          return extra.length ? [...prev, ...extra] : prev;
        });
        pageRef.current = page;
        const next = Boolean(data.hasNext);
        setHasNext(next);
        hasNextRef.current = next;
      } catch (e) {
        if (gen !== fetchGenRef.current) return;
        if (!append) {
          setRows([]);
          showToast("error", `${zh ? "加载失败" : "Load failed"}: ${errMsg(e)}`);
        }
      } finally {
        // Always clear loading for this generation's page load, even if a newer
        // fetch superseded it — otherwise a cancelled OIDC hang leaves skeletons.
        if (append) {
          if (gen === fetchGenRef.current) {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          }
        } else {
          setLoading(false);
        }
      }
    },
    [debouncedSearch, activeTag, sortBy, operatorId, operatorEmail, showToast, zh],
  );

  const loadUserSkills = useCallback(async () => {
    const gen = ++fetchGenRef.current;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setRows([]);
    setHasNext(false);
    hasNextRef.current = false;
    try {
      if (!operatorEmail) {
        setStatus({
          state: "requires_login",
          message: zh
            ? "需要带邮箱的登录账号才能加载「我的创建 / 我的收藏」。"
            : "Sign in with an account email to load creations and collections.",
          lastCheckedAt: new Date().toISOString(),
        });
        return;
      }
      const data = await desktopApi.listSkillsSquare({
        scope: "user",
        page: 1,
        pageSize: USER_PAGE_SIZE,
        userId: operatorEmail,
        userEmail: operatorEmail,
      });
      if (gen !== fetchGenRef.current) return;
      if (data.status) setStatus(data.status);
      setRows(data.items ?? []);
      setHasNext(false);
      hasNextRef.current = false;
    } catch (e) {
      if (gen !== fetchGenRef.current) return;
      setRows([]);
      showToast("error", `${zh ? "加载失败" : "Load failed"}: ${errMsg(e)}`);
    } finally {
      if (gen === fetchGenRef.current) setLoading(false);
    }
  }, [operatorEmail, showToast, zh]);

  useEffect(() => {
    if (mode === "publish" || detailSlug) return;
    if (mode === "public") {
      void loadPublicPage(1, false);
    } else {
      void loadUserSkills();
    }
  }, [mode, detailSlug, loadPublicPage, loadUserSkills]);

  useEffect(() => {
    if (mode !== "public" || loading || detailSlug) return;
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadPublicPage(pageRef.current + 1, true);
        }
      },
      { root, rootMargin: "160px", threshold: 0 },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [mode, loading, hasNext, rows.length, detailSlug, loadPublicPage]);

  useEffect(() => {
    if (!detailSlug) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailTab("info");
    void (async () => {
      try {
        const d = await desktopApi.getSkillsSquareDetail({
          slug: detailSlug,
          userEmail: operatorEmail,
        });
        if (!cancelled) setDetail(d);
      } catch (e) {
        if (!cancelled) {
          setDetail(null);
          showToast("error", `${zh ? "详情加载失败" : "Detail failed"}: ${errMsg(e)}`);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detailSlug, operatorEmail, showToast, zh]);

  const openDetail = (slug: string) => setDetailSlug(slug);
  const closeDetail = () => {
    setDetailSlug(null);
    setDetail(null);
  };

  const handleInstallLocal = async (skill: { slug: string; name?: string }) => {
    setBusySlug(skill.slug);
    try {
      const result = await desktopApi.installSkillsSquare({
        slug: skill.slug,
        name: skill.name,
        userId,
        threadId,
      });
      setRows((prev) =>
        prev.map((r) => (r.slug === skill.slug ? { ...r, installed: true } : r)),
      );
      setDetail((d) => (d && d.slug === skill.slug ? { ...d, installed: true } : d));
      showToast(
        "success",
        zh
          ? `已安装到本地「${result.name}」（${result.files} 个文件），可在「本地技能」查看`
          : `Installed locally as '${result.name}' (${result.files} files). See Local skills.`,
      );
    } catch (e) {
      showToast("error", `${zh ? "安装失败" : "Install failed"}: ${errMsg(e)}`);
    } finally {
      setBusySlug(null);
    }
  };

  const openEditFromDetail = (d: DesktopSquareSkillDetail) => {
    setEditingSlug(d.slug);
    setPublishDisplayName(d.name || d.slug);
    setPublishSlug(d.slug);
    setPublishVersion(d.version && d.version !== "0.0.0" ? d.version : "1.0.0");
    setPublishChangelog(sanitizeChangelog(d.changelog));
    setPublishDescription(d.description || "");
    setPublishTags((d.tags ?? []).join(", "));
    setPublishVisibility(
      d.visibility === "public" || d.visibility === "team" ? d.visibility : "private",
    );
    const iconVal = d.icon || "";
    setPublishIcon(
      iconVal === "__profile__" || PUBLISH_ICON_IDS.has(iconVal)
        ? iconVal
        : /^https?:\/\//.test(iconVal)
          ? "__profile__"
          : isEmojiIcon(iconVal)
            ? iconVal
            : "",
    );
    setZipFileName(null);
    setZipFileSize(null);
    setZipBase64(null);
    setPackPreview([]);
    clearProfilePreview();
    setDetailSlug(null);
    setDetail(null);
    setMode("publish");
  };

  const handleCollect = async (skill: DesktopSquareSkill | DesktopSquareSkillDetail) => {
    if (isSkillOwner(skill, operatorEmail, operatorSubject)) {
      showToast("error", zh ? "不能收藏自己发布的技能" : "You cannot collect your own skill");
      return;
    }
    if (isCollectedRow(skill, operatorEmail, operatorSubject) || skill.isCollected) {
      showToast("success", zh ? "已收藏" : "Already collected");
      return;
    }
    setBusySlug(skill.slug);
    try {
      await desktopApi.collectSkillsSquare({
        slug: skill.slug,
        displayName: skill.name,
        icon: skill.icon,
        description: skill.description,
        version: skill.version,
        tags: skill.tags?.join(", "),
        owner: skill.owner,
        ownerId: skill.ownerId,
        changelog: skill.changelog,
      });
      const stampIds = [operatorEmail, operatorSubject].filter(Boolean) as string[];
      setRows((prev) =>
        prev.map((r) =>
          r.slug === skill.slug
            ? {
                ...r,
                isCollected: true,
                collectorIds: Array.from(
                  new Set([...(r.collectorIds || []), ...stampIds]),
                ),
              }
            : r,
        ),
      );
      setDetail((prev) =>
        prev && prev.slug === skill.slug
          ? {
              ...prev,
              isCollected: true,
              collectorIds: Array.from(
                new Set([...(prev.collectorIds || []), ...stampIds]),
              ),
            }
          : prev,
      );
      showToast("success", zh ? "已收藏（不会自动用于对话）" : "Collected (not used in chat automatically)");
      if (mode === "collected") {
        void loadUserSkills();
      }
    } catch (e) {
      showToast("error", `${zh ? "收藏失败" : "Collect failed"}: ${errMsg(e)}`);
    } finally {
      setBusySlug(null);
    }
  };

  const handleDeleteOrUncollect = async (
    slug: string,
    displayName: string,
    intent: "delete" | "uncollect",
  ) => {
    if (intent === "delete") {
      const approved = await requestAppDecision({
        id: `ssq-delete-${slug}`,
        tone: "danger",
        title: zh ? "确认删除技能？" : "Delete skill?",
        description: zh
          ? `将永久删除「${displayName}」，此操作不可撤销。`
          : `Permanently delete '${displayName}'. This cannot be undone.`,
        impact: zh ? "云端技能记录将被移除。" : "The cloud skill record will be removed.",
        confirmLabel: zh ? "确认删除" : "Delete",
      });
      if (!approved) return;
    }
    setBusySlug(slug);
    try {
      // WebUI parity: type=user&user_id={email} (see deleteSkillsSquare main).
      await desktopApi.deleteSkillsSquare({
        slug,
        intent,
        userId: operatorEmail || operatorId,
        userEmail: operatorEmail,
      });
      if (intent === "uncollect") {
        const needles = [operatorEmail, operatorSubject]
          .map((v) => normalizeEmail(v))
          .filter(Boolean);
        const stripLocal = <T extends DesktopSquareSkill>(row: T): T => ({
          ...row,
          isCollected: false,
          uskillsType: row.uskillsType === "imported" ? undefined : row.uskillsType,
          collectorIds: (row.collectorIds || []).filter(
            (id) => !needles.includes(normalizeEmail(id)),
          ),
          collects: Math.max(
            0,
            (row.collects ?? (row.collectorIds || []).length) - 1,
          ),
        });
        if (mode === "public") {
          setRows((prev) => prev.map((r) => (r.slug === slug ? stripLocal(r) : r)));
          setDetail((prev) => (prev && prev.slug === slug ? stripLocal(prev) : prev));
        } else {
          setRows((prev) => prev.filter((r) => r.slug !== slug));
          if (detailSlug === slug) closeDetail();
          // Reload so overlay-aware main mapping drops the row from「我的收藏」.
          if (mode === "collected" || mode === "created") {
            void loadUserSkills();
          }
        }
      } else {
        setRows((prev) => prev.filter((r) => r.slug !== slug));
        if (detailSlug === slug) closeDetail();
        // Hard delete removes the shared SkillMeta — refresh so public market
        // does not keep showing a stale local list if we stay on this surface.
        if (mode === "public") {
          void loadPublicPage(1, false);
        } else if (mode === "created" || mode === "collected") {
          void loadUserSkills();
        }
      }
      showToast(
        "success",
        intent === "uncollect"
          ? zh
            ? `已取消收藏「${displayName}」`
            : `Uncollected '${displayName}'`
          : zh
            ? `已删除「${displayName}」`
            : `Deleted '${displayName}'`,
      );
    } catch (e) {
      showToast("error", `${zh ? "操作失败" : "Action failed"}: ${errMsg(e)}`);
    } finally {
      setBusySlug(null);
    }
  };

  const handleToggleVisibility = async (slug: string, visibility: PublishVisibility) => {
    setBusySlug(slug);
    try {
      const result = await desktopApi.toggleSkillsSquareVisibility({
        slug,
        visibility,
      });
      setRows((prev) =>
        prev.map((r) => (r.slug === slug ? { ...r, visibility: result.visibility } : r)),
      );
      setDetail((prev) =>
        prev && prev.slug === slug ? { ...prev, visibility: result.visibility } : prev,
      );
      showToast(
        "success",
        result.visibility === "public"
          ? zh
            ? `「${slug}」已公开`
            : `'${slug}' listed`
          : zh
            ? `「${slug}」已下架`
            : `'${slug}' unlisted`,
      );
    } catch (e) {
      showToast("error", `${zh ? "可见性更新失败" : "Visibility failed"}: ${errMsg(e)}`);
    } finally {
      setBusySlug(null);
    }
  };

  const handleZipPicked = async (file: File | null) => {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      showToast("error", zh ? "请选择 ZIP 文件" : "Please choose a ZIP file");
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      setZipBase64(b64);
      setZipFileName(file.name);
      setZipFileSize(file.size);
      const stem = file.name.replace(/\.zip$/i, "");
      setPublishDisplayName((prev) => (prev.trim() ? prev : stem));
      setPublishSlug((prev) =>
        prev.trim()
          ? prev
          : stem
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
      );
      try {
        setPackPreview(await listZipFileEntries(file));
      } catch {
        setPackPreview([]);
      }
    } catch (e) {
      showToast("error", `${zh ? "读取失败" : "Read failed"}: ${errMsg(e)}`);
    }
  };

  const handleZipInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    void handleZipPicked(file);
  };

  const handleFolderInputChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    e.target.value = "";
    if (!list?.length) return;
    setPackingFolder(true);
    try {
      const preview = listFolderFileEntries(list);
      const zipFile = await zipFolderFileListToZipFile(list);
      const b64 = await fileToBase64(zipFile);
      setZipBase64(b64);
      setZipFileName(zipFile.name);
      setZipFileSize(zipFile.size);
      setPackPreview(preview);
      const stem = zipFile.name.replace(/\.zip$/i, "");
      setPublishDisplayName((prev) => (prev.trim() ? prev : stem));
      setPublishSlug((prev) =>
        prev.trim()
          ? prev
          : stem
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, ""),
      );
      showToast("success", zh ? "文件夹已打包为 ZIP" : "Folder packed into ZIP");
    } catch (err) {
      showToast("error", `${zh ? "打包失败" : "Pack failed"}: ${errMsg(err)}`);
    } finally {
      setPackingFolder(false);
    }
  };

  const handleProfileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;
    if (!/^image\//i.test(file.type)) {
      showToast("error", zh ? "请选择图片文件" : "Please choose an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("error", zh ? "封面图不能超过 2MB" : "Cover image must be under 2MB");
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      clearProfilePreview();
      setProfileBase64(b64);
      setProfileFileName(file.name);
      setProfilePreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      showToast("error", `${zh ? "读取封面失败" : "Cover read failed"}: ${errMsg(err)}`);
    }
  };

  const reloadTags = async () => {
    try {
      const tagRows = await desktopApi.listSkillsSquareTags({
        operatorUserId: operatorEmail || operatorId,
      });
      setTags(tagRows ?? []);
    } catch {
      /* ignore */
    }
  };

  const handleSaveTag = async () => {
    const name = tagEditName.trim();
    if (!name) {
      showToast("error", zh ? "请填写标签名称" : "Tag name is required");
      return;
    }
    const operatorUserId = operatorEmail || operatorId;
    setTagBusy(true);
    try {
      if (tagEditId != null) {
        await desktopApi.updateSkillsSquareTag({
          tagId: tagEditId,
          name,
          sortOrder: tagEditOrder,
          operatorUserId,
        });
        showToast("success", zh ? "标签已更新" : "Tag updated");
      } else {
        await desktopApi.createSkillsSquareTag({
          name,
          sortOrder: tagEditOrder,
          operatorUserId,
        });
        showToast("success", zh ? "标签已添加" : "Tag added");
      }
      setTagEditId(null);
      setTagEditName("");
      setTagEditOrder(0);
      await reloadTags();
    } catch (e) {
      showToast("error", `${zh ? "标签保存失败" : "Tag save failed"}: ${errMsg(e)}`);
    } finally {
      setTagBusy(false);
    }
  };

  const handleDeleteTag = async (tag: DesktopSquareSkillTag) => {
    const approved = await requestAppDecision({
      id: `ssq-delete-tag-${tag.id}`,
      tone: "danger",
      title: zh ? "删除标签？" : "Delete tag?",
      description: zh
        ? `将删除标签「${tag.name}」。已使用该标签的技能不会被删除。`
        : `Delete tag '${tag.name}'. Skills using it are not deleted.`,
      confirmLabel: zh ? "删除" : "Delete",
    });
    if (!approved) return;
    setTagBusy(true);
    try {
      await desktopApi.deleteSkillsSquareTag({
        tagId: tag.id,
        operatorUserId: operatorEmail || operatorId,
      });
      if (tagEditId === tag.id) {
        setTagEditId(null);
        setTagEditName("");
        setTagEditOrder(0);
      }
      showToast("success", zh ? "标签已删除" : "Tag deleted");
      await reloadTags();
    } catch (e) {
      showToast("error", `${zh ? "删除失败" : "Delete failed"}: ${errMsg(e)}`);
    } finally {
      setTagBusy(false);
    }
  };

  const handleSubmitPublish = async () => {
    const isEdit = Boolean(editingSlug);
    if (!isEdit && (!zipBase64 || !zipFileName)) {
      showToast("error", zh ? "请先选择技能 ZIP 包" : "Please pick a skill ZIP first");
      return;
    }
    const dn = publishDisplayName.trim();
    if (!dn) {
      showToast("error", zh ? "请填写显示名称" : "Display name is required");
      return;
    }
    const version = publishVersion.trim();
    if (!version) {
      showToast("error", zh ? "请填写版本号" : "Version is required");
      return;
    }
    const slugTrim = (editingSlug || publishSlug).trim().toLowerCase();
    if (!isEdit && slugTrim && !SLUG_RE.test(slugTrim)) {
      showToast(
        "error",
        zh ? "标识符仅允许小写字母、数字与连字符" : "Slug must be lowercase letters, digits, hyphens",
      );
      return;
    }
    if (isEdit && !slugTrim) {
      showToast("error", zh ? "缺少技能标识符" : "Missing skill slug");
      return;
    }

    setPublishing(true);
    try {
      const tagsCsv = publishTags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .join(", ");
      const profilePayload =
        profileBase64 && profileFileName
          ? { profileBase64, profileFileName }
          : {};
      if (isEdit && editingSlug) {
        await desktopApi.updateSkillsSquare({
          slug: editingSlug,
          zipBase64: zipBase64 || undefined,
          fileName: zipFileName || undefined,
          displayName: dn,
          icon: publishIcon.trim() || undefined,
          description: publishDescription.trim() || undefined,
          version,
          changelog: publishChangelog.trim() || undefined,
          tags: tagsCsv || undefined,
          visibility: publishVisibility,
          ...profilePayload,
        });
        showToast("success", zh ? "技能已更新" : "Skill updated");
      } else {
        await desktopApi.uploadSkillsSquare({
          zipBase64: zipBase64!,
          fileName: zipFileName!,
          slug: slugTrim || undefined,
          displayName: dn,
          icon: publishIcon.trim() || undefined,
          description: publishDescription.trim() || undefined,
          version,
          changelog: publishChangelog.trim() || undefined,
          tags: tagsCsv || undefined,
          visibility: publishVisibility,
          source: "created",
          owner: operatorEmail || operatorId,
          ownerId: operatorEmail || operatorId,
          ...profilePayload,
        });
        showToast("success", zh ? "发布成功，可在「我的创建」中查看" : "Published — check My creations");
      }
      resetPublishForm();
      setMode("created");
    } catch (e) {
      showToast(
        "error",
        `${isEdit ? (zh ? "更新失败" : "Update failed") : zh ? "发布失败" : "Publish failed"}: ${errMsg(e)}`,
      );
    } finally {
      setPublishing(false);
    }
  };

  const resolveShareUserId = (ownerId?: string | null) => {
    const stamped = (ownerId || shareOwnerId || "").trim();
    if (stamped) return stamped;
    return (operatorEmail || operatorId || "").trim() || undefined;
  };

  const openShare = async (
    slug: string,
    name: string,
    ownerId?: string | null,
  ) => {
    const shareUser = resolveShareUserId(ownerId);
    if (!shareUser) {
      showToast("error", zh ? "请先登录后再分享" : "Sign in to share skills");
      return;
    }
    setShareSlug(slug);
    setShareName(name);
    setShareOwnerId((ownerId || "").trim() || null);
    setSharePassword("");
    setShareExpiryHours(24);
    setLastShareUrl("");
    setShareLoading(true);
    try {
      const items = await desktopApi.listSkillsSquareShares({
        slug,
        userId: shareUser,
        userEmail: operatorEmail,
      });
      setShareList(items ?? []);
    } catch {
      setShareList([]);
    } finally {
      setShareLoading(false);
    }
  };

  const handleCreateShare = async () => {
    if (!shareSlug) return;
    const shareUser = resolveShareUserId();
    if (!shareUser) return;
    if (shareExpiryHours < 1 || shareExpiryHours > 8760) {
      showToast("error", zh ? "有效期无效" : "Invalid expiry");
      return;
    }
    setShareCreating(true);
    try {
      const created = await desktopApi.createSkillsSquareShare({
        slug: shareSlug,
        userId: shareUser,
        userEmail: operatorEmail,
        password: sharePassword.trim() || undefined,
        expiresInHours: shareExpiryHours,
      });
      let portal = status?.portalUrl?.trim() || "";
      if (!portal) {
        try {
          const next = await desktopApi.getSkillsSquareStatus();
          portal = next.portalUrl?.trim() || "";
          if (next.portalUrl) setStatus(next);
        } catch {
          /* fall through to launch-mode default */
        }
      }
      if (!portal) portal = resolveDefaultSkillsPortalUrl();
      const url =
        created.shareUrl?.trim() ||
        shareLandingUrl(created.shareId, portal, created.shareUrl);
      setLastShareUrl(url);
      // Always surface the just-created row even if list identity mismatches briefly.
      setShareList((prev) => {
        const next = [created, ...prev.filter((s) => s.shareId !== created.shareId)];
        return next;
      });
      try {
        const items = await desktopApi.listSkillsSquareShares({
          slug: shareSlug,
          userId: shareUser,
          userEmail: operatorEmail,
        });
        if (items?.length) {
          const byId = new Map<string, DesktopSquareShareInfo>();
          for (const item of [created, ...items]) {
            if (item.shareId) byId.set(item.shareId, item);
          }
          setShareList([...byId.values()]);
        }
      } catch {
        /* keep optimistic created row */
      }
      showToast("success", zh ? "分享链接已创建" : "Share link created");
    } catch (e) {
      showToast("error", `${zh ? "创建失败" : "Create failed"}: ${errMsg(e)}`);
    } finally {
      setShareCreating(false);
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    if (!shareSlug) return;
    const shareUser = resolveShareUserId();
    if (!shareUser) return;
    const approved = await requestAppDecision({
      id: `ssq-revoke-share-${shareId}`,
      tone: "danger",
      title: zh ? "撤销分享？" : "Revoke share?",
      description: zh ? "访问链接将立即失效。" : "The share link will stop working immediately.",
      confirmLabel: zh ? "撤销" : "Revoke",
    });
    if (!approved) return;
    try {
      await desktopApi.revokeSkillsSquareShare({
        slug: shareSlug,
        shareId,
        userId: shareUser,
        userEmail: operatorEmail,
      });
      setShareList((prev) => prev.filter((s) => s.shareId !== shareId));
      showToast("success", zh ? "已撤销" : "Revoked");
    } catch (e) {
      showToast("error", errMsg(e));
    }
  };

  const copyText = async (text: string) => {
    if (await copyTextSafely(text)) {
      showToast("success", zh ? "已复制" : "Copied");
      return;
    }
    showToast("error", zh ? "复制失败" : "Copy failed");
  };

  const showListChrome = mode !== "publish" && !detailSlug;
  const statusNotReady = status && status.state !== "ready" && status.state !== "requires_login";

  const squareTabs: { id: SquareMode; label: string }[] = [
    { id: "public", label: zh ? "公开技能" : "Public" },
    { id: "created", label: zh ? "我的创建" : "My creations" },
    { id: "collected", label: zh ? "我的收藏" : "Collections" },
    { id: "publish", label: zh ? "发布" : "Publish" },
  ];

  return (
    <div
      className={`skills-online${mode === "publish" && !detailSlug ? " is-publish" : ""}`}
      ref={scrollRef}
    >
      {/* Page chrome orbs live on SkillsManager (skills-manager-page) for both tabs. */}
      <div className="skills-online-content">
        {!detailSlug ? (
          <div className="skills-online-subtabs" role="tablist" aria-label={zh ? "在线技能分区" : "Online skills sections"}>
            {squareTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={mode === tab.id}
                className={`skills-online-subtab${mode === tab.id ? " active" : ""}`}
                onClick={() => {
                  setDetailSlug(null);
                  setDetail(null);
                  if (tab.id === "publish" && mode !== "publish") {
                    resetPublishForm();
                  }
                  // Immediate loading feedback so tab switches never look frozen
                  // while the previous list remains on screen.
                  if (tab.id !== mode && tab.id !== "publish") {
                    fetchGenRef.current += 1;
                    setLoading(true);
                    setLoadingMore(false);
                    loadingMoreRef.current = false;
                    setRows([]);
                    setHasNext(false);
                    hasNextRef.current = false;
                  }
                  setMode(tab.id);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}

        {statusNotReady ? (
          <div className={statusBannerClass(status.state)} role="status">
            <span>{statusBannerText(status, zh)}</span>
          </div>
        ) : null}

        {showListChrome && mode === "public" && stats ? (
          <div className="skills-online-stats" aria-label={zh ? "统计" : "Stats"}>
            {(
              [
                [zh ? "技能总数" : "Total skills", stats.totalSkills],
                [zh ? "总下载" : "Downloads", stats.totalDownloads],
                [zh ? "总收藏" : "Collects", stats.totalCollects],
              ] as const
            ).map(([title, value]) => (
              <div key={title} className="skills-online-stat-card">
                <div className="skills-online-stat-title">{title}</div>
                <div className="skills-online-stat-value">{value}</div>
              </div>
            ))}
          </div>
        ) : null}

        {showListChrome && mode === "public" ? (
          <div className="skills-online-filters">
            <div className="skills-online-filter-bar">
              <div className="skills-online-cat-tabs" role="group" aria-label={zh ? "标签" : "Tags"}>
                <button
                  type="button"
                  className={`skills-online-cat-tab${!activeTag ? " active" : ""}`}
                  onClick={() => setActiveTag("")}
                >
                  {zh ? "全部" : "All"}
                </button>
                {availableTagNames.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`skills-online-cat-tab${activeTag === tag ? " active" : ""}`}
                    onClick={() => setActiveTag((c) => (c === tag ? "" : tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>

              <div className="skills-online-filter-actions">
                {searchExpanded ? (
                  <div className="skills-online-search">
                    <Search size={14} className="skills-online-search-icon" aria-hidden />
                    <input
                      type="search"
                      className="skills-online-search-input"
                      autoFocus
                      value={search}
                      placeholder={zh ? "搜索技能…" : "Search skills…"}
                      onChange={(e) => setSearch(e.target.value)}
                      onBlur={() => {
                        if (!search.trim()) setSearchExpanded(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setSearch("");
                          setSearchExpanded(false);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="skills-online-icon-btn"
                    title={zh ? "搜索" : "Search"}
                    onClick={() => setSearchExpanded(true)}
                  >
                    <Search size={16} aria-hidden />
                  </button>
                )}

                <div className="skills-online-sort-menu" ref={sortRef}>
                  <button
                    type="button"
                    className="skills-online-icon-btn"
                    title={
                      sortBy === "time"
                        ? zh
                          ? "按时间排序"
                          : "Sort by time"
                        : sortBy === "name"
                          ? zh
                            ? "按名称排序"
                            : "Sort by name"
                          : zh
                            ? "按下载量排序"
                            : "Sort by downloads"
                    }
                    onClick={() => setSortOpen((v) => !v)}
                  >
                    <ArrowUpDown size={16} aria-hidden />
                  </button>
                  {sortOpen ? (
                    <div className="skills-online-sort-dropdown" role="listbox">
                      {(
                        [
                          ["time", Clock, zh ? "按时间" : "By time"],
                          ["name", ArrowDownAZ, zh ? "按名称" : "By name"],
                          ["downloads", Download, zh ? "按下载量" : "By downloads"],
                        ] as const
                      ).map(([id, Icon, label]) => (
                        <button
                          key={id}
                          type="button"
                          role="option"
                          aria-selected={sortBy === id}
                          className={`skills-online-sort-option${sortBy === id ? " active" : ""}`}
                          onClick={() => {
                            setSortBy(id);
                            setSortOpen(false);
                          }}
                        >
                          <Icon size={13} />
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="skills-online-icon-btn"
                  title={zh ? "刷新" : "Refresh"}
                  onClick={() => {
                    void loadPublicPage(1, false);
                  }}
                >
                  <RefreshCw size={16} aria-hidden />
                </button>

                {isAdmin ? (
                  <button
                    type="button"
                    className="skills-btn"
                    title={zh ? "管理标签" : "Manage tags"}
                    onClick={() => {
                      setTagEditId(null);
                      setTagEditName("");
                      setTagEditOrder(0);
                      setTagModalOpen(true);
                    }}
                  >
                    <Tag size={14} aria-hidden />
                    {zh ? "管理标签" : "Manage tags"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="skills-online-body">
          {mode === "publish" ? (
            <PublishForm
              zh={zh}
              editingSlug={editingSlug}
              zipFileName={zipFileName}
              zipFileSize={zipFileSize}
              displayName={publishDisplayName}
              slug={publishSlug}
              version={publishVersion}
              changelog={publishChangelog}
              description={publishDescription}
              tags={publishTags}
              visibility={publishVisibility}
              icon={publishIcon}
              profilePreviewUrl={profilePreviewUrl}
              packPreview={packPreview}
              packingFolder={packingFolder}
              availableTags={availableTagNames}
              publishing={publishing}
              zipInputRef={zipInputRef}
              folderInputRef={folderInputRef}
              profileInputRef={profileInputRef}
              onZipChange={handleZipInputChange}
              onFolderChange={(e) => void handleFolderInputChange(e)}
              onPickZipClick={() => zipInputRef.current?.click()}
              onPickFolderClick={() => folderInputRef.current?.click()}
              onZipDrop={(file) => void handleZipPicked(file)}
              onDisplayNameChange={setPublishDisplayName}
              onSlugChange={setPublishSlug}
              onVersionChange={setPublishVersion}
              onChangelogChange={setPublishChangelog}
              onDescriptionChange={setPublishDescription}
              onTagsChange={setPublishTags}
              onVisibilityChange={setPublishVisibility}
              onIconChange={setPublishIcon}
              onProfileChange={(e) => void handleProfileChange(e)}
              onClearProfile={clearProfilePreview}
              onSubmit={() => void handleSubmitPublish()}
              onCancel={() => {
                const wasEditing = Boolean(editingSlug);
                resetPublishForm();
                setMode(wasEditing ? "created" : "public");
              }}
            />
          ) : detailSlug ? (
            <DetailView
              zh={zh}
              loading={detailLoading}
              detail={detail}
              detailTab={detailTab}
              busy={busySlug === detailSlug}
              mode={mode}
              operatorEmail={operatorEmail}
              operatorSubject={operatorSubject}
              onTabChange={setDetailTab}
              onClose={closeDetail}
              onInstall={() => detail && void handleInstallLocal(detail)}
              onCollect={() => detail && void handleCollect(detail)}
              onUncollect={() =>
                detail && void handleDeleteOrUncollect(detail.slug, detail.name, "uncollect")
              }
              onDelete={() =>
                detail && void handleDeleteOrUncollect(detail.slug, detail.name, "delete")
              }
              onToggleVisibility={(visibility) =>
                detail && void handleToggleVisibility(detail.slug, visibility)
              }
              onEdit={() => detail && openEditFromDetail(detail)}
              onShare={() =>
                detail &&
                void openShare(
                  detail.slug,
                  detail.name,
                  detail.ownerId ||
                    (detail.owner?.includes("@") ? detail.owner : null),
                )
              }
            />
          ) : (
            <SkillGrid
              zh={zh}
              loading={loading}
              loadingMore={loadingMore}
              rows={mode === "public" ? rows : filteredRows}
              busySlug={busySlug}
              mode={mode}
              sentinelRef={mode === "public" ? sentinelRef : undefined}
              onOpen={openDetail}
            />
          )}
        </div>
      </div>

      {shareSlug ? (
        <ShareDialog
          zh={zh}
          skillName={shareName}
          password={sharePassword}
          expiryHours={shareExpiryHours}
          shares={shareList}
          loading={shareLoading}
          creating={shareCreating}
          lastUrl={lastShareUrl}
          portalUrl={status?.portalUrl || resolveDefaultSkillsPortalUrl()}
          onPasswordChange={setSharePassword}
          onExpiryChange={setShareExpiryHours}
          onCreate={() => void handleCreateShare()}
          onRevoke={(id) => void handleRevokeShare(id)}
          onCopy={(url) => void copyText(url)}
          onClose={() => {
            setShareSlug(null);
            setShareOwnerId(null);
          }}
        />
      ) : null}

      {tagModalOpen ? (
        <TagAdminModal
          zh={zh}
          tags={tags}
          busy={tagBusy}
          editId={tagEditId}
          editName={tagEditName}
          editOrder={tagEditOrder}
          onEditNameChange={setTagEditName}
          onEditOrderChange={setTagEditOrder}
          onStartEdit={(tag) => {
            if (!tag) {
              setTagEditId(null);
              setTagEditName("");
              setTagEditOrder(0);
              return;
            }
            setTagEditId(tag.id);
            setTagEditName(tag.name);
            setTagEditOrder(tag.sortOrder ?? 0);
          }}
          onSave={() => void handleSaveTag()}
          onDelete={(tag) => void handleDeleteTag(tag)}
          onClose={() => setTagModalOpen(false)}
        />
      ) : null}

      {toast ? (
        <div
          className={`skills-action-toast skills-action-toast-${toast.type}`}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

// ── Sub-views ──────────────────────────────────────────────────────────────────

function SkillGrid(props: {
  zh: boolean;
  loading: boolean;
  loadingMore: boolean;
  rows: DesktopSquareSkill[];
  busySlug: string | null;
  mode: SquareMode;
  sentinelRef?: RefObject<HTMLDivElement | null>;
  onOpen: (slug: string) => void;
}): JSX.Element {
  const { zh, loading, loadingMore, rows, busySlug, mode, sentinelRef, onOpen } = props;

  if (loading && rows.length === 0) {
    return (
      <div className="skills-online-list-loading" role="status" aria-live="polite">
        <Loader2 size={22} className="spin" aria-hidden />
        <span>{zh ? "加载中…" : "Loading…"}</span>
      </div>
    );
  }

  if (rows.length === 0) {
    const emptyTitle =
      mode === "collected"
        ? zh
          ? "还没有收藏"
          : "No collections yet"
        : mode === "created"
          ? zh
            ? "还没有创建技能"
            : "No creations yet"
          : zh
            ? "暂无匹配的公共技能"
            : "No public skills found";
    const emptyDesc =
      mode === "collected"
        ? zh
          ? "在公开技能中收藏喜欢的技能后会出现在这里。收藏不会自动用于对话。"
          : "Collect public skills to see them here. Collecting does not enable them for chat."
        : mode === "created"
          ? zh
            ? "发布第一个技能，开始构建你的技能库。"
            : "Publish your first skill to get started."
          : zh
            ? "试试调整搜索或标签筛选。"
            : "Try adjusting search or tag filters.";
    return (
      <div className="skills-online-empty">
        <div className="skills-online-empty-icon">
          <Package size={32} strokeWidth={1.75} />
        </div>
        <p className="skills-online-empty-title">{emptyTitle}</p>
        <p className="skills-online-empty-desc">{emptyDesc}</p>
      </div>
    );
  }

  return (
    <>
      <div className="skills-online-grid">
        {rows.map((skill) => {
          const versionLabel = formatVersionPill(skill.version);
          const ownerChar = ownerInitial(skill.owner);
          const firstTag = (skill.tags ?? []).find((t) => t.trim()) || "";
          return (
            <article
              key={`${skill.slug}-${skill.uskillsType ?? "public"}`}
              className={`skills-online-card is-clickable${busySlug === skill.slug ? " is-installing" : ""}`}
              onClick={() => onOpen(skill.slug)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(skill.slug);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="skills-online-card-head">
                {skill.profile?.trim() ? (
                  <img src={skill.profile} alt="" className="skills-online-card-avatar-img" />
                ) : isEmojiIcon(skill.icon) ? (
                  <div className="skills-online-card-icon" aria-hidden>
                    {skill.icon}
                  </div>
                ) : (
                  <div className="skills-online-card-avatar" aria-hidden>
                    {skillAvatarLabel(skill.name, skill.slug)}
                  </div>
                )}
                <div className="skills-online-card-title-wrap">
                  <h3 className="skills-online-card-title" title={skill.name}>
                    {skill.name || skill.slug}
                  </h3>
                  <div className="skills-online-card-badges">
                    {versionLabel ? (
                      <span className="skills-online-version-pill">
                        <GitBranch size={10} />
                        {versionLabel}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="skills-online-card-desc">
                {skill.description?.trim()
                  ? skill.description
                  : zh
                    ? "暂无描述"
                    : "No description"}
              </p>
              <div className="skills-online-card-foot">
                <div className="skills-online-card-foot-left">
                  {ownerChar ? (
                    <span className="skills-online-owner-avatar" title={skill.owner}>
                      {ownerChar}
                    </span>
                  ) : null}
                  {firstTag ? <span className="skills-online-tag-pill">{firstTag}</span> : null}
                </div>
                <div className="skills-online-card-foot-right">
                  <span className="skills-online-downloads">
                    <Download size={10} />
                    {skill.downloads ?? 0}
                  </span>
                  {(mode === "public" || mode === "collected" || mode === "created") && skill.installed ? (
                    <span className="skills-online-card-installed" title={zh ? "已在本地技能中" : "Present in local skills"}>
                      <Check size={12} />
                      {zh ? "本地已有" : "Local"}
                    </span>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {sentinelRef ? <div ref={sentinelRef} style={{ height: 1 }} aria-hidden /> : null}
      {loadingMore ? (
        <p className="skills-loading" style={{ justifyContent: "center", display: "flex", gap: 6 }}>
          <Loader2 size={14} className="spin" /> {zh ? "加载更多…" : "Loading more…"}
        </p>
      ) : null}
    </>
  );
}

function DetailView(props: {
  zh: boolean;
  loading: boolean;
  detail: DesktopSquareSkillDetail | null;
  detailTab: DetailTab;
  busy: boolean;
  mode: SquareMode;
  operatorEmail?: string;
  operatorSubject?: string;
  onTabChange: (tab: DetailTab) => void;
  onClose: () => void;
  onInstall: () => void;
  onCollect: () => void;
  onUncollect: () => void;
  onDelete: () => void;
  onToggleVisibility: (visibility: PublishVisibility) => void;
  onEdit: () => void;
  onShare: () => void;
}): JSX.Element {
  const {
    zh, loading, detail, detailTab, busy, mode, operatorEmail, operatorSubject,
    onTabChange, onClose, onInstall, onCollect, onUncollect, onDelete,
    onToggleVisibility, onEdit, onShare,
  } = props;

  const bodyRef = useRef<HTMLDivElement>(null);
  const tocItems = useMemo(
    () => (detail?.body ? extractMarkdownToc(detail.body) : []),
    [detail?.body],
  );

  useEffect(() => {
    if (!bodyRef.current || detailTab !== "content" || !detail?.body) return;
    const headings = bodyRef.current.querySelectorAll("h1, h2, h3");
    headings.forEach((el) => {
      const text = (el.textContent || "").trim();
      const id = `md-h-${text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")}`;
      if (id) el.id = id;
    });
  }, [detail?.body, detailTab]);

  if (loading) {
    return (
      <p className="skills-online-detail-loading">
        <Loader2 size={14} className="spin" /> {zh ? "加载详情…" : "Loading detail…"}
      </p>
    );
  }
  if (!detail) {
    return (
      <div className="skills-online-empty">
        <div className="skills-online-empty-icon">
          <Package size={32} strokeWidth={1.75} />
        </div>
        <p className="skills-online-empty-title">{zh ? "未找到技能" : "Skill not found"}</p>
        <button type="button" className="skills-btn" onClick={onClose}>
          <ArrowLeft size={14} />
          {zh ? "返回" : "Back"}
        </button>
      </div>
    );
  }

  const displayName = detail.name || detail.slug;
  const restricted = detail.restricted === true;
  const isPublic = detail.visibility === "public";
  const isCreatedMode = mode === "created";
  const isCollectedMode = mode === "collected";
  const ownerChar = ownerInitial(detail.owner);
  const versionLabel = formatVersionPill(detail.version);
  const sourceClass =
    detail.uskillsType === "imported" || (detail.isCollected && !isSkillOwner(detail, operatorEmail, operatorSubject))
      ? " is-collected"
      : isPublic
        ? " is-public"
        : "";
  const sourceText =
    detail.uskillsType === "imported" || (isCollectedMode && detail.isCollected)
      ? zh
        ? "收藏"
        : "Collected"
      : isPublic
        ? zh
          ? "公开"
          : "Public"
        : detail.visibility === "team"
          ? zh
            ? "团队"
            : "Team"
          : zh
            ? "我的创建"
            : "My creation";

  const secondaryActions: JSX.Element[] = [];
  // WebUI: public-tab collect only for non-owners (onImport: isPublicTab && !isOwner).
  const showPublicCollect = mode === "public" && !isSkillOwner(detail, operatorEmail, operatorSubject);
  if (showPublicCollect) {
    secondaryActions.push(
      detail.isCollected ? (
        <button
          key="collect"
          type="button"
          className="skills-online-detail-action-btn is-done"
          disabled={busy}
          onClick={onUncollect}
          title={zh ? "取消收藏" : "Uncollect"}
        >
          <Check size={14} />
          {zh ? "已收藏" : "Collected"}
        </button>
      ) : (
        <button
          key="collect"
          type="button"
          className="skills-online-detail-action-btn"
          disabled={busy}
          onClick={onCollect}
          title={zh ? "加入收藏（书签，不会自动用于对话）" : "Add to collections (bookmark only — not used in chat)"}
        >
          <Star size={14} />
          {zh ? "收藏" : "Collect"}
        </button>
      ),
    );
  }
  if (isCreatedMode) {
    secondaryActions.push(
      <button key="edit" type="button" className="skills-online-detail-action-btn" onClick={onEdit}>
        <Pencil size={14} />
        {zh ? "编辑" : "Edit"}
      </button>,
      <button key="share" type="button" className="skills-online-detail-action-btn" onClick={onShare}>
        <Share2 size={14} />
        {zh ? "分享" : "Share"}
      </button>,
      // WebUI parity: created skills toggle public ↔ unlisted (下架 / 公开).
      isPublic ? (
        <button
          key="unlist"
          type="button"
          className="skills-online-detail-action-btn danger"
          disabled={busy}
          onClick={() => onToggleVisibility("private")}
          title={zh ? "从公开市场下架" : "Unlist from public market"}
        >
          <EyeOff size={14} />
          {zh ? "下架" : "Unlist"}
        </button>
      ) : (
        <button
          key="list"
          type="button"
          className="skills-online-detail-action-btn"
          disabled={busy}
          onClick={() => onToggleVisibility("public")}
          title={zh ? "发布到公开市场" : "List on public market"}
        >
          <Eye size={14} />
          {zh ? "公开" : "List"}
        </button>
      ),
      <button
        key="del"
        type="button"
        className="skills-online-detail-action-btn danger"
        disabled={busy}
        onClick={onDelete}
      >
        <Trash2 size={14} />
        {zh ? "删除" : "Delete"}
      </button>,
    );
  }
  if (isCollectedMode) {
    secondaryActions.push(
      <button
        key="uncollect"
        type="button"
        className="skills-online-detail-action-btn"
        disabled={busy}
        onClick={onUncollect}
      >
        <Star size={14} />
        {zh ? "取消收藏" : "Uncollect"}
      </button>,
    );
  }

  return (
    <div className={`skills-online-detail${busy ? " is-installing" : ""}`}>
      <button type="button" className="skills-btn skills-online-detail-back" onClick={onClose}>
        <ArrowLeft size={14} />
        {zh ? "返回列表" : "Back"}
      </button>

      <div className="skills-online-detail-hero">
        <div className="skills-online-detail-hero-row">
          <div className="skills-online-detail-title-wrap">
            {detail.profile?.trim() ? (
              <img
                src={detail.profile}
                alt=""
                className="skills-online-detail-avatar skills-skill-avatar-img"
              />
            ) : isEmojiIcon(detail.icon) ? (
              <div className="skills-online-card-icon skills-online-detail-avatar" aria-hidden>
                {detail.icon}
              </div>
            ) : (
              <div className="skills-online-card-avatar skills-online-detail-avatar" aria-hidden>
                {skillAvatarLabel(displayName, detail.slug)}
              </div>
            )}
            <div className="skills-online-detail-title-meta">
              <div className="skills-online-detail-title-row">
                <h3 className="skills-online-detail-title">{displayName}</h3>
                <span className={`skills-online-detail-source${sourceClass}`}>
                  <Globe size={12} />
                  {sourceText}
                </span>
              </div>
              <div className="skills-online-detail-submeta">
                {versionLabel ? (
                  <span>
                    <GitBranch size={12} /> {versionLabel}
                  </span>
                ) : null}
                <span>
                  <Download size={12} /> {detail.downloads ?? 0}
                </span>
                {detail.owner ? (
                  <span title={detail.owner}>
                    {ownerChar ? <span className="skills-online-owner-avatar">{ownerChar}</span> : null}
                    {detail.owner}
                  </span>
                ) : null}
                {detail.createdAt || detail.updatedAt ? (
                  <span title={detail.createdAt || detail.updatedAt}>
                    <Calendar size={12} />
                    {formatRelativeTime(detail.createdAt || detail.updatedAt, zh)}
                  </span>
                ) : null}
              </div>
              {(detail.tags ?? []).length > 0 ? (
                <div className="skills-online-detail-tags">
                  {(detail.tags ?? []).map((tag) => (
                    <span key={tag} className="skills-online-tag-pill">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="skills-online-detail-actions">
            {detail.installed ? (
              <span className="skills-online-detail-cta is-done" title={zh ? "已在本地 skills 目录" : "Present in local skills directory"}>
                <Check size={14} />
                {zh ? "本地已有" : "Local"}
              </span>
            ) : (
              <button
                type="button"
                className="skills-online-detail-cta"
                disabled={busy || restricted}
                onClick={onInstall}
                title={zh ? "安装到本地 skills 扫描目录" : "Install into local skills scan directory"}
              >
                <Package size={14} />
                {zh ? "安装到本地" : "Install local"}
              </button>
            )}
            {secondaryActions.length > 0 ? (
              <div className="skills-online-detail-secondary">{secondaryActions}</div>
            ) : null}
          </div>
        </div>

        {restricted ? (
          <div className="skills-online-restricted" role="status">
            <Lock size={14} />
            <div>
              <p className="skills-online-restricted-title">
                {zh ? "该技能仅限学术组内使用" : "This skill is limited to academic group members"}
              </p>
              <p className="skills-online-restricted-desc">
                {zh
                  ? "你可以查看简介与版本信息；加入对应学术组后才能安装或查看完整内容。"
                  : "You can view the overview and version info. Join the academic group to install or view full content."}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="skills-online-detail-panel">
        <div className="skills-online-detail-tabs" role="tablist">
          {(
            [
              ["info", Info, zh ? "信息" : "Info"],
              ["description", AlignLeft, zh ? "描述" : "Description"],
              ["content", FileText, zh ? "内容" : "Content"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={detailTab === id}
              className={`skills-online-detail-tab${detailTab === id ? " active" : ""}`}
              onClick={() => onTabChange(id)}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <div className="skills-online-detail-body">
          {detailTab === "info" ? (
            <div className="skills-online-detail-info-grid">
              <div className="skills-online-detail-info-card">
                <p className="skills-online-detail-info-label">{zh ? "标识符" : "Slug"}</p>
                <p className="skills-online-detail-slug">{detail.slug}</p>
              </div>
              {detail.createdAt ? (
                <div className="skills-online-detail-info-card">
                  <p className="skills-online-detail-info-label">{zh ? "创建时间" : "Created"}</p>
                  <p title={detail.createdAt}>{formatRelativeTime(detail.createdAt, zh)}</p>
                </div>
              ) : null}
              <div className="skills-online-detail-info-card">
                <p className="skills-online-detail-info-label">{zh ? "更新时间" : "Updated"}</p>
                <p title={detail.updatedAt || detail.createdAt}>
                  {formatRelativeTime(detail.updatedAt || detail.createdAt, zh)}
                </p>
              </div>
              {sanitizeChangelog(detail.changelog) ? (
                <div className="skills-online-detail-info-card skills-online-detail-changelog">
                  <p className="skills-online-detail-info-label">{zh ? "更新说明" : "Changelog"}</p>
                  <p>{sanitizeChangelog(detail.changelog)}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {detailTab === "description" ? (
            <p className={`skills-online-detail-desc${!detail.description ? " skills-online-detail-desc-muted" : ""}`}>
              {detail.description || (zh ? "暂无描述" : "No description")}
            </p>
          ) : null}

          {detailTab === "content" ? (
            restricted ? (
              <div className="skills-online-empty" style={{ padding: "32px 16px" }}>
                <Lock size={28} strokeWidth={1.5} />
                <p className="skills-online-empty-title">
                  {zh ? "内容受限" : "Content restricted"}
                </p>
                <p className="skills-online-empty-desc">
                  {zh ? "该技能仅限学术组内使用" : "This skill is limited to academic group members"}
                </p>
              </div>
            ) : (
              <div className="skills-online-detail-content-layout">
                <div ref={bodyRef} className="skills-online-detail-markdown gfs-preview-markdown">
                  {detail.body?.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.body}</ReactMarkdown>
                  ) : (
                    <p className="skills-online-detail-desc-muted">
                      {zh ? "暂无技能内容" : "No skill content available"}
                    </p>
                  )}
                </div>
                {tocItems.length >= 2 ? (
                  <aside className="skills-online-detail-toc" aria-label={zh ? "目录" : "Table of contents"}>
                    <p className="skills-online-detail-toc-title">
                      <List size={12} />
                      {zh ? "目录" : "On this page"}
                    </p>
                    <ul className="skills-online-detail-toc-list">
                      {tocItems.map((item) => (
                        <li key={`${item.id}-${item.text}`} className={`skills-online-detail-toc-item level-${item.level}`}>
                          <a
                            href={`#${item.id}`}
                            onClick={(e) => {
                              e.preventDefault();
                              document.getElementById(item.id)?.scrollIntoView({
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
                  </aside>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PublishForm(props: {
  zh: boolean;
  editingSlug: string | null;
  zipFileName: string | null;
  zipFileSize: number | null;
  displayName: string;
  slug: string;
  version: string;
  changelog: string;
  description: string;
  tags: string;
  visibility: PublishVisibility;
  icon: string;
  profilePreviewUrl: string | null;
  packPreview: PackPreviewEntry[];
  packingFolder: boolean;
  availableTags: string[];
  publishing: boolean;
  zipInputRef: RefObject<HTMLInputElement | null>;
  folderInputRef: RefObject<HTMLInputElement | null>;
  profileInputRef: RefObject<HTMLInputElement | null>;
  onZipChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onFolderChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onPickZipClick: () => void;
  onPickFolderClick: () => void;
  onZipDrop: (file: File) => void;
  onDisplayNameChange: (v: string) => void;
  onSlugChange: (v: string) => void;
  onVersionChange: (v: string) => void;
  onChangelogChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onTagsChange: (v: string) => void;
  onVisibilityChange: (v: PublishVisibility) => void;
  onIconChange: (v: string) => void;
  onProfileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onClearProfile: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  const {
    zh, editingSlug, zipFileName, zipFileSize, displayName, version, changelog, tags,
    visibility, icon, profilePreviewUrl, packPreview, packingFolder, availableTags, publishing,
    zipInputRef, folderInputRef, profileInputRef, onZipChange, onFolderChange, onPickZipClick,
    onPickFolderClick, onZipDrop, onDisplayNameChange, onVersionChange,
    onChangelogChange, onTagsChange, onVisibilityChange, onIconChange,
    onProfileChange, onClearProfile, onSubmit, onCancel,
  } = props;

  const isEdit = Boolean(editingSlug);
  const [tagsOpen, setTagsOpen] = useState(false);
  const tagsDropdownRef = useRef<HTMLDivElement>(null);
  const isPublic = visibility === "public";

  const selectedTags = useMemo(
    () =>
      tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
    [tags],
  );
  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);

  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, [folderInputRef]);

  useEffect(() => {
    if (!tagsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (tagsDropdownRef.current && !tagsDropdownRef.current.contains(e.target as Node)) {
        setTagsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [tagsOpen]);

  const toggleTag = (tag: string) => {
    const next = selectedTagSet.has(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    onTagsChange(next.join(", "));
  };

  const removeTag = (tag: string) => {
    onTagsChange(selectedTags.filter((t) => t !== tag).join(", "));
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file) onZipDrop(file);
  };

  return (
    <div className="skills-online-publish">
      <div className="skills-online-publish-header">
        <span className="skills-online-publish-header-icon" aria-hidden>
          <Upload size={16} />
        </span>
        <div className="skills-online-publish-header-title">
          {isEdit ? (zh ? "编辑技能" : "Edit skill") : zh ? "发布技能" : "Publish skill"}
        </div>
      </div>

      <div className="skills-online-publish-body">
        <div className="skills-online-publish-layout">
          <div className="skills-online-publish-file-col">
            <label className="skills-label">
              {zh ? "技能文件" : "Skill file"}
              {!isEdit ? <span className="skills-online-required"> *</span> : null}
              {isEdit ? (
                <span className="skills-hint" style={{ marginLeft: 8, fontWeight: 400 }}>
                  {zh ? "（可选，不上传则保留原包）" : "(optional — keep existing package if empty)"}
                </span>
              ) : null}
            </label>
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip"
              hidden
              onChange={onZipChange}
            />
            <input
              ref={folderInputRef}
              type="file"
              hidden
              multiple
              onChange={onFolderChange}
            />
            <div
              className={`skills-online-dropzone skills-online-publish-dropzone${zipFileName ? " has-file" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onDrop={onDrop}
            >
              {packingFolder ? (
                <p className="skills-online-dropzone-hint" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Loader2 size={16} className="spin" />
                  {zh ? "正在打包文件夹…" : "Packing folder…"}
                </p>
              ) : zipFileName ? (
                <div className="skills-online-publish-file-selected">
                  <Package size={28} strokeWidth={1.75} className="skills-online-publish-file-selected-icon" />
                  <div className="skills-online-publish-file-selected-meta">
                    <p className="skills-online-publish-file-selected-name" title={zipFileName}>
                      {zipFileName}
                    </p>
                    {zipFileSize != null ? (
                      <p className="skills-online-publish-file-selected-size">{formatBytes(zipFileSize)}</p>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="skills-online-publish-dropzone-hero">
                  <Package size={36} strokeWidth={1.5} className="skills-online-publish-dropzone-deco" aria-hidden />
                  <p className="skills-online-publish-dropzone-title">
                    {zh ? "赋予 AI 新能力" : "Give AI new powers"}
                  </p>
                </div>
              )}

              {packPreview.length > 0 ? (
                <div className="skills-online-pack-preview" aria-label={zh ? "包内容预览" : "Package preview"}>
                  <p className="skills-online-pack-preview-title">
                    {zh ? `包含 ${packPreview.length} 个文件` : `${packPreview.length} files`}
                  </p>
                  <ul className="skills-online-pack-preview-list">
                    {packPreview.slice(0, 80).map((entry) => {
                      const isSkillMd = /(^|\/)SKILL\.MD$/i.test(entry.path);
                      return (
                        <li
                          key={entry.path}
                          className={`skills-online-pack-preview-item${isSkillMd ? " is-skill-md" : ""}`}
                        >
                          <span className="skills-online-pack-preview-path" title={entry.path}>
                            {entry.path}
                          </span>
                          <span className="skills-online-pack-preview-size">{formatBytes(entry.size)}</span>
                        </li>
                      );
                    })}
                    {packPreview.length > 80 ? (
                      <li className="skills-online-pack-preview-item">
                        <span className="skills-online-pack-preview-path">
                          {zh
                            ? `…还有 ${packPreview.length - 80} 个文件`
                            : `…and ${packPreview.length - 80} more`}
                        </span>
                      </li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              <div className="skills-online-dropzone-actions">
                <button
                  type="button"
                  className="skills-btn skills-online-publish-outline-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickFolderClick();
                  }}
                  disabled={publishing || packingFolder}
                >
                  <FolderOpen size={14} />
                  {zh ? "选择文件夹" : "Select folder"}
                </button>
                <button
                  type="button"
                  className="skills-btn skills-online-publish-outline-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPickZipClick();
                  }}
                  disabled={publishing || packingFolder}
                >
                  <Package size={14} />
                  {zh ? "选择 zip 文件" : "Select zip file"}
                </button>
              </div>

              {!zipFileName && !packingFolder ? (
                <p className="skills-online-publish-dropzone-hint">
                  {zh
                    ? "请确保包含 SKILL.md；文件夹请点「选择文件夹」（将打包为 zip）；最多 200 个文件，总大小不超过 10 MB"
                    : "Include SKILL.md; use Select folder to pack as zip; max 200 files, under 10 MB"}
                </p>
              ) : null}
            </div>
          </div>

          <div className="skills-online-publish-meta-col">
            <div className="skills-online-publish-field">
              <label className="skills-label skills-online-publish-field-label">
                <User size={14} aria-hidden />
                <span>
                  {zh ? "技能显示名称" : "Skill display name"}{" "}
                  <span className="skills-online-required">*</span>
                </span>
              </label>
              <input
                className="skills-input"
                value={displayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                placeholder={zh ? "技能显示名称" : "Skill display name"}
              />
            </div>

            <div className="skills-online-publish-field">
              <label className="skills-label skills-online-publish-field-label">
                <Rocket size={14} aria-hidden />
                <span>
                  {zh ? "版本号" : "Version"} <span className="skills-online-required">*</span>
                </span>
              </label>
              <input
                className="skills-input"
                value={version}
                onChange={(e) => onVersionChange(e.target.value)}
                placeholder="1.0.0"
              />
            </div>

            <div className="skills-online-publish-field">
              <label className="skills-label skills-online-publish-field-label">
                <Eye size={14} aria-hidden />
                <span>{zh ? "可见性" : "Visibility"}</span>
              </label>
              <div className="skills-online-publish-visibility">
                <span className="skills-online-publish-visibility-label">
                  {zh ? "公开" : "Public"}
                </span>
                <button
                  type="button"
                  className={`skills-online-publish-switch${isPublic ? " is-on" : ""}`}
                  role="switch"
                  aria-checked={isPublic}
                  disabled={publishing}
                  onClick={() => onVisibilityChange(isPublic ? "private" : "public")}
                >
                  <span className="skills-online-publish-switch-thumb" />
                </button>
              </div>
            </div>

            <div className="skills-online-publish-field">
              <label className="skills-label skills-online-publish-field-label">
                <Star size={14} aria-hidden />
                <span>{zh ? "图标" : "Icon"}</span>
              </label>
              <div className="skills-online-publish-icon-grid" role="listbox" aria-label={zh ? "图标" : "Icon"}>
                {PUBLISH_ICON_OPTIONS.map(({ id, Icon }) => {
                  const selected = icon === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`skills-online-publish-icon-btn${selected ? " is-selected" : ""}`}
                      disabled={publishing}
                      onClick={() => onIconChange(selected ? "" : id)}
                      title={id}
                    >
                      <Icon size={18} strokeWidth={1.75} />
                    </button>
                  );
                })}
                <button
                  type="button"
                  role="option"
                  aria-selected={icon === "__profile__"}
                  className={`skills-online-publish-icon-btn skills-online-publish-icon-btn-cover${
                    icon === "__profile__" ? " is-selected" : ""
                  }`}
                  disabled={publishing}
                  onClick={() => onIconChange(icon === "__profile__" ? "" : "__profile__")}
                  title={zh ? "自定义封面" : "Custom cover"}
                >
                  <ImageIcon size={18} strokeWidth={1.75} />
                </button>
              </div>

              {icon === "__profile__" ? (
                <div className="skills-online-publish-cover">
                  <input
                    ref={profileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={onProfileChange}
                  />
                  <button
                    type="button"
                    className={`skills-online-publish-cover-square${
                      profilePreviewUrl ? " has-preview" : ""
                    }`}
                    disabled={publishing}
                    onClick={() => profileInputRef.current?.click()}
                  >
                    {profilePreviewUrl ? (
                      <img src={profilePreviewUrl} alt="" />
                    ) : (
                      <>
                        <ImageIcon size={22} strokeWidth={1.5} />
                        <span>{zh ? "上传封面" : "Upload cover"}</span>
                      </>
                    )}
                  </button>
                  {profilePreviewUrl ? (
                    <button
                      type="button"
                      className="skills-online-publish-cover-clear"
                      onClick={onClearProfile}
                      disabled={publishing}
                    >
                      {zh ? "清除封面" : "Clear cover"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="skills-online-publish-field">
              <label className="skills-label skills-online-publish-field-label">
                <Tag size={14} aria-hidden />
                <span>{zh ? "标签" : "Tags"}</span>
              </label>
              <div className="skills-online-publish-tags" ref={tagsDropdownRef}>
                <button
                  type="button"
                  className="skills-online-publish-tags-trigger"
                  disabled={publishing}
                  aria-expanded={tagsOpen}
                  onClick={() => setTagsOpen((v) => !v)}
                >
                  <span className="skills-online-publish-tags-chips">
                    {selectedTags.length > 0 ? (
                      selectedTags.map((tag) => (
                        <span key={tag} className="skills-online-publish-tag-chip">
                          {tag}
                          <span
                            role="button"
                            tabIndex={0}
                            className="skills-online-publish-tag-chip-x"
                            aria-label={zh ? `移除 ${tag}` : `Remove ${tag}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              removeTag(tag);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                removeTag(tag);
                              }
                            }}
                          >
                            <X size={10} />
                          </span>
                        </span>
                      ))
                    ) : (
                      <span className="skills-online-publish-tags-placeholder">
                        {zh ? "选择标签" : "Select tags"}
                      </span>
                    )}
                  </span>
                  <ChevronDown size={14} className="skills-online-publish-tags-chevron" />
                </button>
                {tagsOpen ? (
                  <div className="skills-online-publish-tags-menu" role="listbox">
                    {availableTags.length === 0 ? (
                      <p className="skills-hint" style={{ margin: 0, padding: "8px 10px" }}>
                        {zh ? "暂无可用标签" : "No tags available"}
                      </p>
                    ) : (
                      availableTags.map((tag) => {
                        const checked = selectedTagSet.has(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            role="option"
                            aria-selected={checked}
                            className={`skills-online-publish-tags-option${checked ? " is-checked" : ""}`}
                            onClick={() => toggleTag(tag)}
                          >
                            <span className="skills-online-publish-tags-check" aria-hidden>
                              {checked ? <Check size={12} /> : null}
                            </span>
                            {tag}
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="skills-online-publish-field">
              <label className="skills-label skills-online-publish-field-label">
                <FileText size={14} aria-hidden />
                <span>{zh ? "变更说明" : "Changelog"}</span>
              </label>
              <textarea
                className="skills-textarea skills-online-publish-changelog"
                rows={4}
                value={changelog}
                onChange={(e) => onChangelogChange(e.target.value)}
                placeholder={
                  zh ? "描述本次版本的主要变更内容" : "Describe the main changes in this version"
                }
              />
            </div>
          </div>
        </div>

        <div className="skills-online-publish-footer">
          <button
            type="button"
            className="skills-btn primary skills-online-publish-submit"
            onClick={onSubmit}
            disabled={publishing || packingFolder}
          >
            {publishing ? (
              <Loader2 size={14} className="spin" />
            ) : isEdit ? (
              <Pencil size={14} />
            ) : (
              <Check size={14} />
            )}
            {publishing
              ? zh
                ? "提交中…"
                : "Submitting…"
              : isEdit
                ? zh
                  ? "保存更改"
                  : "Save changes"
                : zh
                  ? "发布技能"
                  : "Publish Skill"}
          </button>
          <button
            type="button"
            className="skills-btn"
            onClick={onCancel}
            disabled={publishing || packingFolder}
          >
            <ArrowLeft size={14} />
            {zh ? "返回" : "Back"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TagAdminModal(props: {
  zh: boolean;
  tags: DesktopSquareSkillTag[];
  busy: boolean;
  editId: number | null;
  editName: string;
  editOrder: number;
  onEditNameChange: (v: string) => void;
  onEditOrderChange: (v: number) => void;
  onStartEdit: (tag: DesktopSquareSkillTag | null) => void;
  onSave: () => void;
  onDelete: (tag: DesktopSquareSkillTag) => void;
  onClose: () => void;
}): JSX.Element {
  const {
    zh, tags, busy, editId, editName, editOrder,
    onEditNameChange, onEditOrderChange, onStartEdit, onSave, onDelete, onClose,
  } = props;
  const sorted = [...tags].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <div className="skills-online-tag-modal" role="presentation" onClick={onClose}>
      <div
        className="skills-online-tag-modal-dialog"
        role="dialog"
        aria-modal
        aria-label={zh ? "管理标签" : "Manage tags"}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="skills-online-detail-header">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <Tag size={16} />
            <span>{zh ? "管理标签" : "Manage tags"}</span>
          </div>
          <button type="button" className="skills-icon-btn" onClick={onClose} aria-label={zh ? "关闭" : "Close"}>
            <X size={16} />
          </button>
        </div>

        <div className="skills-online-tag-modal-form">
          <input
            className="skills-input"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            placeholder={zh ? "标签名称" : "Tag name"}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSave();
              }
            }}
          />
          <input
            className="skills-input skills-online-tag-order-input"
            type="number"
            value={editOrder}
            onChange={(e) => onEditOrderChange(Number(e.target.value) || 0)}
            placeholder={zh ? "排序" : "Order"}
          />
          <button type="button" className="skills-btn primary" disabled={busy} onClick={onSave}>
            {busy ? <Loader2 size={14} className="spin" /> : editId != null ? <Pencil size={14} /> : <Plus size={14} />}
            {editId != null ? (zh ? "更新" : "Update") : zh ? "添加" : "Add"}
          </button>
          {editId != null ? (
            <button type="button" className="skills-btn" disabled={busy} onClick={() => onStartEdit(null)}>
              {zh ? "取消" : "Cancel"}
            </button>
          ) : null}
        </div>

        <div className="skills-online-tag-modal-list">
          {busy && sorted.length === 0 ? (
            <p className="skills-loading">
              <Loader2 size={14} className="spin" />
            </p>
          ) : sorted.length === 0 ? (
            <p className="skills-hint">{zh ? "暂无标签，请添加" : "No tags yet — add one above"}</p>
          ) : (
            sorted.map((tag) => (
              <div key={tag.id} className="skills-online-tag-modal-row">
                <div className="skills-online-tag-modal-row-main">
                  <Tag size={13} />
                  <span className="skills-online-tag-modal-name">{tag.name}</span>
                  <span className="skills-meta-text">
                    {zh ? "排序" : "order"}: {tag.sortOrder ?? 0}
                  </span>
                </div>
                <div className="skills-row-actions">
                  <button
                    type="button"
                    className="skills-btn"
                    disabled={busy}
                    onClick={() => onStartEdit(tag)}
                    title={zh ? "编辑" : "Edit"}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="skills-btn danger"
                    disabled={busy}
                    onClick={() => onDelete(tag)}
                    title={zh ? "删除" : "Delete"}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ShareDialog(props: {
  zh: boolean;
  skillName: string;
  password: string;
  expiryHours: number;
  shares: DesktopSquareShareInfo[];
  loading: boolean;
  creating: boolean;
  lastUrl: string;
  portalUrl?: string;
  onPasswordChange: (v: string) => void;
  onExpiryChange: (v: number) => void;
  onCreate: () => void;
  onRevoke: (shareId: string) => void;
  onCopy: (url: string) => void;
  onClose: () => void;
}): JSX.Element {
  const {
    zh, skillName, password, expiryHours, shares, loading, creating, lastUrl, portalUrl,
    onPasswordChange, onExpiryChange, onCreate, onRevoke, onCopy, onClose,
  } = props;

  return (
    <div
      role="presentation"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 42, 0.35)",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="skills-online-detail"
        role="dialog"
        aria-modal
        aria-label={zh ? "分享技能" : "Share skill"}
        style={{
          width: "min(520px, 100%)",
          maxHeight: "min(80vh, 640px)",
          overflow: "auto",
          background: "#fff",
          padding: "16px 18px",
          borderRadius: 14,
          boxShadow: "var(--app-shadow-menu)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="skills-online-detail-header">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <Share2 size={16} />
            <span>
              {zh ? "分享" : "Share"}: {skillName}
            </span>
          </div>
          <button type="button" className="skills-icon-btn" onClick={onClose} aria-label={zh ? "关闭" : "Close"}>
            <X size={16} />
          </button>
        </div>

        <label className="skills-label">{zh ? "访问密码（可选）" : "Password (optional)"}</label>
        <input
          className="skills-input"
          type="text"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={zh ? "留空则无需密码" : "Leave empty for no password"}
        />

        <label className="skills-label">{zh ? "有效期" : "Expires"}</label>
        <div className="skills-filter-row">
          {SHARE_EXPIRY_PRESETS.map((p) => (
            <button
              key={p.hours}
              type="button"
              className={`skills-filter-chip${expiryHours === p.hours ? " active" : ""}`}
              onClick={() => onExpiryChange(p.hours)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button type="button" className="skills-btn primary" disabled={creating} onClick={onCreate}>
          {creating ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />}
          {zh ? "创建分享链接" : "Create share link"}
        </button>

        {lastUrl ? (
          <code style={{ fontSize: 11, wordBreak: "break-all", display: "block" }}>{lastUrl}</code>
        ) : null}

        <p className="skills-label">{zh ? "已有分享" : "Existing shares"}</p>
        {loading ? (
          <p className="skills-loading">
            <Loader2 size={14} className="spin" />
          </p>
        ) : shares.length === 0 ? (
          <p className="skills-hint">{zh ? "暂无分享" : "No shares yet"}</p>
        ) : (
          shares.map((s) => (
            <div
              key={s.shareId}
              className="skills-share-item"
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 10,
                padding: "8px 0",
                borderTop: "1px solid var(--app-panel-border)",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <code style={{ fontSize: 11, wordBreak: "break-all" }}>{s.shareId}</code>
                <div className="skills-meta-text">
                  {s.hasPassword ? (zh ? "有密码 · " : "Password · ") : ""}
                  {zh ? "访问 " : "hits "}
                  {s.accessCount ?? 0}
                  {s.expiresAt ? ` · ${new Date(s.expiresAt).toLocaleString()}` : ""}
                </div>
              </div>
              <div style={{ display: "inline-flex", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className="skills-btn"
                  onClick={() =>
                    onCopy(
                      shareLandingUrl(s.shareId, portalUrl, s.shareUrl) ||
                        s.shareUrl ||
                        "",
                    )
                  }
                >
                  <Copy size={13} />
                </button>
                <button type="button" className="skills-btn danger" onClick={() => onRevoke(s.shareId)}>
                  <Trash2 size={13} />
                  {zh ? "撤销" : "Revoke"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
