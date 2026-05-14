import { Drawer, Input, Modal, Spin, message, Select, Button as AntdButton } from "antd";
import {
    Bot,
    Check,
    Code,
    Copy,
    Download,
    Eye,
    FileText,
    FolderOpen,
    Package,
    Search,
    Send,
    Sparkles,
    Upload,
    Wrench,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/common/Button";
import MarkdownRenderer from "../components/common/markdownrender";
import { useSettingsStore } from "../components/store";
import { fileAPI, skillsAPI, type SkillsCatalogItem } from "../components/views/api";
import { appContext } from "../hooks/provider";
import JSZip from "jszip";

const ENABLE_SKILL_DOWNLOAD = false;
const ENABLE_HEPAI_SKILL_ZIP_UPLOAD = true;

const LIST_ROW_ACTION_BTN =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-tertiary/40 text-secondary transition-colors duration-200 hover:bg-accent/15 hover:text-accent dark:bg-white/[0.06]";

const HEPAI_MAX_ZIP_BYTES = 10 * 1024 * 1024;
/** 与提示文案一致：文件夹打包内文件数上限 */
const MAX_SKILL_FOLDER_FILES = 200;

type FileWithRelativePath = File & { webkitRelativePath?: string };

async function zipFolderFileListToZipFile(files: FileList): Promise<File> {
    const zip = new JSZip();
    const n = files.length;
    if (n === 0) throw new Error("未选择任何文件");
    if (n > MAX_SKILL_FOLDER_FILES) {
        throw new Error(`文件夹内文件请不超过 ${MAX_SKILL_FOLDER_FILES} 个`);
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
        throw new Error("文件夹内需包含 SKILL.md");
    }
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    if (blob.size > HEPAI_MAX_ZIP_BYTES) {
        throw new Error("打包后超过 10 MB，请精简文件后重试");
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
        { value: "package", label: "包裹", Icon: Package },
        { value: "wrench", label: "扳手", Icon: Wrench },
        { value: "code", label: "代码", Icon: Code },
        { value: "sparkles", label: "创意", Icon: Sparkles },
        { value: "bot", label: "智能体", Icon: Bot },
        { value: "file-text", label: "文档", Icon: FileText },
    ];

type HepAIUploadRow = {
    id: string;
    filename: string;
    previewUrl: string;
    createdAtMs: number;
    description?: string;
    /** 上传者标识（与接口 user_id 一致，一般为邮箱）；旧数据可能为空 */
    uploadedBy?: string;
    metadata?: Record<string, unknown>;
};

function rowPrimaryTitle(row: HepAIUploadRow): string {
    const raw = row.metadata?.display_name;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    return splitArchiveName(row.filename).stem;
}

function rowListIconComponent(row: HepAIUploadRow) {
    const key = typeof row.metadata?.icon === "string" ? row.metadata.icon.trim() : "";
    const hit = SKILL_ICON_OPTIONS.find((o) => o.value === key);
    return hit?.Icon ?? Package;
}

/** SKILL.md YAML frontmatter `description:` (aligned with backend parsing). */
function parseSkillMdDescription(content: string): string | undefined {
    const m = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (!m) return undefined;
    const fm = m[1];
    for (const line of fm.split("\n")) {
        const idx = line.indexOf(":");
        if (idx < 0) continue;
        const key = line.slice(0, idx).trim();
        if (key !== "description") continue;
        const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
        return value || undefined;
    }
    return undefined;
}

function metadataDescription(row: HepAIUploadRow): string {
    const raw = row.metadata?.description;
    return typeof raw === "string" ? raw.trim() : "";
}

function displayDescription(row: HepAIUploadRow, skillMdParsed?: string): string {
    const fromMeta = metadataDescription(row);
    if (fromMeta) return fromMeta;
    const persisted = (row.description ?? "").trim();
    if (persisted) return persisted;
    return (skillMdParsed ?? "").trim();
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
    if (sec < 15) return "刚刚";
    if (sec < 60) return `${sec} 秒前`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} 天前`;
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
    const [search, setSearch] = useState("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [active, setActive] = useState<SkillsCatalogItem | null>(null);
    const [detailBody, setDetailBody] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [downloadSlug, setDownloadSlug] = useState<string | null>(null);
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
    const [hepaiUploadOpen, setHepaiUploadOpen] = useState(false);
    const [hepaiUploading, setHepaiUploading] = useState(false);
    const [hepaiPackingFolder, setHepaiPackingFolder] = useState(false);
    const [hepaiZipFile, setHepaiZipFile] = useState<File | null>(null);
    const [publishSlug, setPublishSlug] = useState("");
    const [publishDisplayName, setPublishDisplayName] = useState("");
    const [publishIcon, setPublishIcon] = useState<string>("");
    const [publishDescription, setPublishDescription] = useState("");
    const [publishVersion, setPublishVersion] = useState("1.0.0");
    const [publishChangelog, setPublishChangelog] = useState("");
    const [hepaiRows, setHepaiRows] = useState<HepAIUploadRow[]>([]);
    const [skillMdOpen, setSkillMdOpen] = useState(false);
    const [skillMdLoading, setSkillMdLoading] = useState(false);
    const [skillMdTitle, setSkillMdTitle] = useState<string>("");
    const [skillMdBody, setSkillMdBody] = useState<string>("");
    const [skillMdDescById, setSkillMdDescById] = useState<Record<string, string>>({});
    const skillDescFetchedRef = useRef<Set<string>>(new Set());
    const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [copiedRowId, setCopiedRowId] = useState<string | null>(null);
    const { config: _config } = useSettingsStore();

    const hepaiPickPreview = useMemo(
        () => (hepaiZipFile ? { name: hepaiZipFile.name, size: hepaiZipFile.size } : null),
        [hepaiZipFile]
    );

    const filteredHepaiRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return hepaiRows;
        return hepaiRows.filter((r) => {
            const desc = displayDescription(r, skillMdDescById[r.id]).toLowerCase();
            const by = (r.uploadedBy ?? "").toLowerCase();
            const title = rowPrimaryTitle(r).toLowerCase();
            return (
                r.filename.toLowerCase().includes(q) ||
                title.includes(q) ||
                desc.includes(q) ||
                (by.length > 0 && by.includes(q))
            );
        });
    }, [hepaiRows, search, skillMdDescById]);

    const resetPublishForm = () => {
        setHepaiZipFile(null);
        setPublishSlug("");
        setPublishDisplayName("");
        setPublishIcon("");
        setPublishDescription("");
        setPublishVersion("1.0.0");
        setPublishChangelog("");
        if (hepaiZipInputRef.current) {
            hepaiZipInputRef.current.value = "";
        }
        if (hepaiFolderInputRef.current) {
            hepaiFolderInputRef.current.value = "";
        }
    };

    const syncPickFromFile = (f: File | null) => {
        if (f && f.size > HEPAI_MAX_ZIP_BYTES) {
            message.warning("压缩包总大小请不超过 10 MB");
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
            message.error("未能按文件夹读取文件，请使用 Chrome / Edge 等浏览器，或直接「选择 zip 文件」");
            e.target.value = "";
            return;
        }
        setHepaiPackingFolder(true);
        try {
            const zipFile = await zipFolderFileListToZipFile(list);
            syncPickFromFile(zipFile);
            message.success("已将文件夹打包为 zip");
        } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
        } finally {
            setHepaiPackingFolder(false);
            e.target.value = "";
        }
    };

    useEffect(() => {
        const userId = user?.email || "";
        if (!userId) return;
        let cancelled = false;
        (async () => {
            try {
                const rows = await fileAPI.listHepaiFiles(userId);
                if (cancelled) return;
                setHepaiRows(
                    rows.map((r) => ({
                        id: r.id,
                        filename: r.filename,
                        previewUrl: r.url,
                        createdAtMs: r.createdAtMs,
                        description: r.description,
                        uploadedBy: r.uploadedBy,
                        metadata: r.metadata,
                    }))
                );
            } catch {
                // keep UI quiet; list is best-effort
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user?.email]);

    useEffect(() => {
        const userId = user?.email || "";
        if (!userId || hepaiRows.length === 0) return;
        for (const r of hepaiRows) {
            if (metadataDescription(r) || (r.description ?? "").trim()) continue;
            if (skillDescFetchedRef.current.has(r.id)) continue;
            skillDescFetchedRef.current.add(r.id);
            void fileAPI
                .getHepaiZipSkillMd(userId, r.id)
                .then(({ content }) => {
                    const d = parseSkillMdDescription(content)?.trim();
                    if (d) setSkillMdDescById((prev) => ({ ...prev, [r.id]: d }));
                })
                .catch(() => { });
        }
    }, [user?.email, hepaiRows]);

    useEffect(() => {
        return () => {
            if (copyFeedbackTimerRef.current) {
                clearTimeout(copyFeedbackTimerRef.current);
                copyFeedbackTimerRef.current = null;
            }
        };
    }, []);

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
            message.error("复制失败");
        }
    };

    const copySkillMdFullText = async () => {
        if (!skillMdBody) return;
        try {
            await navigator.clipboard.writeText(skillMdBody);
            message.success("已复制全文");
        } catch {
            message.error("复制失败");
        }
    };


    const handleDownload = async (slug: string) => {
        setDownloadSlug(slug);
        try {
            await skillsAPI.downloadCatalogArchive(slug);
            message.success("已开始下载");
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setDownloadSlug(null);
        }
    };
    const submitHepaiUpload = async () => {
        const file = hepaiZipFile;
        if (!file) {
            message.warning("请选择技能包 .zip 文件");
            return;
        }
        if (!file.name.toLowerCase().endsWith(".zip")) {
            message.warning("请上传 .zip 格式的技能包");
            return;
        }
        if (file.size > HEPAI_MAX_ZIP_BYTES) {
            message.warning("压缩包总大小请不超过 10 MB");
            return;
        }
        const dn = publishDisplayName.trim();
        if (!dn) {
            message.warning("请填写显示名称");
            return;
        }
        const slugTrim = publishSlug.trim();
        if (slugTrim && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugTrim.toLowerCase())) {
            message.warning("Slug 仅允许小写字母、数字和连字符；不需要可留空");
            return;
        }

        const userId = user?.email || "";
        if (!userId) {
            message.error("未登录或缺少 user_id（email）");
            return;
        }

        setHepaiUploading(true);
        try {
            await fileAPI.uploadToHepAI(userId, file, {
                slug: slugTrim || undefined,
                display_name: dn,
                icon: publishIcon.trim() || undefined,
                description: publishDescription.trim() || undefined,
                version: publishVersion.trim() || "1.0.0",
                changelog: publishChangelog.trim() || undefined,
            });
            const rows = await fileAPI.listHepaiFiles(userId);
            setHepaiRows(
                rows.map((r) => ({
                    id: r.id,
                    filename: r.filename,
                    previewUrl: r.url,
                    createdAtMs: r.createdAtMs,
                    description: r.description,
                    uploadedBy: r.uploadedBy,
                    metadata: r.metadata,
                }))
            );
            message.success("发布成功");
            setHepaiUploadOpen(false);
            resetPublishForm();
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setHepaiUploading(false);
        }
    };

    const openSkillMdPreview = async (fileId: string, filename: string) => {
        const userId = user?.email || "";
        if (!userId) {
            message.error("未登录或缺少 user_id（email）");
            return;
        }
        setSkillMdTitle(filename);
        setSkillMdBody("");
        setSkillMdOpen(true);
        setSkillMdLoading(true);
        try {
            const { content } = await fileAPI.getHepaiZipSkillMd(userId, fileId);
            setSkillMdBody(content);
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
            setSkillMdOpen(false);
        } finally {
            setSkillMdLoading(false);
        }
    };

    return (
        <div className="relative flex h-full min-h-0 flex-col bg-background">
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                <div className="absolute -top-28 left-[15%] h-64 w-64 rounded-full bg-accent/[0.1] blur-3xl dark:bg-accent/[0.16]" />
                <div className="absolute top-16 right-[-6%] h-72 w-72 rounded-full bg-blue-700/[0.09] blur-3xl dark:bg-blue-700/[0.14]" />
                <div
                    className="absolute inset-0 opacity-[0.4] dark:opacity-[0.24]"
                    style={{
                        backgroundImage: `linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px),
              linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)`,
                        backgroundSize: "40px 40px",
                    }}
                />
            </div>

            <div className="relative z-10 flex min-h-0 flex-1 flex-col">
                <div className="shrink-0 border-b border-tertiary/40 px-4 pb-4 pt-5 dark:border-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0))] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_14px_36px_rgba(0,0,0,0.4)]">
                    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 animate-slide-up">
                            <h1 className="font-agent flex items-center gap-2.5 text-lg font-medium tracking-normal text-slate-600 sm:text-xl dark:text-slate-200">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tertiary/40 text-accent dark:bg-white/[0.06]">
                                    <Wrench className="h-[18px] w-[18px]" aria-hidden />
                                </span>
                                <span className="leading-snug font-medium tracking-wide">SKILLS</span>
                            </h1>
                        </div>
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end animate-slide-up [animation-delay:50ms] [animation-fill-mode:backwards]">
                            {ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? (
                                <span
                                    role="button"
                                    tabIndex={0}
                                    className={[
                                        "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-medium",
                                        "border border-accent/35 bg-accent/12 text-slate-700 dark:text-slate-200",
                                        "transition-[background-color,border-color,transform] duration-200 ease-out",
                                        "hover:border-accent/50 hover:bg-accent/18",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                        "active:scale-[0.98]",
                                    ].join(" ")}
                                    onClick={() => {
                                        resetPublishForm();
                                        setHepaiUploadOpen(true);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            resetPublishForm();
                                            setHepaiUploadOpen(true);
                                        }
                                    }}
                                >
                                    <span className="text-base font-medium leading-none">+</span>
                                    发布 Skill
                                </span>
                            ) : null}

                            <Input
                                allowClear
                                prefix={<Search className="h-4 w-4 text-secondary" />}
                                placeholder="搜索名称或描述"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full sm:max-w-xs [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 [&_.ant-input]:py-1.5 [&_.ant-input]:text-slate-700 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04] dark:[&_.ant-input]:text-slate-200"
                            />
                        </div>
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto px-4 py-5">
                    <div className="mx-auto max-w-6xl">
                        {hepaiRows.length === 0 ? (
                            <div className="animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-tertiary/55 bg-tertiary/10 px-6 py-16 text-center dark:border-white/12 dark:bg-white/[0.03]">
                                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-tertiary/40 dark:bg-white/[0.06]">
                                    <Package className="h-7 w-7 text-accent" aria-hidden />
                                </div>
                                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">暂无技能包</p>
                                <p className="mt-1 text-xs text-secondary">发布 Skill 后即可出现在此列表</p>
                                {ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? (
                                    <button
                                        type="button"
                                        className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl border border-accent/40 bg-accent/14 px-4 text-sm font-medium text-slate-700 transition hover:border-accent/55 hover:bg-accent/22 dark:text-slate-200"
                                        onClick={() => {
                                            resetPublishForm();
                                            setHepaiUploadOpen(true);
                                        }}
                                    >
                                        <span className="text-base font-medium leading-none">+</span>
                                        发布 Skill
                                    </button>
                                ) : null}
                            </div>
                        ) : filteredHepaiRows.length === 0 ? (
                            <div className="animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-tertiary/50 bg-tertiary/10 px-6 py-12 dark:border-white/10 dark:bg-white/[0.03]">
                                <Search className="mb-2 h-9 w-9 text-secondary opacity-80" aria-hidden />
                                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">无匹配项</p>
                                <p className="mt-1 text-xs text-secondary">清空搜索或换关键词</p>
                            </div>
                        ) : (
                            <div className="overflow-hidden rounded-2xl border border-tertiary/50 bg-background/40 dark:border-white/[0.06] dark:bg-white/[0.02]">
                                <ul className="divide-y divide-tertiary/45 text-sm dark:divide-white/[0.08]">
                                    {filteredHepaiRows.map((r) => {
                                        const desc = displayDescription(r, skillMdDescById[r.id]);
                                        const RowIcon = rowListIconComponent(r);
                                        const primaryTitle = rowPrimaryTitle(r);
                                        const { ext } = splitArchiveName(r.filename);
                                        const absTime = new Date(r.createdAtMs).toLocaleString();
                                        const uploader =
                                            r.uploadedBy?.trim() || user?.email?.trim() || "";
                                        const copied = copiedRowId === r.id;
                                        return (
                                            <li key={r.id} className="px-4 py-3.5 sm:px-4 sm:py-4">
                                                <div className="flex items-center gap-3 sm:gap-4">
                                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/[0.12] text-accent dark:bg-accent/[0.16]">
                                                        <RowIcon className="h-[24px] w-[24px]" strokeWidth={2} aria-hidden />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div
                                                            className="truncate text-[15px] font-medium leading-snug text-slate-800 dark:text-slate-100"
                                                            title={`${primaryTitle}${ext}`}
                                                        >
                                                            <span>{primaryTitle}</span>
                                                            {ext ? (
                                                                <span className="font-mono text-sm font-normal text-slate-400 dark:text-slate-500">
                                                                    {ext}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        {desc ? (
                                                            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                                                                {desc}
                                                            </p>
                                                        ) : null}
                                                        <p className="mt-1.5 text-xs leading-relaxed text-secondary">
                                                            {uploader ? (
                                                                <>
                                                                    <span
                                                                        className="max-w-[14rem] truncate text-secondary/90"
                                                                        title={uploader}
                                                                    >
                                                                        {uploader}
                                                                    </span>
                                                                    <span className="text-secondary/50"> 发布</span>
                                                                </>
                                                            ) : (
                                                                <span className="text-secondary/75">发布</span>
                                                            )}
                                                            <span className="mx-1.5 text-secondary/40">·</span>
                                                            <span className="tabular-nums">{formatRelativePast(r.createdAtMs)}</span>
                                                            <span className="mx-1.5 text-secondary/40">·</span>
                                                            <span className="tabular-nums text-secondary/85">{absTime}</span>
                                                        </p>
                                                    </div>

                                                    <div className="flex shrink-0 items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            className={LIST_ROW_ACTION_BTN}
                                                            onClick={() => void openSkillMdPreview(r.id, r.filename)}
                                                            title="预览 SKILL.md"
                                                            aria-label="预览 SKILL.md"
                                                        >
                                                            <Eye className="h-4 w-4" aria-hidden />
                                                        </button>
                                                        <a
                                                            href={r.previewUrl}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className={LIST_ROW_ACTION_BTN}
                                                            title="下载"
                                                            aria-label="下载"
                                                        >
                                                            <Download className="h-4 w-4" aria-hidden />
                                                        </a>
                                                        <button
                                                            type="button"
                                                            className={LIST_ROW_ACTION_BTN}
                                                            onClick={() => void copyPreviewUrl(r.id, r.previewUrl)}
                                                            title={copied ? "已复制" : "复制链接"}
                                                            aria-label={copied ? "已复制" : "复制链接"}
                                                        >
                                                            {copied ? (
                                                                <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                                                            ) : (
                                                                <Copy className="h-4 w-4" aria-hidden />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}
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
                                    下载 ZIP
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
                    <div className="flex items-start gap-3 pr-6">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent dark:bg-accent/16">
                            <Upload className="h-5 w-5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="font-agent text-base font-semibold leading-tight text-slate-800 dark:text-slate-100">
                                发布新技能
                            </div>
                            <p className="mt-1.5 text-xs font-normal leading-relaxed text-secondary">
                                上传您的 Skill 文件，审核通过后将同步展示在 SkillHub 技能广场
                            </p>
                        </div>
                    </div>
                }
                open={ENABLE_HEPAI_SKILL_ZIP_UPLOAD && hepaiUploadOpen}
                onCancel={() => {
                    setHepaiUploadOpen(false);
                    resetPublishForm();
                }}
                footer={
                    <div className="flex justify-end gap-2">
                        <AntdButton
                            onClick={() => {
                                setHepaiUploadOpen(false);
                                resetPublishForm();
                            }}
                        >
                            取消
                        </AntdButton>
                        <AntdButton
                            type="primary"
                            loading={hepaiUploading}
                            disabled={hepaiPackingFolder}
                            icon={<Send className="h-4 w-4" aria-hidden />}
                            onClick={() => void submitHepaiUpload()}
                        >
                            发布 Skill
                        </AntdButton>
                    </div>
                }
                destroyOnClose
                width={600}
                styles={{
                    content: { borderRadius: 16, overflow: "hidden" },
                    header: { marginBottom: 0, paddingBottom: 12 },
                    body: { paddingTop: 8, maxHeight: "min(80vh, 720px)", overflow: "auto" },
                    footer: { paddingTop: 16 },
                }}
            >
                <div className="space-y-4">
                    <div>
                        <div className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                            Skill 文件 <span className="text-red-500">*</span>
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
                                    : "border-dashed border-slate-200 bg-slate-50/90 dark:border-white/12 dark:bg-white/[0.03]",
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
                                    message.warning("请将 .zip 文件拖到此处；文件夹请使用下方「选择文件夹」");
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
                                    <span className="max-w-full truncate px-1 text-center text-sm font-semibold text-slate-800 dark:text-slate-100">
                                        {hepaiPickPreview.name}
                                    </span>
                                    <span className="text-xs tabular-nums text-secondary">
                                        {formatBytes(hepaiPickPreview.size)}
                                    </span>
                                    <span className="text-center text-xs leading-relaxed text-secondary">
                                        可点击下方按钮更换；拖拽仅支持 zip
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span className="max-w-md text-center text-xs leading-relaxed text-secondary">
                                        请确保包含 SKILL.md；文件夹请点「选择文件夹」（浏览器将打包为 zip）；最多{" "}
                                        {MAX_SKILL_FOLDER_FILES} 个文件，总大小不超过 10 MB
                                    </span>
                                </>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <AntdButton
                                    type="default"
                                    loading={hepaiPackingFolder}
                                    disabled={hepaiUploading}
                                    icon={<FolderOpen className="h-4 w-4" aria-hidden />}
                                    className="rounded-xl"
                                    onClick={() => hepaiFolderInputRef.current?.click()}
                                >
                                    选择文件夹
                                </AntdButton>
                                <AntdButton
                                    type="default"
                                    disabled={hepaiPackingFolder || hepaiUploading}
                                    icon={<Package className="h-4 w-4" aria-hidden />}
                                    className="rounded-xl"
                                    onClick={() => hepaiZipInputRef.current?.click()}
                                >
                                    选择 zip 文件
                                </AntdButton>
                            </div>
                        </div>

                    </div>

                    <div>
                        <div className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                            显示名称 <span className="text-red-500">*</span>
                        </div>
                        <Input
                            placeholder="Skill 显示名称"
                            value={publishDisplayName}
                            onChange={(e) => setPublishDisplayName(e.target.value)}
                            className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                        />
                    </div>

                    <div>
                        <div className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">图标</div>
                        <Select
                            allowClear
                            placeholder="为你的 Skill 选择一个合适的图标"
                            value={publishIcon || undefined}
                            onChange={(v) => setPublishIcon(typeof v === "string" ? v : "")}
                            className="w-full [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-tertiary/40 [&_.ant-select-selector]:bg-background/55 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]"
                            options={SKILL_ICON_OPTIONS.map((o) => ({
                                value: o.value,
                                label: (
                                    <span className="flex items-center gap-2">
                                        <o.Icon className="h-4 w-4 shrink-0" aria-hidden />
                                        {o.label}
                                    </span>
                                ),
                            }))}
                        />
                    </div>

                    <div>
                        <div className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">描述</div>
                        <Input.TextArea
                            rows={3}
                            placeholder="该描述会从 SKILL.md 的 description 字段中自动提取，也支持手动填写"
                            value={publishDescription}
                            onChange={(e) => setPublishDescription(e.target.value)}
                            className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                        />
                    </div>

                    <div>
                        <div className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                            版本号 <span className="text-red-500">*</span>
                        </div>
                        <Input
                            placeholder="1.0.0"
                            value={publishVersion}
                            onChange={(e) => setPublishVersion(e.target.value)}
                            className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                        />
                    </div>

                    <div>
                        <div className="mb-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">变更说明</div>
                        <Input.TextArea
                            rows={2}
                            placeholder="描述本次版本的主要变更内容"
                            value={publishChangelog}
                            onChange={(e) => setPublishChangelog(e.target.value)}
                            className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                        />
                    </div>
                </div>
            </Modal>

            <Modal
                title={
                    <div className="flex items-start gap-3 pr-8">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent transition-colors dark:bg-accent/[0.16]">
                            <FileText className="h-5 w-5" strokeWidth={2} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="font-agent text-base font-semibold leading-tight text-slate-800 dark:text-slate-100">
                                SKILL.md 预览
                            </div>
                            {skillMdTitle ? (
                                <div
                                    className="mt-1 truncate text-sm font-medium leading-snug text-slate-600 dark:text-slate-300"
                                    title={skillMdTitle}
                                >
                                    {(() => {
                                        const { stem, ext } = splitArchiveName(skillMdTitle);
                                        return (
                                            <>
                                                <span>{stem}</span>
                                                {ext ? (
                                                    <span className="font-mono text-[13px] font-normal text-slate-400 dark:text-slate-500">
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
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">暂无可预览内容</p>
                        <p className="max-w-sm text-xs leading-relaxed text-secondary">
                            请确认 ZIP 内包含有效的 SKILL.md
                        </p>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default SkillsSquarePage;
