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
  ArrowDownAZ,
  ArrowUpAZ,
  Check,
  Copy,
  Download,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  FolderOpen,
  LayoutGrid,
  List,
  Loader2,
  MessageSquare,
  Search,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type ViewMode = "grid" | "list";
type SortOrder = "asc" | "desc";

function FileTypeIcon({
  Icon,
  iconSrc,
  toneCls,
  className = "w-7 h-7",
}: {
  Icon?: React.ComponentType<{ className?: string }>;
  iconSrc?: string;
  toneCls: { wrap: string; icon: string };
  className?: string;
}) {
  const IconComponent = Icon ?? FileText;
  return iconSrc ? (
    <img src={iconSrc} alt="" className={`${className} object-contain`} />
  ) : (
    <IconComponent className={`${className} ${toneCls.icon}`} />
  );
}

function LibraryImagePreview({
  src,
  onOpen,
  isDark,
}: {
  src: string;
  onOpen: () => void;
  isDark: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title="点击查看完整预览"
      className={`group/preview relative block w-full overflow-hidden rounded-xl border outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent/40 ${
        isDark
          ? "border-white/10 bg-black/25 hover:border-accent/30"
          : "border-[#e8eaf0] bg-[#f4f6fa] hover:border-[#cfc0e8]"
      }`}
    >
      <div className="aspect-[4/3] w-full">
        {!failed ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover/preview:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-secondary">
            <FileImage className="h-8 w-8 opacity-40" aria-hidden />
            <span className="text-[11px] opacity-70">预览不可用</span>
          </div>
        )}
      </div>
      <span
        className={`pointer-events-none absolute inset-x-0 bottom-0 px-2 py-1.5 text-[10px] font-medium tracking-wide opacity-0 transition-opacity group-hover/preview:opacity-100 ${
          isDark ? "bg-gradient-to-t from-black/70 to-transparent text-white/90" : "bg-gradient-to-t from-black/55 to-transparent text-white"
        }`}
      >
        查看大图
      </span>
    </button>
  );
}

interface LibraryFileCardProps {
  file: ServerUploadedFileInfo;
  userId: string;
  isDark: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onCopyLink: () => void;
  onOpenImage: (src: string, name: string) => void;
}

function LibraryFileGridCard({
  file,
  userId,
  isDark,
  isSelected,
  onToggleSelect,
  onCopyLink,
  onOpenImage,
}: LibraryFileCardProps) {
  const { Icon, iconSrc, tone } = getFileVisual(file.suffix, file.name);
  const toneCls = getFileToneClasses(tone, isDark);
  const imagePreviewSrc = libraryImagePreviewSrc(file, userId);

  return (
    <div
      tabIndex={0}
      onClick={onToggleSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleSelect();
        }
      }}
      aria-label={`选择文件 ${file.name}`}
      aria-pressed={isSelected}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-[18px] border text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/35 hover:-translate-y-px ${
        isSelected
          ? isDark
            ? "border-accent/50 bg-accent/10 shadow-[0_0_0_1px_rgba(167,139,250,0.18)_inset,0_12px_28px_rgba(0,0,0,0.28)]"
            : "border-accent/45 bg-accent/[0.06] shadow-[0_0_0_1px_rgba(167,139,250,0.16)_inset,0_12px_24px_rgba(52,61,88,0.08)]"
          : isDark
            ? "border-[#433a5e] bg-[rgba(167,139,250,0.08)] shadow-[0_8px_20px_rgba(0,0,0,0.22)] hover:border-[#5a4f7a] hover:shadow-[0_14px_28px_rgba(0,0,0,0.3)]"
            : "border-[#ddd3ef] bg-[#fafafe] shadow-[0_6px_16px_rgba(43,51,72,0.035)] hover:border-[#cfc0e8] hover:shadow-[0_12px_24px_rgba(52,61,88,0.065)]"
      }`}
    >
      <span
        className={`absolute right-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full transition-all ${
          isSelected
            ? "scale-100 bg-accent text-white opacity-100 shadow-sm"
            : "scale-90 border border-white/70 bg-white/85 text-transparent opacity-0 group-hover:scale-100 group-hover:opacity-100 dark:border-white/20 dark:bg-black/50"
        }`}
        aria-hidden
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>

      <div className="p-3 pb-2">
        {imagePreviewSrc ? (
          <LibraryImagePreview
            src={imagePreviewSrc}
            isDark={isDark}
            onOpen={() => onOpenImage(imagePreviewSrc, file.name)}
          />
        ) : (
          <div
            className={`flex aspect-[4/3] w-full items-center justify-center rounded-xl border ${toneCls.wrap}`}
          >
            <FileTypeIcon Icon={Icon} iconSrc={iconSrc} toneCls={toneCls} className="h-10 w-10" />
          </div>
        )}
      </div>

      <div
        className={`mt-auto border-t px-3 py-2.5 ${
          isDark ? "border-white/8" : "border-[#ebe7f1]"
        }`}
      >
        <div className="truncate text-sm font-medium text-primary" title={file.name}>
          {file.name}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
              isDark ? "bg-white/8 text-secondary" : "bg-[#f1eef7] text-[#6b6680]"
            }`}
          >
            {extLabel(file.suffix, file.name)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-secondary">
            {formatSize(file.size)}
          </span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-secondary opacity-0 outline-none transition-all hover:bg-tertiary/35 hover:text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/35 group-hover:opacity-100"
            title="复制文件链接"
            aria-label="复制文件链接"
            onClick={(e) => {
              e.stopPropagation();
              onCopyLink();
            }}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryFileListRow({
  file,
  userId,
  isDark,
  isSelected,
  onToggleSelect,
  onCopyLink,
  onOpenImage,
}: LibraryFileCardProps) {
  const { Icon, iconSrc, tone } = getFileVisual(file.suffix, file.name);
  const toneCls = getFileToneClasses(tone, isDark);
  const imagePreviewSrc = libraryImagePreviewSrc(file, userId);

  return (
    <div
      tabIndex={0}
      onClick={onToggleSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleSelect();
        }
      }}
      aria-label={`选择文件 ${file.name}`}
      aria-pressed={isSelected}
      className={`group flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent/35 ${
        isSelected
          ? isDark
            ? "border-accent/50 bg-accent/10"
            : "border-accent/45 bg-accent/[0.06]"
          : isDark
            ? "border-[#433a5e] bg-[rgba(167,139,250,0.06)] hover:border-[#5a4f7a] hover:bg-[rgba(167,139,250,0.1)]"
            : "border-[#e7e7ef] bg-white hover:border-[#ddd3ef] hover:bg-[#fafafe]"
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${
          isSelected ? "bg-accent text-white shadow-sm" : "border border-primary/25 bg-tertiary/15 text-transparent"
        }`}
        aria-hidden
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>

      {imagePreviewSrc ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenImage(imagePreviewSrc, file.name);
          }}
          title="点击查看完整预览"
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 ${toneCls.wrap}`}
        >
          <img
            src={imagePreviewSrc}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        <span
          className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${toneCls.wrap}`}
        >
          <FileTypeIcon Icon={Icon} iconSrc={iconSrc} toneCls={toneCls} className="h-5 w-5" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-primary" title={file.name}>
          {file.name}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-secondary">
          <span>{extLabel(file.suffix, file.name)}</span>
          <span aria-hidden>·</span>
          <span>{formatSize(file.size)}</span>
        </div>
      </div>

      <button
        type="button"
        className="inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-secondary opacity-0 outline-none transition-all hover:bg-tertiary/35 hover:text-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/35 group-hover:opacity-100"
        title="复制文件链接"
        aria-label="复制文件链接"
        onClick={(e) => {
          e.stopPropagation();
          onCopyLink();
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatSize(bytes: number | undefined | null): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
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

/** 文件可访问地址：与「下载」一致，优先已有 url，否则拼接后端下载地址。 */
function libraryFileAddress(
  f: ServerUploadedFileInfo,
  userId: string
): string | null {
  const u = f.url?.trim();
  if (u) return u;
  if (userId && f.uuid) return fileAPI.getDownloadUrl(userId, f.uuid);
  return null;
}

/** 网格/列表内联缩略图 URL（图片类型）。 */
function libraryImagePreviewSrc(
  f: { suffix: string; name: string; uuid: string; url?: string },
  userId: string
): string | null {
  const ext = normalizeExt(f.suffix, f.name);
  if (!["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return null;
  const u = f.url?.trim();
  if (u) return u;
  if (userId && f.uuid) return fileAPI.getDownloadUrl(userId, f.uuid);
  return null;
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
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [chatModalOpen, setChatModalOpen] = useState(false);
  const [imageLightbox, setImageLightbox] = useState<{ src: string; name: string } | null>(
    null
  );
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
    return [...filtered].sort((a, b) => {
      const cmp = (a.name || "").localeCompare(b.name || "", "zh-CN");
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortOrder]);

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

  const copyLibraryFileAddress = useCallback(async (f: ServerUploadedFileInfo) => {
    const addr = libraryFileAddress(f, userId);
    if (!addr) {
      message.warning("无法获取文件链接");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(addr);
      } else {
        const ta = document.createElement("textarea");
        ta.value = addr;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      message.success("已复制文件链接");
    } catch {
      message.error("复制失败");
    }
  }, [userId]);

  const handleChatSubmit = (chatQuery: string) => {
    setChatModalOpen(false);
    onStartChat(selectedFiles, chatQuery);
  };

  const iconToggle =
    "p-2 text-secondary transition-colors hover:text-primary hover:bg-tertiary/30 rounded-md";
  const iconToggleActive = "bg-accent/15 text-accent";

  const fileCardProps = (f: ServerUploadedFileInfo) => ({
    file: f,
    userId,
    isDark,
    isSelected: selected.has(f.uuid),
    onToggleSelect: () => toggleSelect(f.uuid),
    onCopyLink: () => void copyLibraryFileAddress(f),
    onOpenImage: (src: string, name: string) => setImageLightbox({ src, name }),
  });

  return (
    <>
      <div className="h-full min-h-0 flex flex-col bg-primary p-4 text-primary sm:p-5">
        <div className="flex-shrink-0 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <div className="text-base font-semibold tracking-[-0.01em] text-primary">库</div>
            <div className="mt-0.5 text-sm text-secondary">
              管理上传文件；选中后可发起对话或下载。
            </div>
            {!loading && (
              <div className="mt-1 text-xs text-secondary/80">
                {items.length === 0
                  ? "暂无文件"
                  : query.trim()
                    ? `共 ${items.length} 个文件 · 匹配 ${sorted.length} 个`
                    : `共 ${items.length} 个文件`}
              </div>
            )}
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

        {selected.size > 0 ? (
          <div
            className={`mt-3 flex flex-shrink-0 flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 ${
              isDark
                ? "border-accent/25 bg-accent/10"
                : "border-accent/20 bg-accent/[0.05]"
            }`}
          >
            <span className="mr-1 text-sm font-medium text-primary">已选 {selected.size} 个</span>
            <Button
              type="primary"
              htmlType="button"
              size="small"
              onClick={() => setChatModalOpen(true)}
              icon={<MessageSquare className="w-4 h-4" />}
            >
              开始聊天
            </Button>
            <Button
              htmlType="button"
              size="small"
              onClick={() => void handleDownload()}
              icon={<Download className="w-4 h-4" />}
            >
              下载
            </Button>
            <Button
              color="danger"
              variant="outlined"
              htmlType="button"
              size="small"
              onClick={handleRemove}
              icon={<Trash2 className="w-4 h-4" />}
              className="!border-[var(--color-error-primary)] !text-[var(--color-error-primary)] hover:!text-[var(--color-error-primary)] hover:!border-[var(--color-error-primary)]"
            >
              删除
            </Button>
            <Button
              htmlType="button"
              size="small"
              onClick={() => setSelected(new Set())}
              icon={<X className="w-4 h-4" />}
            >
              取消
            </Button>
          </div>
        ) : null}

        <div className="mt-3 flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-primary/30 pb-3">
          <div className="text-xs font-semibold tracking-wide text-secondary">
            {query.trim() ? "搜索结果" : "全部文件"}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              title={sortOrder === "asc" ? "按名称升序" : "按名称降序"}
              className={`${iconToggle} inline-flex items-center gap-1.5 px-2.5`}
              onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
            >
              {sortOrder === "asc" ? (
                <ArrowDownAZ className="h-4 w-4" />
              ) : (
                <ArrowUpAZ className="h-4 w-4" />
              )}
              <span className="hidden text-xs sm:inline">
                {sortOrder === "asc" ? "名称 A→Z" : "名称 Z→A"}
              </span>
            </button>
            <div className="flex overflow-hidden rounded-lg border border-primary/40 bg-tertiary/10 p-0.5 gap-0.5 dark:bg-white/[0.03]">
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
        </div>

        <div className="flex-1 min-h-0 overflow-auto py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-secondary">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>加载中…</span>
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-secondary">
              <FolderOpen className="mb-3 h-10 w-10 opacity-25" aria-hidden />
              <p className="text-sm">
                {items.length === 0 ? "对话中上传的文件会出现在这里" : "没有匹配的文件"}
              </p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {sorted.map((f) => (
                <LibraryFileGridCard key={f.uuid} {...fileCardProps(f)} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {sorted.map((f) => (
                <LibraryFileListRow key={f.uuid} {...fileCardProps(f)} />
              ))}
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

      <Modal
        open={Boolean(imageLightbox)}
        title={imageLightbox?.name}
        footer={null}
        centered
        width="fit-content"
        onCancel={() => setImageLightbox(null)}
        styles={{ body: { paddingBottom: "1rem", maxHeight: "90vh", overflow: "auto" } }}
        destroyOnClose
      >
        {imageLightbox ? (
          <img
            src={imageLightbox.src}
            alt={imageLightbox.name}
            className="block max-h-[85vh] max-w-[90vw] w-auto mx-auto object-contain"
          />
        ) : null}
      </Modal>
    </>
  );
};

export default LibraryPage;
