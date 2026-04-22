import { appContext } from "@/hooks/provider";
import { fileAPI } from "@/components/views/api";
import type { ServerUploadedFileInfo } from "@/pages/chat/chat/hooks/useFileUpload";
import officeDocxIcon from "@/assets/file-icons/office-docx.svg";
import officeExcelIcon from "@/assets/file-icons/office-els.svg";
import officePdfIcon from "@/assets/file-icons/office-pdf.svg";
import officePptIcon from "@/assets/file-icons/office-ppt.svg";
import officeTxtIcon from "@/assets/file-icons/office-txt.svg";
import { Modal, message } from "antd";
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
  isDark: boolean;
  onClose: () => void;
  onSubmit: (query: string) => void;
}

const ChatModal: React.FC<ChatModalProps> = ({ open, files, isDark, onClose, onSubmit }) => {
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

  const bg = isDark
    ? "bg-[#11151c] border-transparent text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_26px_70px_rgba(0,0,0,0.75)] ring-1 ring-white/10"
    : "bg-white border-gray-200 text-gray-900";
  const overlay = isDark ? "bg-black/60" : "bg-black/40";
  const fileBg = isDark
    ? "bg-white/[0.035] border-transparent ring-1 ring-inset ring-white/10 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]"
    : "bg-gray-50 border-gray-200";
  const inputBg = isDark
    ? "bg-white/[0.04] border-transparent ring-1 ring-inset ring-white/10 focus-within:ring-white/20 placeholder:text-secondary/60 text-white"
    : "bg-white border-gray-200 placeholder:text-gray-400 text-gray-900";
  const sendBtn =
    text.trim()
      ? isDark
        ? "bg-white text-gray-900 hover:bg-gray-100"
        : "bg-gray-900 text-white hover:bg-gray-800"
      : isDark
        ? "bg-white/10 text-secondary cursor-not-allowed"
        : "bg-gray-100 text-gray-400 cursor-not-allowed";

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center px-4 ${overlay}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`relative w-full max-w-2xl rounded-2xl border shadow-2xl flex flex-col max-h-[85vh] ${bg}`}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 opacity-70" aria-hidden />
            <span className="font-semibold text-base">
              开始聊天 · {files.length} 个文件
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-white/10 text-secondary" : "hover:bg-gray-100 text-gray-500"}`}
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* File list */}
        <div className={`mx-6 mb-4 rounded-xl border overflow-hidden flex-shrink-0 ${fileBg}`}>
          <div className="max-h-[240px] overflow-y-auto divide-y divide-inherit">
            {files.map((f) => (
              <div key={f.uuid} className="flex items-center gap-3 px-4 py-3">
                <FileText
                  className={`w-5 h-5 flex-shrink-0 ${isDark ? "text-secondary/70" : "text-gray-400"}`}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{f.name}</div>
                  <div className={`text-xs mt-0.5 ${isDark ? "text-secondary/60" : "text-gray-400"}`}>
                    {extLabel(f.suffix, f.name)} · {formatSize(f.size)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hint */}
        <p className={`px-6 mb-3 text-xs flex-shrink-0 ${isDark ? "text-secondary/60" : "text-gray-400"}`}>
          文件已就绪，无需重新上传。输入你的问题，按 Enter 发送（Shift+Enter 换行）。
        </p>

        {/* Input row */}
        <div className="px-6 pb-6 flex gap-3 items-end flex-shrink-0">
          <textarea
            ref={textareaRef}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="请输入你想了解的问题…"
            className={`flex-1 resize-none rounded-xl border px-4 py-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-offset-0 ${isDark ? "focus:ring-white/20" : "focus:ring-gray-900/10"} ${inputBg}`}
          />
          <button
            type="button"
            disabled={!text.trim() || submitting}
            onClick={() => void handleSubmit()}
            className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${sendBtn}`}
            aria-label="发送"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
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
      okText: "移除",
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

  const cardBase = isDark
    ? "border border-transparent bg-white/[0.03] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_14px_34px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
    : "border border-gray-200 bg-white";

  const cardHover = isDark
    ? "hover:bg-white/[0.05] hover:shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_22px_52px_rgba(0,0,0,0.65)] hover:ring-white/15"
    : "hover:bg-gray-50 hover:shadow-sm";

  const toolbarBtn =
    "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors";

  return (
    <>
      <div
        className={`h-full min-h-0 flex flex-col ${isDark ? "bg-primary text-primary" : "bg-white text-gray-900"}`}
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 pt-6 pb-4 flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight mr-auto">库</h1>
          <div className="flex flex-1 min-w-[200px] max-w-md items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索"
                className={`w-full rounded-full pl-9 pr-3 py-2 text-sm border outline-none transition-shadow ${isDark
                    ? "border-transparent bg-white/[0.04] ring-1 ring-inset ring-white/10 focus:ring-white/20 placeholder:text-secondary/60"
                    : "border-gray-200 bg-gray-50/80 placeholder:text-gray-400"
                  }`}
              />
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleUploadPick}
              className={`rounded-full px-5 py-2 text-sm font-semibold text-white ${isDark ? "bg-white text-gray-900 hover:bg-gray-100" : "bg-gray-900 hover:bg-gray-800"
                }`}
            >
              <span className="inline-flex items-center gap-2">
                <Upload className="w-4 h-4" />
                上传
              </span>
            </button>
          </div>
          <input
            ref={uploadRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUploadChange}
          />
        </div>

        {/* Toolbar */}
        <div
          className={`flex-shrink-0 px-6 pb-4 flex flex-wrap items-center gap-3 border-b ${isDark
            ? "border-transparent shadow-[0_-1px_0_rgba(255,255,255,0.06)_inset,0_10px_34px_rgba(0,0,0,0.35)]"
            : "border-gray-100"
            }`}
        >
          {selected.size > 0 ? (
            <>
              <button
                type="button"
                onClick={() => setChatModalOpen(true)}
                className={`${toolbarBtn} ${isDark ? "bg-white text-gray-900 hover:bg-gray-100" : "bg-gray-900 text-white hover:bg-gray-800"
                  }`}
              >
                <MessageSquare className="w-4 h-4" />
                开始聊天
              </button>
              <button
                type="button"
                onClick={() => void handleDownload()}
                className={`${toolbarBtn} ${isDark ? "text-primary hover:bg-white/5" : "text-gray-700 hover:bg-gray-100"
                  }`}
              >
                <Download className="w-4 h-4" />
                下载
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className={`${toolbarBtn} text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10`}
              >
                <Trash2 className="w-4 h-4" />
                移除
              </button>
              <span className={`ml-auto text-sm ${isDark ? "text-secondary" : "text-gray-500"}`}>
                已选 {selected.size} 个
              </span>
            </>
          ) : (
            <div className="flex-1 min-w-[1px]" aria-hidden />
          )}
          <button
            type="button"
            title="排序（按名称）"
            className={`p-2 rounded-lg ${isDark ? "hover:bg-white/5 text-secondary" : "hover:bg-gray-100 text-gray-500"}`}
            onClick={() => message.info("当前按名称排序")}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <div
            className={`flex rounded-lg border overflow-hidden ${isDark
              ? "border-transparent ring-1 ring-inset ring-white/10 bg-white/[0.02]"
              : "border-gray-200"
              }`}
          >
            <button
              type="button"
              title="网格"
              onClick={() => setViewMode("grid")}
              className={`p-2 ${viewMode === "grid" ? (isDark ? "bg-white/10" : "bg-gray-100") : ""}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="列表"
              onClick={() => setViewMode("list")}
              className={`p-2 ${viewMode === "list" ? (isDark ? "bg-white/10" : "bg-gray-100") : ""}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-6">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                    className={`relative text-left rounded-xl p-4 min-h-[132px] flex flex-col transition-all ${cardBase} ${cardHover}`}
                  >
                    {isSel && (
                      <span
                        className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center ${isDark ? "bg-white text-gray-900" : "bg-gray-900 text-white"
                          }`}
                      >
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </span>
                    )}
                    <div className="text-[15px] font-semibold leading-6 pr-8 break-all">{f.name}</div>
                    <div className="mt-4 flex items-center gap-3">
                      <span className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border ${toneCls.wrap}`}>
                        {iconSrc ? (
                          <img src={iconSrc} alt="" className="w-5 h-5 object-contain" />
                        ) : (
                          <IconComponent className={`w-5 h-5 ${toneCls.icon}`} />
                        )}
                      </span>
                      <div className={`text-xs ${isDark ? "text-secondary/70" : "text-gray-400"}`}>
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
                    className={`w-full flex items-center gap-4 rounded-xl px-4 py-3 text-left transition-all ${cardBase} ${cardHover}`}
                  >
                    {isSel ? (
                      <span
                        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${isDark ? "bg-white text-gray-900" : "bg-gray-900 text-white"
                          }`}
                      >
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
                      <div className="text-[15px] font-semibold truncate">{f.name}</div>
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
        isDark={isDark}
        onClose={() => setChatModalOpen(false)}
        onSubmit={handleChatSubmit}
      />
    </>
  );
};

export default LibraryPage;
