import { Drawer, Empty, Input, Modal, Spin, Tooltip, message } from "antd";
import { BookOpen, Download, RefreshCw, Search, Upload, Zap } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownRenderer from "../components/common/markdownrender";
import { skillsAPI, type SkillsCatalogItem } from "../components/views/api";
import { Button } from "../components/common/Button";

const ENABLE_SKILL_DOWNLOAD = false;
const ENABLE_SKILL_UPLOAD = false;

const SkillsSquarePage: React.FC = () => {
    const [items, setItems] = useState<SkillsCatalogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [active, setActive] = useState<SkillsCatalogItem | null>(null);
    const [detailBody, setDetailBody] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [uploadOpen, setUploadOpen] = useState(false);
    const [uploadSlug, setUploadSlug] = useState("");
    const [uploading, setUploading] = useState(false);
    const [downloadSlug, setDownloadSlug] = useState<string | null>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const rows = await skillsAPI.listCatalog();
            setItems(rows);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return items;
        return items.filter(
            (s) =>
                s.name.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q) ||
                s.slug.toLowerCase().includes(q)
        );
    }, [items, search]);

    const openDetail = async (row: SkillsCatalogItem) => {
        setActive(row);
        setDrawerOpen(true);
        setDetailBody(null);
        setDetailLoading(true);
        try {
            const d = await skillsAPI.getCatalogEntry(row.slug);
            setDetailBody(d.body);
        } catch (e) {
            setDetailBody(`_加载失败：${e instanceof Error ? e.message : String(e)}_`);
        } finally {
            setDetailLoading(false);
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

    const submitUpload = async () => {
        const input = uploadInputRef.current;
        const file = input?.files?.[0];
        if (!file) {
            message.warning("请选择 .zip 文件");
            return;
        }
        if (!file.name.toLowerCase().endsWith(".zip")) {
            message.warning("请上传 .zip 格式的技能包");
            return;
        }
        setUploading(true);
        try {
            await skillsAPI.uploadCatalogZip(file, uploadSlug.trim() || undefined);
            message.success("上传成功");
            setUploadOpen(false);
            setUploadSlug("");
            if (input) input.value = "";
            await load();
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="h-full min-h-0 flex flex-col bg-background">
            <div className="shrink-0 px-4 pt-4 pb-3 border-b border-tertiary/40 dark:border-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0))] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_12px_34px_rgba(0,0,0,0.45)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between max-w-6xl mx-auto w-full">
                    <div>
                        <h1 className="text-lg font-semibold text-primary flex items-center gap-2">
                            <Zap className="w-5 h-5 text-accent" />
                            技能广场
                        </h1>
                        <p className="text-sm text-secondary mt-0.5">
                            浏览、下载或上传 Agent Skills（ZIP 内含 SKILL.md 目录），与智能体能力说明同步。
                        </p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        {ENABLE_SKILL_UPLOAD ? (
                            <span
                                role="button"
                                tabIndex={loading ? -1 : 0}
                                aria-disabled={loading}
                                className={[
                                    "inline-flex shrink-0 h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
                                    "border border-tertiary/50 bg-gradient-to-b from-tertiary/25 to-tertiary/10 text-primary",
                                    "shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_1px_2px_rgba(0,0,0,0.25)]",
                                    "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out",
                                    "hover:border-accent/40 hover:from-tertiary/35 hover:to-tertiary/18 hover:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_4px_12px_rgba(0,0,0,0.2)]",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                    "active:scale-[0.98]",
                                    loading
                                        ? "pointer-events-none cursor-not-allowed opacity-45"
                                        : "cursor-pointer",
                                ].join(" ")}
                                onClick={() => {
                                    if (!loading) setUploadOpen(true);
                                }}
                                onKeyDown={(e) => {
                                    if (loading) return;
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setUploadOpen(true);
                                    }
                                }}
                            >
                                <Upload className="w-4 h-4 text-accent/90" aria-hidden />
                                上传
                            </span>
                        ) : null}
                        <Input
                            allowClear
                            prefix={<Search className="w-4 h-4 text-secondary" />}
                            placeholder="搜索名称、描述或目录名…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="max-w-md"
                        />
                        <Tooltip title="刷新列表">
                            <span
                                role="button"
                                tabIndex={loading ? -1 : 0}
                                aria-disabled={loading}
                                aria-label="刷新列表"
                                className={[
                                    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                    "border border-tertiary/50 bg-gradient-to-b from-tertiary/25 to-tertiary/10 text-secondary",
                                    "shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_1px_2px_rgba(0,0,0,0.25)]",
                                    "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out",
                                    "hover:border-accent/40 hover:text-accent hover:from-tertiary/35 hover:to-tertiary/18",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                    "active:scale-[0.98]",
                                    loading
                                        ? "pointer-events-none cursor-not-allowed opacity-45"
                                        : "cursor-pointer",
                                ].join(" ")}
                                onClick={() => {
                                    if (!loading) void load();
                                }}
                                onKeyDown={(e) => {
                                    if (loading) return;
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        void load();
                                    }
                                }}
                            >
                                <RefreshCw
                                    className={`h-4 w-4 ${loading ? "animate-spin text-accent" : ""}`}
                                    aria-hidden
                                />
                            </span>
                        </Tooltip>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
                <div className="max-w-6xl mx-auto">
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <Spin size="large" />
                        </div>
                    ) : error ? (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                            {error}
                        </div>
                    ) : filtered.length === 0 ? (
                        <Empty
                            className="py-16"
                            description={items.length === 0 ? "暂无技能或目录未找到" : "无匹配项"}
                        />
                    ) : (
                        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {filtered.map((s) => (
                                <li key={s.slug} className="h-full">
                                    <div className="h-[168px] rounded-2xl border border-tertiary/50 bg-tertiary/10 hover:bg-tertiary/20 hover:border-accent/30 transition-colors flex flex-col overflow-hidden dark:border-transparent dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.018))] dark:shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_14px_32px_rgba(0,0,0,0.5)] dark:hover:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.022))] dark:hover:shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_22px_48px_rgba(0,0,0,0.6)] dark:hover:ring-1 dark:hover:ring-white/10">
                                        <button
                                            type="button"
                                            onClick={() => void openDetail(s)}
                                            className="w-full text-left p-4 flex flex-col gap-2 flex-1"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <span className="font-semibold text-primary line-clamp-2">
                                                    {s.name}
                                                </span>
                                                <BookOpen className="w-4 h-4 shrink-0 text-accent opacity-80" />
                                            </div>
                                            <p className="text-sm text-secondary line-clamp-3 flex-1">
                                                {s.description}
                                            </p>
                                        </button>
                                        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-0 text-xs text-secondary/80 border-t border-tertiary/30 dark:border-transparent dark:bg-white/[0.02] dark:shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] dark:text-secondary dark:[&_code]:text-primary dark:[&_code]:font-medium">
                                            <div className="min-w-0 flex-1 flex items-center gap-2">
                                                <code className="truncate">{s.slug}</code>
                                                {s.compatibility ? (
                                                    <span className="truncate hidden sm:inline" title={s.compatibility}>
                                                        {s.compatibility}
                                                    </span>
                                                ) : null}
                                            </div>
                                            {ENABLE_SKILL_DOWNLOAD ? (
                                                <Tooltip title="下载 ZIP">
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        className="shrink-0 h-7 px-2"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            void handleDownload(s.slug);
                                                        }}
                                                        disabled={downloadSlug === s.slug}
                                                        isLoading={downloadSlug === s.slug}
                                                    >
                                                        <Download className="w-4 h-4" />
                                                    </Button>
                                                </Tooltip>
                                            ) : null}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
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
                title="上传技能（ZIP）"
                open={ENABLE_SKILL_UPLOAD && uploadOpen}
                onCancel={() => {
                    setUploadOpen(false);
                    setUploadSlug("");
                    if (uploadInputRef.current) uploadInputRef.current.value = "";
                }}
                onOk={() => void submitUpload()}
                confirmLoading={uploading}
                okText="上传"
                destroyOnClose
            >
                <p className="text-sm text-secondary mb-3">
                    支持两种结构：（1）ZIP 内仅一个子目录，且内含 <code>SKILL.md</code>，目录名将作为技能
                    slug；（2）ZIP 根目录直接包含 <code>SKILL.md</code>，此时请在下方填写 slug。
                </p>
                <div className="space-y-3">
                    <div>
                        <div className="text-xs text-secondary mb-1">slug（可选，根目录 SKILL.md 时必填）</div>
                        <Input
                            placeholder="例如 my-skill"
                            value={uploadSlug}
                            onChange={(e) => setUploadSlug(e.target.value)}
                            allowClear
                        />
                    </div>
                    <div>
                        <input
                            ref={uploadInputRef}
                            type="file"
                            accept=".zip,application/zip"
                            className="block w-full text-sm text-secondary file:mr-3 file:rounded-lg file:border file:border-tertiary/50 file:bg-tertiary/20 file:px-3 file:py-1.5"
                        />
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default SkillsSquarePage;
