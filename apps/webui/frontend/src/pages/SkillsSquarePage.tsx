import { Button as AntdButton, Drawer, Input, message, Modal, Select, Spin, Switch } from "antd";
import JSZip from "jszip";
import {
    ArrowUpDown,
    BookmarkPlus,
    Bot,
    Code,
    Copy,
    Download,
    FileText,
    FolderOpen,
    Globe,
    Image,
    Package,
    Search,
    Sparkles,
    Upload,
    Wrench
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/common/Button";
import MarkdownRenderer from "../components/common/markdownrender";
import { useSettingsStore } from "../components/store";
import { skillsAPI, type SkillsCatalogItem, type SkillsPublicDetail, type SkillsPublicItem, type SkillsUserItem } from "../components/views/api";
import { appContext } from "../hooks/provider";
import { useLocation, useNavigate } from "../hooks/useRouter";
import { useLang } from "../i18n/useLang";
import { getModelApiKeyFromSettings } from "../utils/modelApiKey";
import ShareSkillModal from "./ShareSkillModal";
import SkillDetailPanel from "./SkillDetailPanel";
import SkillListItem from "./SkillListItem";

/** Backend may store literal "undefined" when edit form state was out of sync. */
const sanitizeChangelog = (v?: string | null) => (v && v !== "undefined" ? v : "");

const ENABLE_SKILL_DOWNLOAD = false;
const ENABLE_HEPAI_SKILL_ZIP_UPLOAD = true;

const SEARCH_INPUT_CLS =
    "w-full rounded-xl border border-primary/40 bg-tertiary/10 py-2 pl-9 pr-3 text-sm text-primary outline-none placeholder:text-secondary/60 transition-[border-color,box-shadow] duration-200 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 dark:border-white/10 dark:bg-white/[0.04]";

const HEPAI_MAX_ZIP_BYTES = 10 * 1024 * 1024;
/** 与提示文案一致：文件夹打包内文件数上限 */
const MAX_SKILL_FOLDER_FILES = 200;

const SKILL_CATEGORIES = [
    "数据分析", "AI Agent", "自动化", "工具",
    "开发", "文档", "其他",
];

type FileWithRelativePath = File & { webkitRelativePath?: string };

async function zipFolderFileListToZipFile(files: FileList): Promise<File> {
    const zip = new JSZip();
    const n = files.length;
    if (n === 0) throw new Error("No files selected");
    if (n > MAX_SKILL_FOLDER_FILES) {
        throw new Error(`Max ${MAX_SKILL_FOLDER_FILES} files per folder`);
    }
    let hasSkillMd = false;
    for (let i = 0; i < n; i++) {
        const f = files[i] as FileWithRelativePath;
        const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
        if (/(^|\/)SKILL\.MD$/i.test(rel)) {
            hasSkillMd = true;
        }
        zip.file(rel, await f.arrayBuffer());
    }
    if (!hasSkillMd) {
        throw new Error("Folder must contain a SKILL.md");
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    if (blob.size > HEPAI_MAX_ZIP_BYTES) {
        throw new Error("Archive exceeds 10 MB, please reduce and retry");
    }
    const first = files[0] as FileWithRelativePath;
    const firstRel = (first.webkitRelativePath || first.name).replace(/\\/g, "/");
    const rootFolder = firstRel.includes("/") ? (firstRel.split("/")[0] ?? "skill") : "skill";
    const safeStem = rootFolder.replace(/[^\w\u4e00-\u9fff.-]/g, "-").slice(0, 80) || "skill";
    return new File([blob], `${safeStem}.zip`, { type: "application/zip" });
}

const SKILL_ICON_OPTIONS: {
    value: string;
    label: string;
    Icon: React.ElementType;
}[] = [
        { value: "package", label: "Package", Icon: Package },
        { value: "wrench", label: "Wrench", Icon: Wrench },
        { value: "code", label: "Code", Icon: Code },
        { value: "sparkles", label: "Sparkles", Icon: Sparkles },
        { value: "bot", label: "Agent", Icon: Bot },
        { value: "file-text", label: "Document", Icon: FileText },
    ];

const ICON_LABEL_KEY_MAP: Record<string, "skillSquare.iconPackage" | "skillSquare.iconWrench" | "skillSquare.iconCode" | "skillSquare.iconSparkles" | "skillSquare.iconBot" | "skillSquare.iconFileText"> = {
    package: "skillSquare.iconPackage",
    wrench: "skillSquare.iconWrench",
    code: "skillSquare.iconCode",
    sparkles: "skillSquare.iconSparkles",
    bot: "skillSquare.iconBot",
    "file-text": "skillSquare.iconFileText",
};

type HepAIUploadRow = SkillsUserItem;

/** Resolve icon to a React node: URL → <img>, "__profile__" → Image, otherwise → Lucide icon component. */
function renderSkillIcon(icon: string | undefined, sizeClass: string, iconSize: string) {
    if (icon && /^https?:\/\//.test(icon)) {
        return (
            <img
                src={icon}
                alt=""
                className={`${sizeClass} rounded-[5.4px] object-cover shrink-0`}
            />
        );
    }
    if (icon === "__profile__") {
        return (
            <div className={`${sizeClass} shrink-0 flex items-center justify-center rounded-xl border border-accent/15 bg-accent/[0.08] text-accent dark:border-accent/20 dark:bg-accent/[0.12]`}>
                <Image className={iconSize} strokeWidth={2} aria-hidden />
            </div>
        );
    }
    const IconComponent = SKILL_ICON_OPTIONS.find((o) => o.value === icon)?.Icon ?? Package;
    return (
        <div className={`${sizeClass} shrink-0 flex items-center justify-center rounded-xl border border-accent/15 bg-accent/[0.08] text-accent dark:border-accent/20 dark:bg-accent/[0.12]`}>
            <IconComponent className={iconSize} strokeWidth={2} aria-hidden />
        </div>
    );
}

/** 主名 + 扩展名拆分，便于用字重/颜色区分。 */
function splitArchiveName(filename: string): { stem: string; ext: string } {
    if (filename.toLowerCase().endsWith(".zip")) {
        return { stem: filename.slice(0, -4), ext: ".zip" };
    }
    return { stem: filename, ext: "" };
}

/** 相对上传时间，超过约一周回落到日期。 */
function formatRelativePast(ms: number): string {
    const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (sec < 15) return "Just now";
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day}d ago`;
    return new Date(ms).toLocaleDateString();
}

function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n < 0) return "—";
    if (n < 1024) return `${n} B`;
    const kb = n / 1024;
    if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

const SkillsSquarePage: React.FC = () => {
    const { user } = React.useContext(appContext);
    const { t, lang } = useLang();
    const isZh = lang === "zh";
    const location = useLocation();
    const navigate = useNavigate();
    const [search, setSearch] = useState("");
    const [searchExpanded, setSearchExpanded] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [active, setActive] = useState<SkillsCatalogItem | null>(null);
    const [detailBody, setDetailBody] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [downloadSlug, setDownloadSlug] = useState<string | null>(null);
    // ── tab switch ──
    const urlTab = useMemo(() => {
        const params = new URLSearchParams(location.search);
        const t = params.get("tab");
        return t === "private" ? "private" : "public";
    }, [location.search]);
    const [activeTab, setActiveTab] = useState<"private" | "public">(urlTab);
    // Sync activeTab from URL on navigation
    useEffect(() => {
        setActiveTab(urlTab);
    }, [urlTab]);
    // ── category filter ──
    const [activeCategory, setActiveCategory] = useState("");
    // ── detail view (from ?skill= query param) ──
    const skillSlugFromUrl = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return params.get("skill") || null;
    }, [location.search]);
    const [skillDetail, setSkillDetail] = useState<SkillsPublicDetail | null>(null);
    const [skillDetailLoading, setSkillDetailLoading] = useState(false);

    // ── public skills (GFS) ──
    const [publicRows, setPublicRows] = useState<SkillsPublicItem[]>([]);
    const [publicLoading, setPublicLoading] = useState(false);
    const [publicApiKey, setPublicApiKey] = useState("");
    const [publicApiKeyLoading, setPublicApiKeyLoading] = useState(true);

    // Auto-fetch API key from user settings
    useEffect(() => {
        if (!user?.email) return;
        let cancelled = false;
        setPublicApiKeyLoading(true);
        getModelApiKeyFromSettings(user.email).then((key) => {
            if (!cancelled) {
                setPublicApiKey(key || "");
                setPublicApiKeyLoading(false);
            }
        }).catch(() => {
            if (!cancelled) setPublicApiKeyLoading(false);
        });
        return () => { cancelled = true; };
    }, [user?.email]);
    const [skillUploadOpen, setSkillUploadOpen] = useState(false);
    const [skillUploading, setSkillUploading] = useState(false);
    const [isPublicSkill, setIsPublicSkill] = useState(false);
    const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
    const hepaiZipInputRef = useRef<HTMLInputElement | null>(null);
    const hepaiFolderInputRef = useRef<HTMLInputElement | null>(null);
    /** 必须在挂载时设置 webkitdirectory；勿对 input 使用 pointer-events-none，否则会阻断程序化 .click() 打开选文件夹对话框 */
    const setFolderInputRef = useCallback((el: HTMLInputElement | null) => {
        hepaiFolderInputRef.current = el;
        if (el) {
            el.setAttribute("webkitdirectory", "");
            el.setAttribute("directory", "");
            try {
                el.setAttribute("mozdirectory", "");
            } catch {
                /* ignore */
            }
            el.multiple = true;
        }
    }, []);
    const [hepaiPackingFolder, setHepaiPackingFolder] = useState(false);
    const [hepaiZipFile, setHepaiZipFile] = useState<File | null>(null);
    const [publishSlug, setPublishSlug] = useState("");
    const [publishDisplayName, setPublishDisplayName] = useState("");
    const [publishIcon, setPublishIcon] = useState<string>("");
    const [publishVersion, setPublishVersion] = useState("1.0.0");
    const [publishChangelog, setPublishChangelog] = useState("");
    const [publishCategory, setPublishCategory] = useState<string[]>([]);
    const [publicProfileFile, setPublicProfileFile] = useState<File | null>(null);
    const publicProfileInputRef = useRef<HTMLInputElement | null>(null);
    const [publicProfilePreview, setPublicProfilePreview] = useState<string | null>(null);
    const [hepaiRows, setHepaiRows] = useState<HepAIUploadRow[]>([]);
    const [skillMdOpen, setSkillMdOpen] = useState(false);
    const [skillMdLoading, setSkillMdLoading] = useState(false);
    const [skillMdTitle, setSkillMdTitle] = useState<string>("");
    const [skillMdBody, setSkillMdBody] = useState<string>("");
    const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
    const [privateFilter, setPrivateFilter] = useState<"created" | "collected">("created");
    const [importingSlug, setImportingSlug] = useState<string | null>(null);
    const [detailRefreshKey, setDetailRefreshKey] = useState(0);
    const [hepaiRefreshKey, setHepaiRefreshKey] = useState(0);
    const { config: _config } = useSettingsStore();

    // ── Share Skill modal ──
    const [shareSkillSlug, setShareSkillSlug] = useState<string | null>(null);
    const [shareSkillName, setShareSkillName] = useState<string>("");
    const [sortBy, setSortBy] = useState<"name" | "time">("time");
    const [sortOpen, setSortOpen] = useState(false);
    const sortRef = useRef<HTMLDivElement>(null);

    // Close sort dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
                setSortOpen(false);
            }
        };
        if (sortOpen) document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [sortOpen]);

    /** Slugs the user has already collected (imported from public). */
    const collectedSlugs = useMemo(() => {
        const slugs = new Set<string>();
        for (const r of hepaiRows) {
            if (r.source === "imported" && r.slug) slugs.add(r.slug);
        }
        return slugs;
    }, [hepaiRows]);

    const hepaiPickPreview = useMemo(
        () => (hepaiZipFile ? { name: hepaiZipFile.name, size: hepaiZipFile.size } : null),
        [hepaiZipFile]
    );

    /** Source of the currently-viewed private skill: "created" or "imported". */
    const privateSkillSource = useMemo<"created" | "imported">(() => {
        if (!skillSlugFromUrl) return "created";
        const row = hepaiRows.find(r => r.slug === skillSlugFromUrl);
        return row?.source === "imported" ? "imported" : "created";
    }, [skillSlugFromUrl, hepaiRows]);

    const filteredHepaiRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const sourceFiltered = hepaiRows.filter((r) => {
            return privateFilter === "collected" ? r.source === "imported" : r.source !== "imported";
        });
        const categoryFiltered = activeCategory
            ? sourceFiltered.filter((r) => (r.category || "").split(",").map(c => c.trim()).includes(activeCategory))
            : sourceFiltered;
        const searchFiltered = !q
            ? categoryFiltered
            : categoryFiltered.filter((r) => {
                const desc = (r.description ?? "").toLowerCase();
                const by = (r.owner ?? "").toLowerCase();
                const title = (r.name ?? "").toLowerCase();
                return (
                    title.includes(q) ||
                    desc.includes(q) ||
                    (by.length > 0 && by.includes(q))
                );
            });
        return [...searchFiltered].sort((a, b) => {
            if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
            return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
        });
    }, [hepaiRows, search, privateFilter, activeCategory, sortBy]);

    const filteredPublicRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        const categoryFiltered = activeCategory
            ? publicRows.filter((r) => (r.category || "").split(",").map(c => c.trim()).includes(activeCategory))
            : publicRows;
        const searchFiltered = !q
            ? categoryFiltered
            : categoryFiltered.filter((r) =>
                r.name.toLowerCase().includes(q) ||
                r.description.toLowerCase().includes(q) ||
                r.owner.toLowerCase().includes(q) ||
                r.slug.toLowerCase().includes(q)
            );
        return [...searchFiltered].sort((a, b) => {
            if (sortBy === "name") return (a.name || "").localeCompare(b.name || "");
            return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
        });
    }, [publicRows, search, activeCategory, sortBy]);

    // Compute available categories from current tab's rows
    const SKILL_CATEGORIES = ["数据分析", "AI Agent", "自动化", "工具", "开发", "文档", "其他"];
    const availableCategories = SKILL_CATEGORIES;

    const resetPublishForm = () => {
        setHepaiZipFile(null);
        setPublishSlug("");
        setPublishDisplayName("");
        setPublishIcon("");
        setPublishVersion("1.0.0");
        setPublishChangelog("");
        setPublishCategory([]);
        setPublicProfileFile(null);
        setPublicProfilePreview(null);
        setIsPublicSkill(false);
        setEditingSkillId(null);
        if (hepaiZipInputRef.current) {
            hepaiZipInputRef.current.value = "";
        }
        if (hepaiFolderInputRef.current) {
            hepaiFolderInputRef.current.value = "";
        }
        if (publicProfileInputRef.current) {
            publicProfileInputRef.current.value = "";
        }
    };

    const syncPickFromFile = (f: File | null) => {
        if (f && f.size > HEPAI_MAX_ZIP_BYTES) {
            message.warning(t("skillSquare.zipTooLargeToast"));
            return;
        }
        setHepaiZipFile(f);
        if (f?.name) {
            const stem = splitArchiveName(f.name).stem;
            setPublishDisplayName((prev) => (prev.trim() ? prev : stem));
        }
    };

    const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const list = e.target.files;
        if (!list?.length) return;
        const first = list[0] as FileWithRelativePath;
        if (!first.webkitRelativePath) {
            message.error(t("skillSquare.zipPickError"));
            e.target.value = "";
            return;
        }
        setHepaiPackingFolder(true);
        try {
            const zipFile = await zipFolderFileListToZipFile(list);
            syncPickFromFile(zipFile);
            message.success(t("skillSquare.zipPacked"));
        } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
        } finally {
            setHepaiPackingFolder(false);
            e.target.value = "";
        }
    };

    useEffect(() => {
        const userId = user?.email || "";
        console.log("[list] useEffect triggered, userId=", userId);
        if (!userId) return;
        // Wait for API key to be loaded before making the request
        if (publicApiKeyLoading) return;
        let cancelled = false;
        (async () => {
            try {
                console.log("[list] calling listUserSkills, userId=", userId);
                const rows = await skillsAPI.listUserSkills(userId, publicApiKey || undefined);
                if (cancelled) return;
                setHepaiRows(rows);
            } catch (e) {
                console.error("[list] listUserSkills failed", e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user?.email, hepaiRefreshKey, publicApiKeyLoading]);

    useEffect(() => {
        return () => {
            if (copyFeedbackTimerRef.current) {
                clearTimeout(copyFeedbackTimerRef.current);
                copyFeedbackTimerRef.current = null;
            }
        };
    }, []);

    // Load public skills from GFS when tab is switched
    useEffect(() => {
        if (activeTab !== "public") return;
        let cancelled = false;
        (async () => {
            setPublicLoading(true);
            try {
                const items = await skillsAPI.listPublicSkills(publicApiKey || undefined);
                if (!cancelled) setPublicRows(items);
            } catch {
                // keep quiet
            } finally {
                if (!cancelled) setPublicLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [activeTab, publicApiKey]);

    // Load skill detail when ?skill= param is set
    const skillDetailRef = useRef(skillDetail);
    skillDetailRef.current = skillDetail;
    const hepaiRowsRef = useRef(hepaiRows);
    hepaiRowsRef.current = hepaiRows;
    useEffect(() => {
        if (!skillSlugFromUrl) {
            setSkillDetail(null);
            return;
        }
        let cancelled = false;
        (async () => {
            setSkillDetailLoading(true);
            const row = hepaiRowsRef.current.find(r => r.slug === skillSlugFromUrl);
            const userId = user?.email || "";

            try {
                if (activeTab === "private" && row && userId) {
                    try {
                        const md = await skillsAPI.getUserSkillMd(skillSlugFromUrl, userId, publicApiKey || undefined);
                        if (!cancelled) {
                            setSkillDetail({
                                slug: skillSlugFromUrl,
                                name: row.name || skillSlugFromUrl,
                                description: row.description || "",
                                icon: row.icon || "package",
                                version: row.version || "0.0.0",
                                owner: row.owner || "",
                                body: md.content,
                                changelog: sanitizeChangelog(row.changelog),
                                profile: row.profile || "",
                                created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
                                updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
                                downloads: row.downloads ?? 0,
                                can_edit: true,
                            });
                        }
                        return;
                    } catch {
                        // User ZIP missing (e.g. direct public publish) — fall back to public catalog body.
                    }
                }

                const detail = await skillsAPI.getPublicSkill(skillSlugFromUrl, publicApiKey || undefined);
                if (cancelled) return;
                if (activeTab === "private" && row) {
                    setSkillDetail({
                        ...detail,
                        name: row.name || detail.name,
                        description: row.description || detail.description,
                        icon: row.icon || detail.icon,
                        version: row.version || detail.version,
                        owner: row.owner || detail.owner,
                        changelog: sanitizeChangelog(row.changelog) || detail.changelog,
                        profile: row.profile || detail.profile,
                        created_at: row.created_at ? new Date(row.created_at).toISOString() : detail.created_at,
                        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : detail.updated_at,
                        downloads: row.downloads ?? detail.downloads,
                        can_edit: true,
                    });
                } else {
                    setSkillDetail(detail);
                }
            } catch {
                if (!cancelled) setSkillDetail(null);
            } finally {
                if (!cancelled) setSkillDetailLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [skillSlugFromUrl, publicApiKey, detailRefreshKey, user?.email, hepaiRows, activeTab]);

    const openSkillDetail = useCallback((slug: string) => {
        const params = new URLSearchParams(location.search);
        params.set("skill", slug);
        navigate(`?${params.toString()}`, { replace: false });
    }, [location.search, navigate]);

    const closeSkillDetail = useCallback(() => {
        const params = new URLSearchParams(location.search);
        params.delete("skill");
        navigate(`?${params.toString()}`, { replace: false });
    }, [location.search, navigate]);

    const switchTab = useCallback((tab: "public" | "private") => {
        setActiveTab(tab);
        setSearch("");
        setSearchExpanded(false);
        setActiveCategory("");
        setSkillUploadOpen(false);
        const params = new URLSearchParams(location.search);
        params.set("tab", tab);
        params.delete("skill");
        navigate(`?${params.toString()}`, { replace: true });
    }, [location.search, navigate]);

    const copyPreviewUrl = async (rowId: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            if (copyFeedbackTimerRef.current) {
                clearTimeout(copyFeedbackTimerRef.current);
            }
            setCopiedRowId(rowId);
            copyFeedbackTimerRef.current = setTimeout(() => {
                setCopiedRowId(null);
                copyFeedbackTimerRef.current = null;
            }, 1600);
        } catch {
            message.error(t("skillSquare.copyFailed"));
        }
    };

    const copySkillMdFullText = async () => {
        if (!skillMdBody) return;
        try {
            await navigator.clipboard.writeText(skillMdBody);
            message.success(t("skillSquare.copyFullText"));
        } catch {
            message.error(t("skillSquare.copyFailed"));
        }
    };


    const handleDownload = async (slug: string) => {
        setDownloadSlug(slug);
        try {
            await skillsAPI.downloadCatalogArchive(slug);
            message.success(t("skillSquare.downloadStarted"));
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setDownloadSlug(null);
        }
    };
    // ── unified skill publish / upload ──────────────────────────────────────

    const openSkillPublishModal = (prefill?: HepAIUploadRow | SkillsPublicDetail, isPublic?: boolean) => {
        resetPublishForm();
        if (!prefill) {
            if (isPublic !== undefined) setIsPublicSkill(isPublic);
            setSkillUploadOpen(true);
            return;
        }
        // explicit isPublic param takes precedence over body field detection
        const resolvedPublic = isPublic !== undefined ? isPublic : ("body" in prefill);
        setIsPublicSkill(resolvedPublic);
        setEditingSkillId(prefill.slug);
        setPublishDisplayName(prefill.name || "");
        setPublishIcon(prefill.icon || "");
        setPublishVersion(prefill.version || "1.0.0");
        setPublishChangelog(sanitizeChangelog(prefill.changelog));
        setPublishCategory(prefill.category ? prefill.category.split(",").map((s) => s.trim()).filter(Boolean) : []);
        if (resolvedPublic) {
            if (prefill.profile) setPublicProfilePreview(prefill.profile);
        } else {
            setPublishSlug(prefill.slug || "");
        }
        setSkillUploadOpen(true);
    };

    const submitSkillUpload = async () => {
        const isEdit = !!editingSkillId;
        const file = hepaiZipFile;

        if (!isEdit && !file) {
            message.warning(t("skillSquare.selectZipPack"));
            return;
        }
        if (file) {
            if (!file.name.toLowerCase().endsWith(".zip")) {
                message.warning(t("skillSquare.zipFormatError"));
                return;
            }
            if (file.size > HEPAI_MAX_ZIP_BYTES) {
                message.warning(t("skillSquare.zipFileTooLarge"));
                return;
            }
        }
        const dn = publishDisplayName.trim();
        if (!dn) {
            message.warning(t("skillSquare.publishNameRequired"));
            return;
        }
        const version = publishVersion.trim();
        if (!version) {
            message.warning(t("skillSquare.versionRequired"));
            return;
        }
        if (isPublicSkill && !publicApiKey.trim()) {
            message.warning(t("skillSquare.noApiKey"));
            return;
        }
        if (!isPublicSkill) {
            const userId = user?.email || "";
            if (!userId) {
                message.error(t("skillSquare.notLoggedIn"));
                return;
            }
            const slugTrim = publishSlug.trim();
            if (slugTrim && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugTrim.toLowerCase())) {
                message.warning(t("skillSquare.publishSlugHint"));
                return;
            }
        }

        setSkillUploading(true);
        try {
            console.log("[publish] submitSkillUpload start", { isEdit, isPublicSkill, userId: user?.email, slug: publishSlug.trim(), displayName: dn, version, file: file ? `${file.name} (${file.size} bytes)` : null });
            if (isPublicSkill) {
                // ── public upload ──
                if (isEdit) {
                    await skillsAPI.updatePublicSkill(editingSkillId!, publicApiKey.trim(), {
                        file: file || undefined,
                        name: dn || undefined,
                        icon: publishIcon.trim() || undefined,
                        version: publishVersion.trim() || undefined,
                        changelog: publishChangelog.trim() || undefined,
                        profile: publicProfileFile || undefined,
                        category: publishCategory.length > 0 ? publishCategory.join(", ") : undefined,
                    });
                    if (skillSlugFromUrl === editingSkillId) {
                        const detail = await skillsAPI.getPublicSkill(editingSkillId!, publicApiKey.trim());
                        setSkillDetail(detail);
                    }
                } else {
                    await skillsAPI.uploadPublicSkill(file!, publishSlug.trim() || undefined, publicApiKey.trim(), {
                        display_name: dn || undefined,
                        icon: publishIcon.trim() || undefined,
                        version: publishVersion.trim() || undefined,
                        changelog: publishChangelog.trim() || undefined,
                        profile: publicProfileFile || undefined,
                        category: publishCategory.length > 0 ? publishCategory.join(", ") : undefined,
                    });
                }
                const items = await skillsAPI.listPublicSkills(publicApiKey.trim());
                setPublicRows(items);
                // Also refresh user list so the skill appears in "my creations"
                const userId = user?.email || "";
                if (userId) {
                    const rows = await skillsAPI.listUserSkills(userId, publicApiKey || undefined);
                    setHepaiRows(rows);
                }
                setActiveTab("public");
            } else {
                // ── private upload ──
                const userId = user?.email || "";
                console.log("[publish] private branch, isEdit=", isEdit, "editingSkillId=", editingSkillId, "userId=", userId);
                if (isEdit) {
                    console.log("[publish] calling updateUserSkill", { slug: editingSkillId, userId });
                    await skillsAPI.updateUserSkill(editingSkillId!, userId, {
                        file: file ?? undefined,
                        display_name: dn,
                        icon: publishIcon.trim() || undefined,
                        version: publishVersion.trim() || "1.0.0",
                        changelog: publishChangelog.trim() || undefined,
                        profile: publicProfileFile || undefined,
                        category: publishCategory.length > 0 ? publishCategory.join(", ") : undefined,
                    }, publicApiKey || undefined);
                } else {
                    console.log("[publish] calling uploadUserSkill", { userId, file: file?.name, fileSize: file?.size });
                    await skillsAPI.uploadUserSkill(userId, file!, {
                        slug: publishSlug.trim() || undefined,
                        display_name: dn,
                        icon: publishIcon.trim() || undefined,
                        version: publishVersion.trim() || "1.0.0",
                        changelog: publishChangelog.trim() || undefined,
                        source: "created",
                        category: publishCategory.length > 0 ? publishCategory.join(", ") : undefined,
                    }, publicApiKey || undefined);
                }
                const rows = await skillsAPI.listUserSkills(userId, publicApiKey || undefined);
                setHepaiRows(rows);
            }
            message.success(isEdit ? t("skillSquare.skillUpdated") : (isPublicSkill ? t("skillSquare.publicPublished") : t("skillSquare.publishSuccess")));
            setSkillUploadOpen(false);
            resetPublishForm();
        } catch (e) {
            console.error("[publish] submitSkillUpload FAILED", { error: e, message: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setSkillUploading(false);
        }
    };

    const openSkillMdPreview = async (fileId: string, filename: string) => {
        const userId = user?.email || "";
        if (!userId) {
            message.error(t("skillSquare.notLoggedIn"));
            return;
        }
        setSkillMdTitle(filename);
        setSkillMdBody("");
        setSkillMdOpen(true);
        setSkillMdLoading(true);
        try {
            const { content } = await skillsAPI.getUserSkillMd(fileId, userId, publicApiKey || undefined);
            setSkillMdBody(content);
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
            setSkillMdOpen(false);
        } finally {
            setSkillMdLoading(false);
        }
    };

    // ── import public → private ─────────────────────────────────────────────

    const importPublicSkill = async (slug: string, displayName: string) => {
        if (collectedSlugs.has(slug)) {
            message.info(t("skillSquare.alreadyCollected"));
            return;
        }
        const userId = user?.email || "";
        if (!userId) {
            message.error(t("skillSquare.notLoggedInShort"));
            return;
        }
        setImportingSlug(slug);
        try {
            message.loading({ content: t("skillSquare.collecting"), key: "import" });
            await skillsAPI.importPublicSkill(slug, userId, displayName, publicApiKey || undefined);
            message.success({ content: t("skillSquare.imported"), key: "import" });
            // Refresh private list
            const rows = await skillsAPI.listUserSkills(userId, publicApiKey || undefined);
            setHepaiRows(rows);
        } catch (e) {
            message.error({ content: e instanceof Error ? e.message : String(e), key: "import" });
        } finally {
            setImportingSlug(null);
        }
    };

    const downloadPublicSkill = async (slug: string) => {
        try {
            await skillsAPI.downloadPublicSkill(slug);
            message.success(t("skillSquare.downloadStartedToast"));
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        }
    };

    // ── Share Skill callbacks ─────────────────────────────────────────────

    const handleCreateShare = useCallback(
        async (slug: string, userId: string, password: string, expiresInHours: number) => {
            return skillsAPI.createSkillShare(slug, userId, password, expiresInHours);
        },
        [],
    );

    const handleRevokeShare = useCallback(
        async (slug: string, userId: string, shareId: string) => {
            await skillsAPI.revokeSkillShare(slug, userId, shareId);
        },
        [],
    );

    const handleListShares = useCallback(
        async (slug: string, userId: string) => {
            return skillsAPI.listSkillShares(slug, userId);
        },
        [],
    );

    const deletePublicSkill = async (slug: string) => {
        Modal.confirm({
            title: t("skillSquare.deleteTitle"),
            content: t("skillSquare.deleteContent", slug),
            okText: t("skillSquare.deleteOk"),
            okButtonProps: { danger: true },
            cancelText: t("skillSquare.deleteCancel"),
            onOk: async () => {
                try {
                    await skillsAPI.deletePublicSkill(slug, publicApiKey.trim());
                    setPublicRows((prev) => prev.filter((r) => r.slug !== slug));
                    message.success(t("skillSquare.skillDeleted", slug));
                } catch (e) {
                    message.error(e instanceof Error ? e.message : String(e));
                }
            },
        });
    };

    const deleteUserSkill = async (slug: string, displayName: string) => {
        const userId = user?.email || "";
        if (!userId) {
            message.error(t("skillSquare.notLoggedInShort"));
            return;
        }
        Modal.confirm({
            title: t("skillSquare.deleteUserSkillTitle"),
            content: t("skillSquare.deleteUserSkillContent", displayName),
            okText: t("skillSquare.deleteOk"),
            okButtonProps: { danger: true },
            cancelText: t("skillSquare.deleteCancel"),
            onOk: async () => {
                try {
                    await skillsAPI.deleteUserSkill(slug, userId, publicApiKey || undefined);
                    setHepaiRows((prev) => prev.filter((r) => r.slug !== slug));
                    if (skillDetail?.slug === slug) closeSkillDetail();
                    message.success(t("skillSquare.skillDeletedToast", displayName));
                } catch (e) {
                    message.error(e instanceof Error ? e.message : String(e));
                }
            },
        });
    };

    const uncollectSkill = async (slug: string, displayName: string) => {
        const userId = user?.email || "";
        if (!userId) {
            message.error(t("skillSquare.notLoggedInShort"));
            return;
        }
        Modal.confirm({
            title: t("skillSquare.uncollectTitle"),
            content: t("skillSquare.uncollectContent", displayName),
            okText: t("skillSquare.uncollectOk"),
            okButtonProps: { danger: true },
            cancelText: t("skillSquare.deleteCancel"),
            onOk: async () => {
                try {
                    await skillsAPI.deleteUserSkill(slug, userId, publicApiKey || undefined);
                    setHepaiRows((prev) => prev.filter((r) => r.slug !== slug));
                    if (skillDetail?.slug === slug) closeSkillDetail();
                    message.success(t("skillSquare.uncollectedToast", displayName));
                } catch (e) {
                    message.error(e instanceof Error ? e.message : String(e));
                }
            },
        });
    };

    const toggleSkillPublic = async (slug: string, makePublic: boolean) => {
        const userId = user?.email || "";
        if (!userId) return;
        try {
            await skillsAPI.toggleSkillVisibility(slug, userId, makePublic, publicApiKey || undefined);
            // Update hepaiRows in-place so the list badge and detail panel reflect the change
            setHepaiRows((prev) =>
                prev.map((r) => (r.slug === slug ? { ...r, public: makePublic, unlisted: !makePublic } : r)),
            );
            if (makePublic) {
                message.success(t("skillSquare.published", slug));
            } else {
                message.success(t("skillSquare.hidden", slug));
            }
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        }
    };

    /** Unified detail-panel props — computed from skill + user state + activeTab. */
    const detailPanelProps = useMemo(() => {
        if (!skillDetail) return null;
        const isOwner = !!(user?.email && skillDetail.owner === user.email);
        const isPublicTab = activeTab === "public";
        const row = hepaiRows.find(r => r.slug === skillDetail.slug);
        const source: "created" | "imported" | undefined =
            row?.source === "imported" ? "imported" : row ? "created" : undefined;
        const canEdit = isOwner && !isPublicTab;
        return {
            skillDetail,
            loading: skillDetailLoading,
            onClose: closeSkillDetail,
            onDownload: downloadPublicSkill,
            renderSkillIcon,
            t,
            // owner actions (hidden in public tab)
            onEdit: canEdit ? () => openSkillPublishModal(skillDetail, false) : undefined,
            onTogglePublic: canEdit ? toggleSkillPublic : undefined,
            showToggleButton: canEdit
                ? (row?.public === true)
                : undefined,
            onShare: (isOwner && !isPublicTab) ? () => { setShareSkillSlug(skillDetail.slug); setShareSkillName(skillDetail.name); } : undefined,
            source,
            onDelete: (source === "created" && !isPublicTab) ? deleteUserSkill : undefined,
            onUncollect: (source === "imported" && !isPublicTab) ? uncollectSkill : undefined,
            // non-owner / public actions
            isCollected: !isOwner ? collectedSlugs.has(skillDetail.slug) : undefined,
            isImporting: !isOwner ? importingSlug === skillDetail.slug : false,
            onImport: !isOwner ? importPublicSkill : undefined,
        };
    }, [
        activeTab, skillDetail, skillDetailLoading, user, hepaiRows, collectedSlugs,
        importingSlug, closeSkillDetail, downloadPublicSkill,
        renderSkillIcon, t, openSkillPublishModal, toggleSkillPublic,
        setShareSkillSlug, setShareSkillName, deleteUserSkill, uncollectSkill, importPublicSkill,
    ]);

    const handlePublishSkill = () => {
        void submitSkillUpload();
    };
    return (
        <div className="relative flex h-full min-h-0 flex-col bg-primary">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-48 overflow-hidden" aria-hidden>
                <div className="absolute left-1/2 top-0 h-40 w-[min(560px,90vw)] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-3xl dark:bg-accent/[0.11]" />
            </div>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col py-6 px-2">
                {/* ── Header (list page only) ── */}
                {!skillSlugFromUrl && (
                    <div className="shrink-0 mb-3 px-2">
                        <div className="flex items-center gap-2.5">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-primary/50 bg-tertiary/30 text-accent dark:border-white/10 dark:bg-white/[0.05]">
                                <Wrench className="h-4 w-4" aria-hidden />
                            </span>
                            <h1 className="font-agent text-xl font-semibold tracking-[-0.02em] text-primary sm:text-[1.35rem]">
                                {t("skillSquare.title")}
                            </h1>
                        </div>
                        <p className="mt-1 max-w-md text-sm leading-relaxed text-secondary">
                            {t("skillSquare.subtitle")}
                        </p>
                    </div>
                )}

                {/* ── Sidebar + Content ── */}
                <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-row gap-0">
                    {!skillSlugFromUrl && (
                        <nav className="w-40 shrink-0 space-y-0.5 pt-1">
                            {/* ── Public zone ── */}
                            <button
                                type="button"
                                onClick={() => { switchTab("public"); }}
                                className={[
                                    "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2.5",
                                    activeTab === "public" && !skillUploadOpen
                                        ? "bg-accent/10 text-accent"
                                        : "text-secondary hover:text-primary hover:bg-tertiary/30",
                                ].join(" ")}
                            >
                                <Globe className="h-4 w-4 shrink-0" aria-hidden />
                                {t("skillSquare.allSkills")}
                            </button>

                            {/* ── Private zone ── */}
                            <button
                                type="button"
                                onClick={() => { switchTab("private"); setPrivateFilter("created"); }}
                                className={[
                                    "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2.5",
                                    activeTab === "private" && privateFilter === "created" && !skillUploadOpen
                                        ? "bg-accent/10 text-accent"
                                        : "text-secondary hover:text-primary hover:bg-tertiary/30",
                                ].join(" ")}
                            >
                                <Wrench className="h-4 w-4 shrink-0" aria-hidden />
                                {t("skillSquare.myCreations")}
                            </button>

                            <button
                                type="button"
                                onClick={() => { switchTab("private"); setPrivateFilter("collected"); }}
                                className={[
                                    "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2.5",
                                    activeTab === "private" && privateFilter === "collected" && !skillUploadOpen
                                        ? "bg-accent/10 text-accent"
                                        : "text-secondary hover:text-primary hover:bg-tertiary/30",
                                ].join(" ")}
                            >
                                <BookmarkPlus className="h-4 w-4 shrink-0" aria-hidden />
                                {t("skillSquare.myCollections")}
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (activeTab === "public") openSkillPublishModal(undefined, true);
                                    else openSkillPublishModal(undefined, false);
                                }}
                                className={[
                                    "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2.5",
                                    skillUploadOpen
                                        ? "bg-accent/10 text-accent"
                                        : "text-secondary hover:text-primary hover:bg-tertiary/30",
                                ].join(" ")}
                            >
                                <Upload className="h-4 w-4 shrink-0" aria-hidden />
                                {t("skillSquare.publishSkill")}
                            </button>
                        </nav>
                    )}

                    {/* ── Right content area ── */}
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        {/* Search + Category filter bar — same row */}
                        {!skillSlugFromUrl && !skillUploadOpen && (
                            <div className="shrink-0 flex items-center gap-3 pb-4 pr-6">
                                {/* Category filter pill buttons */}
                                <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
                                        <button
                                            type="button"
                                            onClick={() => setActiveCategory("")}
                                            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                                                !activeCategory
                                                    ? "bg-accent text-white"
                                                    : "bg-tertiary/10 text-secondary hover:bg-tertiary/20"
                                            }`}
                                        >
                                            {t("skillSquare.allCategories") || "全部"}
                                        </button>
                                        {availableCategories.map(cat => (
                                            <button
                                                key={cat}
                                                type="button"
                                                onClick={() => setActiveCategory(cat === activeCategory ? "" : cat)}
                                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
                                                    cat === activeCategory
                                                        ? "bg-accent text-white"
                                                        : "bg-tertiary/10 text-secondary hover:bg-tertiary/20"
                                                }`}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>
                                {/* Search: icon only; click to expand input */}
                                <div className="flex items-center gap-2 ml-auto shrink-0">
                                    {searchExpanded ? (
                                        <div className="relative max-w-[180px]">
                                            <Search
                                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
                                                aria-hidden
                                            />
                                            <input
                                                type="search"
                                                autoFocus
                                                value={search}
                                                onChange={(e) => setSearch(e.target.value)}
                                                onBlur={() => { if (!search.trim()) setSearchExpanded(false); }}
                                                onKeyDown={(e) => { if (e.key === "Escape") { setSearch(""); setSearchExpanded(false); } }}
                                                placeholder={t("skillSquare.searchPlaceholder")}
                                                className={SEARCH_INPUT_CLS}
                                            />
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setSearchExpanded(true)}
                                            className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-tertiary/10 hover:text-primary"
                                            title={t("skillSquare.searchPlaceholder")}
                                        >
                                            <Search className="h-4 w-4" aria-hidden />
                                        </button>
                                    )}
                                    {/* Sort button */}
                                    <div className="relative" ref={sortRef}>
                                        <button
                                            type="button"
                                            onClick={() => setSortOpen(v => !v)}
                                            className="flex h-9 w-9 items-center justify-center rounded-lg text-secondary transition-colors hover:bg-tertiary/10 hover:text-primary"
                                            title={sortBy === "time" ? (isZh ? "按时间排序" : "Sort by time") : (isZh ? "按名称排序" : "Sort by name")}
                                        >
                                            <ArrowUpDown className="h-4 w-4" aria-hidden />
                                        </button>
                                        {sortOpen && (
                                            <div className="absolute right-0 top-full mt-1 z-50 min-w-[120px] rounded-lg border border-primary/10 bg-white py-1 shadow-lg dark:bg-slate-800">
                                                <button
                                                    type="button"
                                                    onClick={() => { setSortBy("time"); setSortOpen(false); }}
                                                    className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-tertiary/10 ${sortBy === "time" ? "text-accent font-semibold" : "text-secondary"}`}
                                                >
                                                    {isZh ? "按时间" : "By time"}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => { setSortBy("name"); setSortOpen(false); }}
                                                    className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-tertiary/10 ${sortBy === "name" ? "text-accent font-semibold" : "text-secondary"}`}
                                                >
                                                    {isZh ? "按名称" : "By name"}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                        {/* Breadcrumb — fixed above scroll area (detail page only, not publish form) */}
                        {skillSlugFromUrl && skillDetail && !skillUploadOpen && (
                            <div className="shrink-0 px-6 pt-2">
                                <div className="flex items-center gap-1.5 text-sm text-secondary">
                                    <button
                                        type="button"
                                        onClick={closeSkillDetail}
                                        className="flex items-center gap-1 transition-colors hover:text-primary"
                                    >
                                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                                        {t("skillSquare.title")}
                                    </button>
                                    <span className="text-secondary/50">/</span>
                                    <span className="font-semibold text-primary truncate">{skillDetail.name}</span>
                                </div>
                            </div>
                        )}

                        {/* Content */}
                        <div className="min-w-0 flex-1 overflow-auto mr-8">
                            {/* ── Inline publish form ── */}
                            {ENABLE_HEPAI_SKILL_ZIP_UPLOAD && skillUploadOpen ? (
                                <div className="rounded-2xl border border-border-primary/20 bg-primary shadow-sm dark:border-white/8 dark:bg-white/[0.01]">
                                    {/* Top action bar */}
                                    <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-border-primary/20 bg-primary px-6 py-3.5 dark:border-white/8">
                                        <div className="flex items-center gap-3">
                                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/12 text-accent dark:bg-accent/16">
                                                <Upload className="h-4 w-4" aria-hidden />
                                            </span>
                                            <div>
                                                <div className="text-sm font-semibold text-primary">
                                                    {editingSkillId ? t("skillSquare.editSkill") : t("skillSquare.publishSkillTitle")}
                                                </div>

                                            </div>
                                        </div>
                                        </div>
                                    {/* Form body */}
                                    <div className="space-y-4 px-6 py-5">

                                        {/* ── Skill file ── */}
                                        <div>
                                            <div className="mb-1.5 text-sm font-medium text-primary">
                                                {t("skillSquare.skillFile")}{editingSkillId ? null : <span className="text-red-500"> *</span>}
                                                {editingSkillId ? <span className="ml-1 text-xs font-normal text-secondary">{t("skillSquare.optionalKeepZip")}</span> : null}
                                            </div>
                                            <input
                                                ref={setFolderInputRef}
                                                type="file"
                                                multiple
                                                className="sr-only"
                                                aria-hidden
                                                tabIndex={-1}
                                                onChange={handleFolderInputChange}
                                            />
                                            <input
                                                ref={hepaiZipInputRef}
                                                type="file"
                                                accept=".zip,application/zip"
                                                className="sr-only"
                                                aria-hidden
                                                tabIndex={-1}
                                                onChange={(e) => {
                                                    const f = e.target.files?.[0] ?? null;
                                                    syncPickFromFile(f);
                                                    e.target.value = "";
                                                }}
                                            />
                                            <div
                                                className={[
                                                    "flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border-2 px-4 py-6 transition-[border-color,background-color,box-shadow]",
                                                    hepaiPickPreview
                                                        ? "border-accent/35 bg-accent/[0.06] shadow-sm ring-1 ring-accent/10 dark:border-accent/30 dark:bg-accent/[0.08] dark:ring-accent/15"
                                                        : "border-dashed border-border-primary/70 bg-tertiary/20 dark:border-white/12 dark:bg-white/[0.02]",
                                                ].join(" ")}
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    const f = e.dataTransfer.files?.[0];
                                                    if (f?.name?.toLowerCase().endsWith(".zip")) {
                                                        syncPickFromFile(f);
                                                    } else {
                                                        message.warning(t("skillSquare.dropZipHint"));
                                                    }
                                                }}
                                            >
                                                {hepaiPickPreview ? (
                                                    <>
                                                        <Package
                                                            className="h-9 w-9 text-accent/90"
                                                            strokeWidth={1.75}
                                                            aria-hidden
                                                        />
                                                        <span className="max-w-full truncate px-1 text-center text-sm font-semibold text-primary">
                                                            {hepaiPickPreview.name}
                                                        </span>
                                                        <span className="text-xs tabular-nums text-secondary">
                                                            {formatBytes(hepaiPickPreview.size)}
                                                        </span>
                                                        <span className="text-center text-xs leading-relaxed text-secondary">
                                                            {t("skillSquare.replaceHint")}
                                                        </span>
                                                    </>
                                                ) : editingSkillId ? (
                                                    <>
                                                        <span className="max-w-md text-center text-xs leading-relaxed text-secondary">
                                                            {t("skillSquare.keepZipHint")}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="max-w-md text-center text-xs leading-relaxed text-secondary">
                                                            {t("skillSquare.dropHintLong", MAX_SKILL_FOLDER_FILES)}
                                                        </span>
                                                    </>
                                                )}
                                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                                    <AntdButton
                                                        type="default"
                                                        loading={hepaiPackingFolder}
                                                        disabled={skillUploading}
                                                        icon={<FolderOpen className="h-4 w-4" aria-hidden />}
                                                        className="rounded-xl"
                                                        onClick={() => hepaiFolderInputRef.current?.click()}
                                                    >
                                                        {t("skillSquare.selectFolder")}
                                                    </AntdButton>
                                                    <AntdButton
                                                        type="default"
                                                        disabled={hepaiPackingFolder || skillUploading}
                                                        icon={<Package className="h-4 w-4" aria-hidden />}
                                                        className="rounded-xl"
                                                        onClick={() => hepaiZipInputRef.current?.click()}
                                                    >
                                                        {editingSkillId ? t("skillSquare.replaceZip") : t("skillSquare.selectZip")}
                                                    </AntdButton>
                                                </div>
                                            </div>
                                        </div>

                                        {/* ── Two-column fields ── */}
                                        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
                                            {/* Left column */}
                                            <div className="space-y-4">

                                                {/* ── Display Name ── */}
                                                <div>
                                                    <div className="mb-1.5 text-sm font-medium text-primary">
                                                        {t("skillSquare.displayName")} <span className="text-red-500">*</span>
                                                    </div>
                                                    <Input
                                                        placeholder={t("skillSquare.displayNamePlaceholder")}
                                                        value={publishDisplayName}
                                                        onChange={(e) => setPublishDisplayName(e.target.value)}
                                                        className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                                                    />
                                                </div>

                                                {/* ── Slug ── */}
                                                <div>
                                                    <div className="mb-1.5 text-sm font-medium text-primary">{t("skillSquare.slugLabel")}</div>
                                                    <Input
                                                        placeholder={t("skillSquare.slugPlaceholder")}
                                                        value={publishSlug}
                                                        onChange={(e) => setPublishSlug(e.target.value)}
                                                        className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                                                    />
                                                    <p className="mt-1 text-xs text-secondary/70">
                                                        {t("skillSquare.slugHint")}
                                                    </p>
                                                </div>

                                                {/* ── Version ── */}
                                                <div>
                                                    <div className="mb-1.5 text-sm font-medium text-primary">
                                                        {t("skillSquare.versionLabel")} <span className="text-red-500">*</span>
                                                    </div>
                                                    <Input
                                                        placeholder={t("skillSquare.versionPlaceholder")}
                                                        value={publishVersion}
                                                        onChange={(e) => setPublishVersion(e.target.value)}
                                                        className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                                                    />
                                                </div>

                                                {/* ── 公开/私有切换 (仅新建时) ── */}
                                                {!editingSkillId && (
                                                    <div className="flex items-center gap-3">
                                                        <div className="text-sm font-medium text-primary">
                                                            {t("skillSquare.publishPublic")}
                                                        </div>
                                                        <Switch
                                                            checked={!isPublicSkill}
                                                            onChange={(v) => setIsPublicSkill(!v)}
                                                            size="small"
                                                        />
                                                        <div className="text-sm font-medium text-primary">
                                                            {t("skillSquare.publishPrivate")}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* ── Changelog ── */}
                                                <div>
                                                    <div className="mb-1.5 text-sm font-medium text-primary">{t("skillSquare.changelogLabel")}</div>
                                                    <Input.TextArea
                                                        rows={2}
                                                        placeholder={t("skillSquare.changelogPlaceholder")}
                                                        value={publishChangelog}
                                                        onChange={(e) => setPublishChangelog(e.target.value)}
                                                        className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                                                    />
                                                </div>

                                            </div>
                                            {/* Right column */}
                                            <div className="space-y-4">

                                                {/* ── Cover (compact, right column top) — shown when icon is set to custom ── */}
                                                {publishIcon === "__profile__" && (
                                                    <div>
                                                        <div className="mb-1.5 text-sm font-medium text-primary">{t("skillSquare.profileLabel")}</div>
                                                        <input
                                                            ref={publicProfileInputRef}
                                                            type="file"
                                                            accept=".png,.jpg,.jpeg,.gif,.webp,.svg"
                                                            className="sr-only"
                                                            aria-hidden
                                                            tabIndex={-1}
                                                            onChange={(e) => {
                                                                const f = e.target.files?.[0] ?? null;
                                                                if (f) {
                                                                    if (f.size > 2 * 1024 * 1024) {
                                                                        message.warning(t("skillSquare.profileTooLarge"));
                                                                        e.target.value = "";
                                                                        return;
                                                                    }
                                                                    setPublicProfileFile(f);
                                                                    const reader = new FileReader();
                                                                    reader.onloadend = () => setPublicProfilePreview(reader.result as string);
                                                                    reader.readAsDataURL(f);
                                                                } else {
                                                                    setPublicProfileFile(null);
                                                                    setPublicProfilePreview(null);
                                                                }
                                                                e.target.value = "";
                                                            }}
                                                        />
                                                        <div
                                                            className={[
                                                                "group relative flex aspect-square w-full max-w-[200px] cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border-2 transition-all duration-200",
                                                                publicProfilePreview
                                                                    ? "border-accent/30 bg-accent/[0.04] shadow-sm"
                                                                    : "border-dashed border-border-primary/60 bg-tertiary/20 hover:border-accent/35 hover:bg-tertiary/30 dark:border-white/12 dark:bg-white/[0.02] dark:hover:border-accent/30",
                                                            ].join(" ")}
                                                            onClick={() => publicProfileInputRef.current?.click()}
                                                            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                            onDrop={(e) => {
                                                                e.preventDefault();
                                                                const f = e.dataTransfer.files?.[0];
                                                                if (f) {
                                                                    const ext = f.name.split(".").pop()?.toLowerCase();
                                                                    if (ext && ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
                                                                        if (f.size > 2 * 1024 * 1024) {
                                                                            message.warning(t("skillSquare.profileTooLarge"));
                                                                            return;
                                                                        }
                                                                        setPublicProfileFile(f);
                                                                        const reader = new FileReader();
                                                                        reader.onloadend = () => setPublicProfilePreview(reader.result as string);
                                                                        reader.readAsDataURL(f);
                                                                    } else {
                                                                        message.warning(t("skillSquare.profileWrongType"));
                                                                    }
                                                                }
                                                            }}
                                                        >
                                                            {publicProfilePreview ? (
                                                                <>
                                                                    <img src={publicProfilePreview} alt="Cover" className="absolute inset-0 h-full w-full object-cover" />
                                                                    <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/30" />
                                                                    <div className="relative z-10 flex flex-col items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                                                        <span className="rounded-lg bg-black/50 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">{t("skillSquare.changeCover")}</span>
                                                                    </div>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Image className="h-6 w-6 text-secondary/50 transition-colors group-hover:text-accent/60" strokeWidth={1.5} aria-hidden />
                                                                    <span className="text-[11px] leading-tight text-secondary/60">{t("skillSquare.selectCover")}</span>
                                                                </>
                                                            )}
                                                        </div>
                                                        {publicProfilePreview && (
                                                            <button
                                                                type="button"
                                                                className="mt-1.5 text-xs text-accent transition-colors hover:text-accent/80"
                                                                onClick={() => { setPublicProfileFile(null); setPublicProfilePreview(null); }}
                                                            >
                                                                {t("skillSquare.removeImage")}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}

                                                {/* ── Icon ── */}
                                                <div>
                                                    <div className="mb-1.5 text-sm font-medium text-primary">{t("skillSquare.iconLabel")}</div>
                                                    <Select
                                                        allowClear
                                                        placeholder={t("skillSquare.iconPlaceholder")}
                                                        value={publishIcon || undefined}
                                                        onChange={(v) => setPublishIcon(typeof v === "string" ? v : "")}
                                                        className="w-full [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-tertiary/40 [&_.ant-select-selector]:bg-background/55 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]"
                                                        options={[
                                                            ...SKILL_ICON_OPTIONS.map((o) => ({
                                                                value: o.value,
                                                                label: (
                                                                    <span className="flex items-center gap-2">
                                                                        <o.Icon className="h-4 w-4 shrink-0" aria-hidden />
                                                                        {t(ICON_LABEL_KEY_MAP[o.value])}
                                                                    </span>
                                                                ),
                                                            })),
                                                            {
                                                                value: "__profile__",
                                                                label: (
                                                                    <span className="flex items-center gap-2">
                                                                        <Image className="h-4 w-4 shrink-0" aria-hidden />
                                                                        {t("skillSquare.customIcon")}
                                                                    </span>
                                                                ),
                                                            },
                                                        ]}
                                                    />
                                                </div>

                                                {/* ── Category ── */}
                                                <div>
                                                    <div className="mb-1.5 text-sm font-medium text-primary">{t("skillSquare.categoryLabel") || "分类"}</div>
                                                    <Select
                                                        mode="multiple"
                                                        allowClear
                                                        maxTagCount="responsive"
                                                        placeholder={t("skillSquare.categoryPlaceholder") || "选择分类"}
                                                        value={publishCategory.length > 0 ? publishCategory : undefined}
                                                        onChange={(v) => setPublishCategory(Array.isArray(v) ? v : [])}
                                                        className="w-full [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-tertiary/40 [&_.ant-select-selector]:bg-background/55 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]"
                                                        options={SKILL_CATEGORIES.map((c) => ({ value: c, label: c }))}
                                                    />
                                                </div>

                                            </div>
                                        </div>

                                        <div className="mt-4 flex items-center gap-3">
                                            <AntdButton
                                                type="primary"
                                                loading={skillUploading}
                                                disabled={skillUploading}
                                                onClick={() => void handlePublishSkill()}
                                            >
                                                {t("skillSquare.publishBtn")}
                                            </AntdButton>
                                            <AntdButton
                                                disabled={skillUploading}
                                                onClick={() => { resetPublishForm(); setSkillUploadOpen(false); }}
                                            >
                                                {t("skillSquare.backBtn")}
                                            </AntdButton>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <>

                                    {/* ── Detail panel (independent of tab) ── */}
                                    {skillSlugFromUrl ? (
                                        detailPanelProps ? (
                                            <SkillDetailPanel {...detailPanelProps} />
                                        ) : skillDetailLoading ? (
                                            <div className="flex items-center justify-center py-20">
                                                <Spin />
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                                                <p className="text-sm text-secondary">{t("skillSquare.notFound")}</p>
                                                <AntdButton onClick={closeSkillDetail}>{t("skillSquare.backBtn")}</AntdButton>
                                            </div>
                                        )
                                    ) : activeTab === "private" ? (
                                        <>
                                            {/* ── Private skills list ── */}
                                            {hepaiRows.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary/70 bg-tertiary/15 px-6 py-20 text-center dark:border-white/12 dark:bg-white/[0.02]">
                                                    <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border-primary/50 bg-primary shadow-sm dark:border-white/10">
                                                        <Package className="h-8 w-8 text-accent" strokeWidth={1.75} aria-hidden />
                                                    </div>
                                                    <p className="text-base font-medium text-primary">{t("skillSquare.emptyTitle")}</p>
                                                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-secondary">
                                                        {t("skillSquare.emptyDesc")}
                                                    </p>
                                                    {ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? (
                                                        <Button
                                                            variant="primary"
                                                            size="sm"
                                                            icon={<Upload className="h-4 w-4" aria-hidden />}
                                                            className="mt-6"
                                                            onClick={() => openSkillPublishModal(undefined, false)}
                                                        >
                                                            {t("skillSquare.publishFirst")}
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            ) : filteredHepaiRows.length === 0 ? (
                                                <div className="flex items-center justify-center rounded-2xl border border-dashed border-border-primary/40 bg-tertiary/10 px-6 py-12 text-center dark:border-white/10 dark:bg-white/[0.02]">
                                                    <p className="text-sm text-secondary">{t("skillSquare.empty")}</p>
                                                </div>
                                            ) : (
                                                <ul className="flex flex-col divide-y divide-border-primary/20 dark:divide-white/[0.06]">
                                                    {filteredHepaiRows.map((r) => {
                                                        const createdMs = r.created_at ? new Date(r.created_at).getTime() : Date.now();
                                                        const absTime = new Date(createdMs).toLocaleString();
                                                        const uploader = r.owner?.trim() || user?.email?.trim() || "";
                                                        const isUnlisted = r.unlisted === true;
                                                        return (
                                                            <SkillListItem
                                                                key={r.slug}
                                                                slug={r.slug}
                                                                name={r.name || r.slug}
                                                                icon={r.icon}
                                                                version={r.version}
                                                                description={r.description}
                                                                profile={r.profile}
                                                                badges={
                                                                    isUnlisted ? (
                                                                        <span className="inline-flex shrink-0 items-center rounded-full border border-secondary/30 bg-secondary/10 px-2 py-0.5 text-[10px] font-medium text-secondary dark:border-white/10 dark:bg-white/[0.05]">
                                                                            {t("skillSquare.unlistedBadge")}
                                                                        </span>
                                                                    ) : null
                                                                }
                                                                // meta={
                                                                //     <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-secondary">
                                                                //         {uploader ? (
                                                                //             <span
                                                                //                 className="max-w-[12rem] truncate rounded-md bg-tertiary/30 px-1.5 py-0.5 dark:bg-white/[0.05]"
                                                                //                 title={uploader}
                                                                //             >
                                                                //                 {uploader}
                                                                //             </span>
                                                                //         ) : null}
                                                                //         <span
                                                                //             className="tabular-nums text-secondary/85"
                                                                //             title={absTime}
                                                                //         >
                                                                //             {formatRelativePast(createdMs)}
                                                                //         </span>
                                                                //     </p>
                                                                // }
                                                                onClick={openSkillDetail}
                                                                renderSkillIcon={renderSkillIcon}
                                                            />
                                                        );
                                                    })}
                                                </ul>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            {/* ── Public skills list ── */}
                                            {publicLoading ? (
                                                <div className="flex items-center justify-center py-20">
                                                    <Spin />
                                                </div>
                                            ) : publicRows.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary/70 bg-tertiary/15 px-6 py-20 text-center dark:border-white/12 dark:bg-white/[0.02]">
                                                    <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border-primary/50 bg-primary shadow-sm dark:border-white/10">
                                                        <Package className="h-8 w-8 text-accent" strokeWidth={1.75} aria-hidden />
                                                    </div>
                                                    <p className="text-base font-medium text-primary">{t("skillSquare.noPublicTitle")}</p>
                                                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-secondary">
                                                        {t("skillSquare.noPublicDesc")}
                                                    </p>
                                                </div>
                                            ) : filteredPublicRows.length === 0 ? (
                                                <div className="flex items-center justify-center rounded-2xl border border-dashed border-border-primary/40 bg-tertiary/10 px-6 py-12 text-center dark:border-white/10 dark:bg-white/[0.02]">
                                                    <p className="text-sm text-secondary">{t("skillSquare.empty")}</p>
                                                </div>
                                            ) : (
                                                <ul className="flex flex-col divide-y divide-border-primary/20 dark:divide-white/[0.06]">
                                                    {filteredPublicRows.map((r) => (
                                                        <SkillListItem
                                                            key={r.slug}
                                                            slug={r.slug}
                                                            name={r.name}
                                                            icon={r.icon}
                                                            version={r.version}
                                                            description={r.description}
                                                            profile={r.profile}
                                                            onClick={openSkillDetail}
                                                            renderSkillIcon={renderSkillIcon}
                                                        />
                                                    ))}
                                                </ul>
                                            )}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <Drawer
                title={
                    active ? (
                        <div>
                            <div className="text-base font-semibold">{active.name}</div>
                            <div className="text-xs font-normal text-secondary mt-1">
                                <code>{active.slug}</code>
                            </div>
                        </div>
                    ) : (
                        "技能详情"
                    )
                }
                placement="right"
                width={520}
                open={drawerOpen}
                onClose={() => {
                    setDrawerOpen(false);
                    setActive(null);
                    setDetailBody(null);
                }}
                destroyOnClose
            >
                {active && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-sm text-secondary flex-1">{active.description}</p>
                            {ENABLE_SKILL_DOWNLOAD ? (
                                <Button
                                    variant="secondary"
                                    className="shrink-0 h-8 border-1!"
                                    onClick={() => void handleDownload(active.slug)}
                                    disabled={downloadSlug === active.slug}
                                    isLoading={downloadSlug === active.slug}
                                >
                                    <Download className="w-4 h-4 mr-1 inline" />
                                    {t("skillSquare.downloadBtn")}
                                </Button>
                            ) : null}
                        </div>
                        {detailLoading ? (
                            <div className="flex justify-center py-12">
                                <Spin />
                            </div>
                        ) : detailBody ? (
                            <div className="prose prose-invert prose-sm max-w-none">
                                <MarkdownRenderer content={detailBody} />
                            </div>
                        ) : null}
                    </div>
                )}
            </Drawer>



            <Modal
                title={
                    <div className="flex items-start gap-3 pr-8">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent transition-colors dark:bg-accent/[0.16]">
                            <FileText className="h-5 w-5" strokeWidth={2} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="font-agent text-base font-semibold leading-tight text-primary">
                                SKILL.md 预览
                            </div>
                            {skillMdTitle ? (
                                <div
                                    className="mt-1 truncate text-sm font-medium leading-snug text-secondary"
                                    title={skillMdTitle}
                                >
                                    {(() => {
                                        const { stem, ext } = splitArchiveName(skillMdTitle);
                                        return (
                                            <>
                                                <span>{stem}</span>
                                                {ext ? (
                                                    <span className="font-agent-mono text-[13px] font-normal text-secondary/70">
                                                        {ext}
                                                    </span>
                                                ) : null}
                                            </>
                                        );
                                    })()}
                                </div>
                            ) : (
                                <div className="mt-0.5 text-xs font-normal text-secondary">技能包文档</div>
                            )}
                        </div>
                    </div>
                }
                open={skillMdOpen}
                onCancel={() => {
                    setSkillMdOpen(false);
                    setSkillMdBody("");
                }}
                footer={null}
                destroyOnClose
                width={840}
                styles={{
                    content: { borderRadius: 16, overflow: "hidden", padding: 0 },
                    header: {
                        marginBottom: 0,
                        padding: "16px 20px 12px",
                        borderBottom: "1px solid color-mix(in oklab, var(--color-border-secondary, #e2e8f0) 65%, transparent)",
                    },
                    body: { padding: "0 20px 20px", paddingTop: 14 },
                }}
                className="[&_.ant-modal-content]:bg-background [&_.ant-modal-header]:bg-background [&_.ant-modal-header]:border-b-border-secondary/60 dark:[&_.ant-modal-header]:border-white/[0.08]"
            >
                {skillMdLoading ? (
                    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-tertiary/45 bg-tertiary/[0.06] px-6 py-14 dark:border-white/[0.1] dark:bg-white/[0.02]">
                        <Spin />
                        <p className="text-sm text-secondary">正在加载 SKILL.md…</p>
                    </div>
                ) : skillMdBody ? (
                    <div className="flex flex-col gap-3">

                        <div
                            className={[
                                "relative scroll max-h-[min(70vh,640px)] overflow-auto rounded-2xl border border-tertiary/50",
                                "bg-gradient-to-b from-background via-background to-tertiary/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                                "dark:border-white/[0.08] dark:from-background dark:via-background dark:to-white/[0.02]",
                            ].join(" ")}
                        >
                            <button
                                type="button"
                                className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-tertiary/45 bg-background/85 text-secondary shadow-sm backdrop-blur-sm transition-colors hover:border-accent/35 hover:bg-accent/10 hover:text-accent dark:border-white/[0.1] dark:bg-background/75 dark:hover:border-accent/40"
                                aria-label="复制全文"
                                onClick={() => void copySkillMdFullText()}
                            >
                                <Copy className="h-3.5 w-3.5" aria-hidden />
                            </button>

                            <article className="px-5 pb-6 pt-6 sm:px-8 sm:pb-8 sm:pt-8">
                                <MarkdownRenderer content={skillMdBody} />
                            </article>
                        </div>
                    </div>
                ) : (
                    <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-tertiary/50 bg-tertiary/[0.06] px-6 py-10 text-center dark:border-white/[0.1] dark:bg-white/[0.02]">
                        <FileText className="h-10 w-10 text-secondary/70" strokeWidth={1.5} aria-hidden />
                        <p className="text-sm font-medium text-primary">{t("skillSquare.noPreviewContent")}</p>
                        <p className="max-w-sm text-xs leading-relaxed text-secondary">
                            {t("skillSquare.noPreviewDesc")}
                        </p>
                    </div>
                )}
            </Modal>

            {/* ── Share Skill modal ── */}
            {shareSkillSlug && (
                <ShareSkillModal
                    open={shareSkillSlug !== null}
                    skillSlug={shareSkillSlug}
                    skillName={shareSkillName}
                    userId={user?.email || ""}
                    baseUrl={typeof window !== "undefined" ? window.location.origin : ""}
                    t={t}
                    onClose={() => setShareSkillSlug(null)}
                    onCreateShare={handleCreateShare}
                    onRevokeShare={handleRevokeShare}
                    onListShares={handleListShares}
                />
            )}
        </div>
    );
};

export default SkillsSquarePage;
