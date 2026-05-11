import { Drawer, Input, Modal, Spin, message } from "antd";
import { Check, Copy, Download, Eye, Package, Search, Upload, Wrench } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/common/Button";
import MarkdownRenderer from "../components/common/markdownrender";
import { useSettingsStore } from "../components/store";
import { fileAPI, skillsAPI, type SkillsCatalogItem } from "../components/views/api";
import { appContext } from "../hooks/provider";

const ENABLE_SKILL_DOWNLOAD = false;
const ENABLE_HEPAI_SKILL_ZIP_UPLOAD = true;

const LIST_ROW_ACTION_BTN =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-tertiary/40 text-secondary transition-colors duration-200 hover:bg-accent/15 hover:text-accent dark:bg-white/[0.06]";

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
    const hepaiUploadInputRef = useRef<HTMLInputElement>(null);
    const [hepaiUploadOpen, setHepaiUploadOpen] = useState(false);
    const [hepaiUploading, setHepaiUploading] = useState(false);
    const [hepaiPickPreview, setHepaiPickPreview] = useState<{ name: string; size: number } | null>(null);
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

    const filteredHepaiRows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return hepaiRows;
        return hepaiRows.filter((r) => {
            const desc = displayDescription(r, skillMdDescById[r.id]).toLowerCase();
            const by = (r.uploadedBy ?? "").toLowerCase();
            return (
                r.filename.toLowerCase().includes(q) ||
                desc.includes(q) ||
                (by.length > 0 && by.includes(q))
            );
        });
    }, [hepaiRows, search, skillMdDescById]);

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
        const input = hepaiUploadInputRef.current;
        const file = input?.files?.[0];
        if (!file) {
            message.warning("请选择 .zip 文件");
            return;
        }
        if (!file.name.toLowerCase().endsWith(".zip")) {
            message.warning("请上传 .zip 格式的技能包");
            return;
        }

        const userId = user?.email || "";
        if (!userId) {
            message.error("未登录或缺少 user_id（email）");
            return;
        }

        setHepaiUploading(true);
        try {
            await fileAPI.uploadToHepAI(userId, file);
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
            message.success("已上传到 HepAI Files");
            setHepaiUploadOpen(false);
            setHepaiPickPreview(null);
            if (input) input.value = "";
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
                                        setHepaiPickPreview(null);
                                        setHepaiUploadOpen(true);
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault();
                                            setHepaiPickPreview(null);
                                            setHepaiUploadOpen(true);
                                        }
                                    }}
                                >
                                    <Upload className="h-4 w-4 text-accent/90" aria-hidden />
                                    上传
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
                                <p className="mt-1 text-xs text-secondary">上传 ZIP 后即可出现在此列表</p>
                                {ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? (
                                    <button
                                        type="button"
                                        className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl border border-accent/40 bg-accent/14 px-4 text-sm font-medium text-slate-700 transition hover:border-accent/55 hover:bg-accent/22 dark:text-slate-200"
                                        onClick={() => {
                                            setHepaiPickPreview(null);
                                            setHepaiUploadOpen(true);
                                        }}
                                    >
                                        <Upload className="h-4 w-4 text-accent" aria-hidden />
                                        上传 ZIP
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
                                        const { stem, ext } = splitArchiveName(r.filename);
                                        const absTime = new Date(r.createdAtMs).toLocaleString();
                                        const uploader =
                                            r.uploadedBy?.trim() || user?.email?.trim() || "";
                                        const copied = copiedRowId === r.id;
                                        return (
                                            <li key={r.id} className="px-4 py-3.5 sm:px-4 sm:py-4">
                                                <div className="flex items-center gap-3 sm:gap-4">
                                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent/[0.12] text-accent dark:bg-accent/[0.16]">
                                                        <Package className="h-[24px] w-[24px]" strokeWidth={2} aria-hidden />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div
                                                            className="truncate text-[15px] font-medium leading-snug text-slate-800 dark:text-slate-100"
                                                            title={r.filename}
                                                        >
                                                            <span>{stem}</span>
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
                                                                    <span className="text-secondary/50"> 上传</span>
                                                                </>
                                                            ) : (
                                                                <span className="text-secondary/75">上传</span>
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
                    <div className="flex items-center gap-3 pr-6">
                        <span
                            className={[
                                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors",
                                hepaiPickPreview
                                    ? "bg-emerald-500/14 text-emerald-600 dark:bg-emerald-400/14 dark:text-emerald-400"
                                    : "bg-accent/12 text-accent dark:bg-accent/16",
                            ].join(" ")}
                        >
                            {hepaiPickPreview ? (
                                <Check className="h-5 w-5" strokeWidth={2.25} aria-hidden />
                            ) : (
                                <Upload className="h-5 w-5" aria-hidden />
                            )}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="font-agent text-base font-semibold leading-tight text-slate-800 dark:text-slate-100">
                                上传到 HepAI
                            </div>
                            {hepaiPickPreview ? (
                                <div className="mt-1 min-w-0 space-y-0.5">
                                    <div
                                        className="truncate text-sm font-medium leading-snug text-slate-700 dark:text-slate-200"
                                        title={hepaiPickPreview.name}
                                    >
                                        {(() => {
                                            const { stem, ext } = splitArchiveName(hepaiPickPreview.name);
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
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-normal text-secondary">
                                        <span className="tabular-nums">{formatBytes(hepaiPickPreview.size)}</span>
                                        {!hepaiPickPreview.name.toLowerCase().endsWith(".zip") ? (
                                            <span className="text-amber-600 dark:text-amber-400">需为 .zip 格式</span>
                                        ) : (
                                            <span>ZIP · SKILL.md</span>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-0.5 text-xs font-normal text-secondary">ZIP · SKILL.md</div>
                            )}
                        </div>
                    </div>
                }
                open={ENABLE_HEPAI_SKILL_ZIP_UPLOAD && hepaiUploadOpen}
                onCancel={() => {
                    setHepaiUploadOpen(false);
                    setHepaiPickPreview(null);
                    if (hepaiUploadInputRef.current) hepaiUploadInputRef.current.value = "";
                }}
                onOk={() => void submitHepaiUpload()}
                confirmLoading={hepaiUploading}
                okText="上传"
                destroyOnClose
                width={440}
                styles={{
                    content: { borderRadius: 16, overflow: "hidden" },
                    header: { marginBottom: 0, paddingBottom: 12 },
                    body: { paddingTop: 8 },
                    footer: { paddingTop: 12 },
                }}
            >
                <div className="space-y-3">
                    <label
                        className={[
                            "relative flex min-h-[168px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 px-4 py-8 transition-[border-color,background-color,box-shadow]",
                            hepaiPickPreview
                                ? "border-accent/35 bg-accent/[0.06] shadow-sm ring-1 ring-accent/10 dark:border-accent/30 dark:bg-accent/[0.08] dark:ring-accent/15"
                                : "border-dashed border-slate-200 bg-slate-50/90 hover:border-accent/40 hover:bg-accent/[0.04] dark:border-white/12 dark:bg-white/[0.03] dark:hover:border-accent/35 dark:hover:bg-accent/[0.06]",
                        ].join(" ")}
                    >
                        {hepaiPickPreview ? (
                            <>
                                <Package
                                    className="pointer-events-none h-9 w-9 text-accent/90"
                                    strokeWidth={1.75}
                                    aria-hidden
                                />
                                <span className="pointer-events-none max-w-full truncate px-1 text-center text-sm font-semibold text-slate-800 dark:text-slate-100">
                                    {hepaiPickPreview.name}
                                </span>
                                <span className="pointer-events-none text-xs tabular-nums text-secondary">
                                    {formatBytes(hepaiPickPreview.size)}
                                </span>
                                <span className="pointer-events-none text-center text-xs leading-relaxed text-secondary">
                                    点击区域可更换文件
                                </span>
                            </>
                        ) : (
                            <>
                                <Upload className="pointer-events-none h-9 w-9 text-accent/85" strokeWidth={1.75} aria-hidden />
                                <span className="pointer-events-none text-sm font-medium text-slate-700 dark:text-slate-200">
                                    点击选择文件
                                </span>
                                <span className="pointer-events-none text-center text-xs leading-relaxed text-secondary">
                                    仅支持 .zip，需包含 SKILL.md
                                </span>
                            </>
                        )}
                        <input
                            ref={hepaiUploadInputRef}
                            type="file"
                            accept=".zip,application/zip"
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                setHepaiPickPreview(f ? { name: f.name, size: f.size } : null);
                            }}
                        />
                    </label>

                </div>
            </Modal>

            <Modal
                title={skillMdTitle ? `${skillMdTitle} · SKILL.md` : "SKILL.md"}
                open={skillMdOpen}
                onCancel={() => {
                    setSkillMdOpen(false);
                    setSkillMdBody("");
                }}
                footer={null}
                destroyOnClose
                width={720}
            >
                {skillMdLoading ? (
                    <div className="flex justify-center py-10">
                        <Spin />
                    </div>
                ) : skillMdBody ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                        <MarkdownRenderer content={skillMdBody} />
                    </div>
                ) : (
                    <div className="text-sm text-secondary">暂无可预览内容</div>
                )}
            </Modal>
        </div>
    );
};

export default SkillsSquarePage;
