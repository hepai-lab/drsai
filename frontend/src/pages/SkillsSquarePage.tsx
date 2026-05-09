import { Drawer, Input, Modal, Spin, message } from "antd";
import { Copy, Download, Eye, Search, Upload, Zap } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "../components/common/Button";
import MarkdownRenderer from "../components/common/markdownrender";
import { useSettingsStore } from "../components/store";
import { fileAPI, skillsAPI, type SkillsCatalogItem } from "../components/views/api";
import { appContext } from "../hooks/provider";

const ENABLE_SKILL_DOWNLOAD = false;
const ENABLE_HEPAI_SKILL_ZIP_UPLOAD = true;

type HepAIUploadRow = {
    id: string;
    filename: string;
    previewUrl: string;
    createdAtMs: number;
};

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
    const [hepaiRows, setHepaiRows] = useState<HepAIUploadRow[]>([]);
    const [skillMdOpen, setSkillMdOpen] = useState(false);
    const [skillMdLoading, setSkillMdLoading] = useState(false);
    const [skillMdTitle, setSkillMdTitle] = useState<string>("");
    const [skillMdBody, setSkillMdBody] = useState<string>("");
    const { config: _config } = useSettingsStore();

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

    const copyText = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
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
            const uploaded = await fileAPI.uploadToHepAI(userId, file);
            const id = uploaded.id;
            const previewUrl = uploaded.url;
            setHepaiRows((prev) => [
                {
                    id,
                    filename: file.name,
                    previewUrl,
                    createdAtMs: Date.now(),
                },
                ...prev,
            ]);
            message.success("已上传到 HepAI Files");
            setHepaiUploadOpen(false);
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
                        {ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? (
                            <span
                                role="button"
                                tabIndex={0}
                                className={[
                                    "inline-flex shrink-0 h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium",
                                    "border border-accent/30 bg-gradient-to-b from-accent/15 to-tertiary/10 text-primary",
                                    "shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_1px_2px_rgba(0,0,0,0.25)]",
                                    "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out",
                                    "hover:border-accent/50 hover:from-accent/20 hover:to-tertiary/18",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                                    "active:scale-[0.98] cursor-pointer",
                                ].join(" ")}
                                onClick={() => setHepaiUploadOpen(true)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        setHepaiUploadOpen(true);
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
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
                <div className="max-w-6xl mx-auto">
                    {hepaiRows.length > 0 ? (
                        <div className="mb-4 overflow-hidden rounded-2xl border border-tertiary/50 bg-tertiary/10 dark:border-transparent dark:bg-white/[0.02]">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-tertiary/40 dark:border-white/10">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                        <div className="text-sm font-semibold text-primary">已上传文件</div>
                                        <span className="inline-flex items-center rounded-full border border-tertiary/50 bg-background/30 px-2 py-0.5 text-[11px] text-secondary">
                                            {hepaiRows.length} 条
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <ul className="p-3 space-y-2 text-sm">
                                {hepaiRows.map((r) => (
                                    <li
                                        key={r.id}
                                        className={[
                                            "group rounded-xl border border-tertiary/40 bg-background/30 px-3 py-2.5",
                                            "shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]",
                                            "transition-[border-color,background-color,transform] duration-200 ease-out",
                                            "hover:border-accent/40 hover:bg-background/45",
                                        ].join(" ")}
                                    >
                                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="text-primary font-medium truncate" title={r.filename}>
                                                        {r.filename}
                                                    </div>
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-secondary">
                                                    <span>{new Date(r.createdAtMs).toLocaleString()}</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 sm:justify-end">
                                                <button
                                                    type="button"
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-tertiary/50 bg-background/20 text-secondary transition-colors hover:border-accent/40 hover:text-primary"
                                                    onClick={() => void openSkillMdPreview(r.id, r.filename)}
                                                    title="预览 SKILL.md"
                                                    aria-label="预览 SKILL.md"
                                                >
                                                    <Eye className="w-4 h-4" aria-hidden />
                                                </button>
                                                <a
                                                    href={r.previewUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-tertiary/50 bg-background/20 text-secondary transition-colors hover:border-accent/40 hover:text-primary"
                                                    title="下载"
                                                    aria-label="下载"
                                                >
                                                    <Download className="w-4 h-4" aria-hidden />
                                                </a>
                                                <button
                                                    type="button"
                                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-tertiary/50 bg-background/20 text-secondary transition-colors hover:border-accent/40 hover:text-primary"
                                                    onClick={() => void copyText(r.previewUrl)}
                                                    title="复制链接"
                                                    aria-label="复制链接"
                                                >
                                                    <Copy className="w-4 h-4" aria-hidden />
                                                </button>
                                            </div>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

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
                title="上传技能包到 HepAI Files（ZIP）"
                open={ENABLE_HEPAI_SKILL_ZIP_UPLOAD && hepaiUploadOpen}
                onCancel={() => {
                    setHepaiUploadOpen(false);
                    if (hepaiUploadInputRef.current) hepaiUploadInputRef.current.value = "";
                }}
                onOk={() => void submitHepaiUpload()}
                confirmLoading={hepaiUploading}
                okText="上传"
                destroyOnClose
            >
                <p className="text-sm text-secondary mb-3">
                    这里会把 ZIP 当作普通文件通过本服务端转发上传到 HepAI（purpose=<code>user_data</code>），并生成
                    <code>/files/&lt;id&gt;/preview</code> 链接，避免浏览器 CORS。该列表只在本页展示，不会混入技能广场目录。
                </p>
                <div className="space-y-3">
                    <div>
                        <input
                            ref={hepaiUploadInputRef}
                            type="file"
                            accept=".zip,application/zip"
                            className="block w-full text-sm text-secondary file:mr-3 file:rounded-lg file:border file:border-tertiary/50 file:bg-tertiary/20 file:px-3 file:py-1.5"
                        />
                    </div>
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
