import { appContext } from "@/hooks/provider";
import { fileAPI } from "@/components/views/api";
import type { ServerUploadedFileInfo } from "@/pages/chat/chat/hooks/useFileUpload";
import officeDocxIcon from "@/assets/file-icons/office-docx.svg";
import officeExcelIcon from "@/assets/file-icons/office-els.svg";
import officePdfIcon from "@/assets/file-icons/office-pdf.svg";
import officePptIcon from "@/assets/file-icons/office-ppt.svg";
import officeTxtIcon from "@/assets/file-icons/office-txt.svg";
import { Button, Modal, message } from "antd";
import {
  Check,
  Download,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ViewMode = "grid" | "list";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extLabel(suffix: string | undefined, name: string): string {
  if (suffix && suffix.length > 0) {
    return suffix.replace(/^\./, "").toUpperCase() || "FILE";
  }
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toUpperCase() : "FILE";
}

function normalizeExt(suffix: string | undefined, name: string): string {
  if (suffix && suffix.length > 0) return suffix.replace(/^\./, "").toLowerCase();
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : "";
}

function getFileVisual(suffix: string | undefined, name: string): {
  Icon?: React.ComponentType<{ className?: string }>;
  iconSrc?: string;
  tone: "image" | "sheet" | "code" | "archive" | "media" | "word" | "pdf" | "ppt" | "txt" | "doc";
} {
  const ext = normalizeExt(suffix, name);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) {
    return { Icon: FileImage, tone: "image" };
  }
  if (["doc", "docx"].includes(ext)) {
    return { iconSrc: officeDocxIcon, tone: "word" };
  }
  if (["pdf"].includes(ext)) {
    return { iconSrc: officePdfIcon, tone: "pdf" };
  }
  if (["ppt", "pptx"].includes(ext)) {
    return { iconSrc: officePptIcon, tone: "ppt" };
  }
  if (["xls", "xlsx"].includes(ext)) {
    return { iconSrc: officeExcelIcon, tone: "sheet" };
  }
  if (["csv"].includes(ext)) {
    return { Icon: FileSpreadsheet, tone: "sheet" };
  }
  if (["txt"].includes(ext)) {
    return { iconSrc: officeTxtIcon, tone: "txt" };
  }
  if (["ts", "tsx", "js", "jsx", "py", "java", "go", "cpp", "c", "h", "css", "json", "yaml", "yml", "md"].includes(ext)) {
    return { Icon: FileCode2, tone: "code" };
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return { Icon: FileArchive, tone: "archive" };
  }
  if (["mp3", "wav", "flac", "aac", "ogg", "mp4", "mov", "mkv", "webm", "avi"].includes(ext)) {
    return { Icon: ["mp3", "wav", "flac", "aac", "ogg"].includes(ext) ? FileAudio2 : FileVideo2, tone: "media" };
  }
  return { Icon: FileText, tone: "doc" };
}

function getFileToneClasses(
  tone: "image" | "sheet" | "code" | "archive" | "media" | "word" | "pdf" | "ppt" | "txt" | "doc",
  isDark: boolean
): { wrap: string; icon: string } {
  const toneMap = {
    image: isDark
      ? { wrap: "bg-cyan-500/15 border-transparent ring-1 ring-inset ring-white/10", icon: "text-cyan-200" }
      : { wrap: "bg-cyan-50 border-cyan-200", icon: "text-cyan-700" },
    sheet: isDark
      ? { wrap: "bg-emerald-500/15 border-transparent ring-1 ring-inset ring-white/10", icon: "text-emerald-200" }
      : { wrap: "bg-emerald-50 border-emerald-200", icon: "text-emerald-700" },
    code: isDark
      ? { wrap: "bg-violet-500/15 border-transparent ring-1 ring-inset ring-white/10", icon: "text-violet-200" }
      : { wrap: "bg-violet-50 border-violet-200", icon: "text-violet-700" },
    archive: isDark
      ? { wrap: "bg-amber-500/15 border-transparent ring-1 ring-inset ring-white/10", icon: "text-amber-200" }
      : { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-700" },
    media: isDark
      ? { wrap: "bg-pink-500/15 border-transparent ring-1 ring-inset ring-white/10", icon: "text-pink-200" }
      : { wrap: "bg-pink-50 border-pink-200", icon: "text-pink-700" },
    word: isDark
      ? { wrap: "bg-blue-500/20 border-transparent ring-1 ring-inset ring-white/10", icon: "text-blue-200" }
      : { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-700" },
    pdf: isDark
      ? { wrap: "bg-red-500/20 border-transparent ring-1 ring-inset ring-white/10", icon: "text-red-200" }
      : { wrap: "bg-red-50 border-red-200", icon: "text-red-700" },
    ppt: isDark
      ? { wrap: "bg-orange-500/20 border-transparent ring-1 ring-inset ring-white/10", icon: "text-orange-200" }
      : { wrap: "bg-orange-50 border-orange-200", icon: "text-orange-700" },
    txt: isDark
      ? { wrap: "bg-slate-500/20 border-transparent ring-1 ring-inset ring-white/10", icon: "text-slate-200" }
      : { wrap: "bg-slate-50 border-slate-200", icon: "text-slate-700" },
    doc: isDark
      ? { wrap: "bg-white/10 border-transparent ring-1 ring-inset ring-white/10", icon: "text-secondary" }
      : { wrap: "bg-gray-50 border-gray-200", icon: "text-gray-600" },
  } as const;
  return toneMap[tone];
}

interface LibraryPageProps {
  /** files + 用户首条消息 → 交给父组件创建会话 */
  onStartChat: (files: ServerUploadedFileInfo[], query: string) => void;
}

/* ------------------------------------------------------------------ */
/* ChatModal：展示选中文件列表 + 底部聊天输入                           */
/* ------------------------------------------------------------------ */
interface ChatModalProps {
  open: boolean;
  files: ServerUploadedFileInfo[];
  onClose: () => void;
  onSubmit: (query: string) => void;
}

const ChatModal: React.FC<ChatModalProps> = ({ open, files, onClose, onSubmit }) => {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setText("");
      setSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [open]);

  const handleSubmit = async () => {
    const q = text.trim();
    if (!q || submitting) return;
    setSubmitting(true);
    try {
      onSubmit(q);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  if (!open) return null;

  const panel =
    "relative w-full max-w-2xl rounded-xl border border-primary bg-primary text-primary shadow-modern flex flex-col max-h-[85vh]";
  const fileWrap =
    "mx-4 mb-3 rounded-lg border border-primary/40 bg-tertiary/15 dark:bg-white/[0.04] overflow-hidden flex-shrink-0";
  const inputCls =
    "flex-1 resize-none rounded-lg border border-primary/40 bg-tertiary/10 dark:bg-white/[0.04] px-3 py-2.5 text-sm text-primary outline-none transition-colors placeholder:text-secondary/60 focus:border-accent/50 focus:ring-1 focus:ring-accent/30";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={panel} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0 border-b border-primary/30">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-accent shrink-0" aria-hidden />
            <span className="font-medium text-sm sm:text-base text-primary truncate">
              开始聊天 · {files.length} 个文件
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-tertiary/40 transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={fileWrap}>
          <div className="max-h-[240px] overflow-y-auto divide-y divide-primary/20">
            {files.map((f) => (
              <div key={f.uuid} className="flex items-center gap-3 px-3 py-2.5">
                <FileText className="w-4 h-4 flex-shrink-0 text-secondary" aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-primary truncate">{f.name}</div>
                  <div className="text-xs mt-0.5 text-secondary">
                    {extLabel(f.suffix, f.name)} · {formatSize(f.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="px-4 mb-2 text-xs flex-shrink-0 text-secondary">
          文件已就绪，无需重新上传。Enter 发送，Shift+Enter 换行。
        </p>

        <div className="px-4 pb-4 flex gap-2 items-end flex-shrink-0">
          <textarea
            ref={textareaRef}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入问题…"
            className={inputCls}
          />
          <Button
            type="primary"
            htmlType="button"
            loading={submitting}
            disabled={!text.trim() || submitting}
            onClick={() => void handleSubmit()}
            className="shrink-0"
            aria-label="发送"
            icon={<Send className="w-4 h-4" />}
          />
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* LibraryPage                                                          */
/* ------------------------------------------------------------------ */
const LibraryPage: React.FC<LibraryPageProps> = ({ onStartChat }) => {
  const { user, darkMode } = useContext(appContext);
  const userId = user?.email || "";
  const isDark = darkMode === "dark";

  const [items, setItems] = useState<ServerUploadedFileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const list = await fileAPI.listUserFiles(userId, 0);
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error(e);
      message.error("加载库文件失败");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((f) => (f.name || "").toLowerCase().includes(q));
  }, [items, query]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", "zh-CN")
    );
  }, [filtered]);

  const toggleSelect = (uuid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  const selectedFiles = useMemo(
    () => items.filter((f) => selected.has(f.uuid)),
    [items, selected]
  );

  const handleUploadPick = () => uploadRef.current?.click();

  const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !userId) return;
    try {
      await fileAPI.saveFilesToServer(userId, Array.from(files), 0);
      message.success("上传成功");
      await load();
    } catch (err) {
      console.error(err);
      message.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      e.target.value = "";
    }
  };

  const handleDownload = async () => {
    if (!userId || selectedFiles.length === 0) return;
    for (const f of selectedFiles) {
      if (f.url) {
        window.open(f.url, "_blank", "noopener,noreferrer");
      } else {
        const url = fileAPI.getDownloadUrl(userId, f.uuid);
        window.open(url, "_blank", "noopener,noreferrer");
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const handleRemove = () => {
    if (!userId || selectedFiles.length === 0) return;
    Modal.confirm({
      title: "移除所选文件？",
      content: "将从库中删除，且无法恢复。",
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        try {
          for (const f of selectedFiles) {
            await fileAPI.deleteUserFile(userId, f.uuid);
          }
          message.success("已移除");
          setSelected(new Set());
          await load();
        } catch (err) {
          console.error(err);
          message.error(err instanceof Error ? err.message : "删除失败");
        }
      },
    });
  };

  const handleChatSubmit = (chatQuery: string) => {
    setChatModalOpen(false);
    onStartChat(selectedFiles, chatQuery);
  };

  const cardBase =
    "border border-primary/50 rounded-lg bg-tertiary/10 dark:bg-white/[0.03] shadow-sm";
  const cardHover = "hover:bg-tertiary/25 dark:hover:bg-white/[0.06] hover:border-accent/30";

  const iconToggle = "p-2 text-secondary transition-colors hover:text-primary hover:bg-tertiary/30 rounded-md";
  const iconToggleActive = "bg-accent/15 text-accent";

  return (
    <>
      <div className="h-full min-h-0 flex flex-col p-4 bg-primary text-primary">
        <div className="flex-shrink-0 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="text-base font-medium text-primary">库</div>
            <div className="text-sm text-secondary mt-0.5">管理上传文件；选中后可发起对话或下载。</div>
          </div>
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end min-w-0">
            <div className="relative flex-1 sm:max-w-xs min-w-[180px]">
              <Search
                className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索文件名"
                className="w-full rounded-md border border-primary/40 bg-tertiary/10 dark:bg-white/[0.04] pl-9 pr-3 py-1.5 text-sm text-primary outline-none placeholder:text-secondary/60 focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
              />
            </div>
            <Button type="primary" htmlType="button" onClick={handleUploadPick} icon={<Upload className="w-4 h-4" />}>
              上传
            </Button>
          </div>
          <input
            ref={uploadRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUploadChange}
          />
        </div>

        <div className="flex-shrink-0 mt-3 pb-3 flex flex-wrap items-center gap-2 border-b border-primary/30">
          {selected.size > 0 ? (
            <>
              <Button
                type="primary"
                htmlType="button"
                onClick={() => setChatModalOpen(true)}
                icon={<MessageSquare className="w-4 h-4" />}
              >
                开始聊天
              </Button>
              <Button htmlType="button" onClick={() => void handleDownload()} icon={<Download className="w-4 h-4" />}>
                下载
              </Button>
              <Button
                color="danger"
                variant="outlined"
                htmlType="button"
                onClick={handleRemove}
                icon={<Trash2 className="w-4 h-4" />}
                className="!border-[var(--color-error-primary)] !text-[var(--color-error-primary)] hover:!text-[var(--color-error-primary)] hover:!border-[var(--color-error-primary)]"
              >
                删除
              </Button>
              <span className="ml-auto text-sm text-secondary">已选 {selected.size} 个</span>
            </>
          ) : (
            <div className="flex-1 min-w-[1px]" aria-hidden />
          )}
          <button
            type="button"
            title="排序（按名称）"
            className={iconToggle}
            onClick={() => message.info("当前按名称排序")}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <div className="flex rounded-lg border border-primary/40 bg-tertiary/10 dark:bg-white/[0.03] overflow-hidden p-0.5 gap-0.5">
            <button
              type="button"
              title="网格"
              onClick={() => setViewMode("grid")}
              className={`${iconToggle} rounded-md ${viewMode === "grid" ? iconToggleActive : ""}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="列表"
              onClick={() => setViewMode("list")}
              className={`${iconToggle} rounded-md ${viewMode === "list" ? iconToggleActive : ""}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto py-4">
          {loading ? (
            <div className="flex items-center justify-center py-24 text-secondary gap-2">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>加载中…</span>
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-24 text-secondary text-sm">
              {items.length === 0 ? "对话中上传的文件会出现在这里" : "没有匹配的文件"}
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sorted.map((f) => {
                const isSel = selected.has(f.uuid);
                const { Icon, iconSrc, tone } = getFileVisual(f.suffix, f.name);
                const IconComponent = Icon ?? FileText;
                const toneCls = getFileToneClasses(tone, isDark);
                return (
                  <button
                    key={f.uuid}
                    type="button"
                    onClick={() => toggleSelect(f.uuid)}
                    className={`relative text-left rounded-lg p-3 min-h-[120px] flex flex-col transition-colors ${cardBase} ${cardHover}`}
                  >
                    {isSel && (
                      <span className="absolute top-2.5 right-2.5 w-6 h-6 rounded-full flex items-center justify-center bg-accent text-white shadow-sm">
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </span>
                    )}
                    <div className="text-sm font-medium leading-snug pr-8 break-all text-primary">{f.name}</div>
                    <div className="mt-4 flex items-center gap-3">
                      <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border ${toneCls.wrap}`}>
                        {iconSrc ? (
                          <img src={iconSrc} alt="" className="w-5 h-5 object-contain" />
                        ) : (
                          <IconComponent className={`w-5 h-5 ${toneCls.icon}`} />
                        )}
                      </span>
                      <div className="text-xs text-secondary">
                        {extLabel(f.suffix, f.name)} · {formatSize(f.size)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((f) => {
                const isSel = selected.has(f.uuid);
                const { Icon, iconSrc, tone } = getFileVisual(f.suffix, f.name);
                const IconComponent = Icon ?? FileText;
                const toneCls = getFileToneClasses(tone, isDark);
                return (
                  <button
                    key={f.uuid}
                    type="button"
                    onClick={() => toggleSelect(f.uuid)}
                    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${cardBase} ${cardHover}`}
                  >
                    {isSel ? (
                      <span className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-accent text-white shadow-sm">
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="w-6 h-6 flex-shrink-0" />
                    )}
                    <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border ${toneCls.wrap}`}>
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className="w-5 h-5 object-contain" />
                      ) : (
                        <IconComponent className={`w-5 h-5 ${toneCls.icon}`} />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate text-primary">{f.name}</div>
                      <div className="text-xs text-secondary mt-0.5 flex items-center gap-1.5">
                        {extLabel(f.suffix, f.name)} · {formatSize(f.size)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Chat modal — portal-style overlay */}
      <ChatModal
        open={chatModalOpen}
        files={selectedFiles}
        onClose={() => setChatModalOpen(false)}
        onSubmit={handleChatSubmit}
      />
    </>
  );
};

export default LibraryPage;
