import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Code,
  Download,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Home,
  Image as ImageIcon,
  RotateCw,
  Trash2,
  Eye,
  EyeOff,
  ArrowLeft,
  Star,
  Search,
  FolderPlus,
  Pencil,
  Upload,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GfsObjectInfo } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { requestAppDecision } from "./AppDecisionDialog";

type GfsPane = "favorites" | "mine";

/** 与 WebUI 一致：收藏列表来自桶内 `favorites/` 前缀（写入由对话/预览等入口完成，云盘页只读+删除）。 */
const GFS_FAVORITES_DIR = "favorites";

function fileBaseName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() ?? path;
}

interface GfsFavoriteItem {
  path: string;
  name: string;
  size: number;
  modifiedMs?: number;
}

function formatFavoriteTime(ms: number | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── file type icons ────────────────────────────────────────────────────────────

const FILE_ICONS: Record<string, React.ReactNode> = {
  pdf:  <FileText className="w-4 h-4" style={{ color: "#f87171" }} />,
  docx: <FileText className="w-4 h-4" style={{ color: "#60a5fa" }} />,
  doc:  <FileText className="w-4 h-4" style={{ color: "#60a5fa" }} />,
  pptx: <FileText className="w-4 h-4" style={{ color: "#f97316" }} />,
  ppt:  <FileText className="w-4 h-4" style={{ color: "#f97316" }} />,
  html: <FileText className="w-4 h-4" style={{ color: "#60a5fa" }} />,
  csv:  <FileText className="w-4 h-4" style={{ color: "#34d399" }} />,
  txt:  <FileText className="w-4 h-4" style={{ color: "#9ca3af" }} />,
  md:   <FileText className="w-4 h-4" style={{ color: "#9ca3af" }} />,
  json: <Code     className="w-4 h-4" style={{ color: "#fbbf24" }} />,
  py:   <Code     className="w-4 h-4" style={{ color: "#60a5fa" }} />,
  js:   <Code     className="w-4 h-4" style={{ color: "#facc15" }} />,
  ts:   <Code     className="w-4 h-4" style={{ color: "#60a5fa" }} />,
  tsx:  <Code     className="w-4 h-4" style={{ color: "#60a5fa" }} />,
  png:  <ImageIcon className="w-4 h-4" style={{ color: "#c084fc" }} />,
  jpg:  <ImageIcon className="w-4 h-4" style={{ color: "#c084fc" }} />,
  jpeg: <ImageIcon className="w-4 h-4" style={{ color: "#c084fc" }} />,
  gif:  <ImageIcon className="w-4 h-4" style={{ color: "#c084fc" }} />,
  svg:  <ImageIcon className="w-4 h-4" style={{ color: "#c084fc" }} />,
};

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const MD_EXTS    = new Set(["md", "markdown"]);
const TEXT_EXTS  = new Set(["txt", "md", "markdown", "json", "py", "js", "ts", "tsx", "jsx", "csv", "yaml", "yml", "toml", "sh", "html", "css"]);

function getExt(path: string): string {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function fileIcon(path: string, isDir: boolean, isOpen = false): React.ReactNode {
  if (isDir) {
    return isOpen
      ? <FolderOpen className="w-4 h-4" style={{ color: "#fbbf24" }} />
      : <Folder     className="w-4 h-4" style={{ color: "#fbbf24" }} />;
  }
  return FILE_ICONS[getExt(path)] ?? <File className="w-4 h-4" style={{ color: "#9ca3af" }} />;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function formatSize(bytes: number): string {
  if (!bytes || bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const PDF_EXTS  = new Set(["pdf"]);
const DOCX_EXTS = new Set(["docx", "doc"]);
const PPTX_EXTS = new Set(["pptx"]);

interface PptxSlidePreview {
  index: number;
  text: string;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function extractPptxSlideText(xml: string): string {
  const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter(Boolean);
  return runs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

type OfficePackageKind = "pptx" | "docx" | "xlsx" | "unknown";

function detectOfficePackageKind(entryNames: string[]): OfficePackageKind {
  const names = entryNames.map((n) => n.replace(/\\/g, "/").toLowerCase());
  if (names.some((n) => n === "ppt/presentation.xml" || /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    return "pptx";
  }
  if (names.some((n) => n === "word/document.xml")) return "docx";
  if (names.some((n) => n === "xl/workbook.xml" || n.startsWith("xl/worksheets/"))) return "xlsx";
  return "unknown";
}

async function extractPptxSlides(arrayBuffer: ArrayBuffer): Promise<{
  kind: OfficePackageKind;
  slides: PptxSlidePreview[];
  entryNames: string[];
}> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(arrayBuffer);
  const entryNames = Object.keys(zip.files).filter((name) => !name.endsWith("/"));
  const kind = detectOfficePackageKind(entryNames);
  if (kind !== "pptx") {
    return { kind, slides: [], entryNames };
  }

  const slideEntries = entryNames
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name.replace(/\\/g, "/")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const slides: PptxSlidePreview[] = [];
  for (const name of slideEntries) {
    const normalized = name.replace(/\\/g, "/");
    const match = normalized.match(/slide(\d+)\.xml$/i);
    const index = match ? Number.parseInt(match[1], 10) : slides.length + 1;
    const xml = await zip.files[name].async("string");
    slides.push({ index, text: extractPptxSlideText(xml) });
  }
  return { kind, slides, entryNames };
}

// ── Preview panel ──────────────────────────────────────────────────────────────

interface PreviewFile { path: string; name: string; size: number; ext: string; }

const PreviewPanel: React.FC<{
  file: PreviewFile;
  onClose: () => void;
  onDownload: (path: string) => void;
  downloading?: boolean;
}> = ({ file, onClose, onDownload, downloading = false }) => {
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [content, setContent]   = useState<string | null>(null);
  const [blobUrl, setBlobUrl]   = useState<string | null>(null);
  const [pptxSlides, setPptxSlides] = useState<PptxSlidePreview[] | null>(null);
  const [pptxNotice, setPptxNotice] = useState<string | null>(null);
  const [forceDocxRender, setForceDocxRender] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string | null>(null);
  const docxContainerRef        = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShareUrl(null); setContent(null); setBlobUrl(null); setPptxSlides(null);
    setPptxNotice(null); setForceDocxRender(false); setErr(null); setLoading(true);
    let objectUrl: string | null = null;

    desktopApi.gfsShareUrl({ path: file.path, ttlMinutes: 60 })
      .then(async (r) => {
        if (TEXT_EXTS.has(file.ext) && file.size < 512 * 1024) {
          const res = await fetch(r.url);
          setContent(await res.text());
        } else if (PDF_EXTS.has(file.ext)) {
          const res = await fetch(r.url);
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        } else {
          setShareUrl(r.url);
        }
        setLoading(false);
      })
      .catch((e) => { setErr(e instanceof Error ? e.message : String(e)); setLoading(false); });

    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.path, file.ext, file.size]);

  // render docx in-browser via docx-preview (also used when .pptx is actually a Word package)
  useEffect(() => {
    if (loading || !shareUrl) return;
    if (!DOCX_EXTS.has(file.ext) && !forceDocxRender) return;
    const container = docxContainerRef.current;
    if (!container) return;
    let cancelled = false;
    container.innerHTML = "";
    (async () => {
      try {
        const res = await fetch(shareUrl);
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;
        const { renderAsync } = await import("docx-preview");
        await renderAsync(arrayBuffer, container, undefined, {
          className: "docx-preview",
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true,
        });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [loading, shareUrl, file.ext, forceDocxRender]);

  // render pptx as per-slide text preview (OOXML / JSZip)
  useEffect(() => {
    if (loading || !shareUrl || !PPTX_EXTS.has(file.ext) || forceDocxRender) return;
    let cancelled = false;
    setPptxSlides(null);
    setPptxNotice(null);
    (async () => {
      try {
        const res = await fetch(shareUrl);
        if (!res.ok) {
          throw new Error(`下载预览文件失败 (HTTP ${res.status})`);
        }
        const arrayBuffer = await res.arrayBuffer();
        if (cancelled) return;
        const { kind, slides } = await extractPptxSlides(arrayBuffer);
        if (cancelled) return;
        // Some generators mislabel Word packages as .pptx — fall back to docx renderer.
        if (kind === "docx") {
          setPptxNotice("该文件扩展名为 .pptx，但内容实际是 Word 文档，已按 Word 预览。");
          setForceDocxRender(true);
          return;
        }
        if (kind !== "pptx" || slides.length === 0) {
          setErr(
            kind === "unknown"
              ? "未能识别该 Office 文件内容，无法预览"
              : "未能从 PPTX 中解析出幻灯片内容",
          );
          return;
        }
        setPptxSlides(slides);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [loading, shareUrl, file.ext, forceDocxRender]);

  return (
    <div className="gfs-preview-panel">
      {/* header */}
      <div className="gfs-preview-header">
        <button type="button" className="gfs-preview-back" onClick={onClose} title="返回">
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <span className="gfs-preview-filename" title={file.name}>{file.name}</span>
        <span className="gfs-preview-size">{formatSize(file.size)}</span>
        <button
          type="button"
          className="gfs-preview-dl-btn"
          onClick={() => onDownload(file.path)}
          title={downloading ? "下载中…" : "下载"}
          disabled={downloading}
        >
          {downloading
            ? <RotateCw className="w-3.5 h-3.5 gfs-spin" />
            : <Download className="w-3.5 h-3.5" />}
          <span>{downloading ? "下载中…" : "下载"}</span>
        </button>
      </div>

      {/* body */}
      <div className="gfs-preview-body">
        {loading && (
          <div className="gfs-preview-loading">
            <RotateCw className="w-5 h-5 gfs-spin" />
          </div>
        )}
        {!loading && err && (
          <div className="gfs-preview-err">{err}</div>
        )}
        {/* markdown — rendered */}
        {!loading && !err && content !== null && MD_EXTS.has(file.ext) && (
          <div className="gfs-preview-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
        {/* plain text / code */}
        {!loading && !err && content !== null && !MD_EXTS.has(file.ext) && (
          <pre className="gfs-preview-code">{content}</pre>
        )}
        {/* image */}
        {!loading && !err && content === null && shareUrl && IMAGE_EXTS.has(file.ext) && (
          <img src={shareUrl} alt={file.name} className="gfs-preview-img" />
        )}
        {pptxNotice && !loading && !err && (
          <div className="gfs-preview-pptx-banner gfs-preview-office-notice">{pptxNotice}</div>
        )}
        {/* docx — rendered in-browser via docx-preview */}
        {!loading && !err && content === null && shareUrl &&
          (DOCX_EXTS.has(file.ext) || forceDocxRender) && (
          <div ref={docxContainerRef} className="gfs-preview-docx" />
        )}
        {/* pptx — per-slide text extracted from OOXML */}
        {!loading && !err && content === null && shareUrl &&
          PPTX_EXTS.has(file.ext) && !forceDocxRender && (
          <div className="gfs-preview-pptx">
            {pptxSlides === null ? (
              <div className="gfs-preview-loading">
                <RotateCw className="w-5 h-5 gfs-spin" />
              </div>
            ) : (
              <>
                <div className="gfs-preview-pptx-banner">
                  文本预览（共 {pptxSlides.length} 页）· 完整版式请下载后打开
                </div>
                {pptxSlides.map((slide) => (
                  <article key={slide.index} className="gfs-preview-pptx-slide">
                    <header className="gfs-preview-pptx-slide-label">幻灯片 {slide.index}</header>
                    {slide.text ? (
                      <pre className="gfs-preview-pptx-slide-text">{slide.text}</pre>
                    ) : (
                      <p className="gfs-preview-pptx-slide-empty">（本页无文本内容，可能主要为图片）</p>
                    )}
                  </article>
                ))}
              </>
            )}
          </div>
        )}
        {/* pdf — blob iframe */}
        {!loading && !err && content === null && blobUrl && PDF_EXTS.has(file.ext) && (
          <iframe src={blobUrl} className="gfs-preview-iframe" title={file.name} />
        )}
        {/* unsupported */}
        {!loading && !err && content === null && shareUrl &&
          !IMAGE_EXTS.has(file.ext) && !PDF_EXTS.has(file.ext) &&
          !DOCX_EXTS.has(file.ext) && !PPTX_EXTS.has(file.ext) && !forceDocxRender && (
          <div className="gfs-preview-unsupported">
            <File className="w-12 h-12" style={{ color: "#9ca3af" }} />
            <p>该文件类型暂不支持预览</p>
            <button
              type="button"
              className="gfs-preview-dl-btn large"
              onClick={() => onDownload(file.path)}
              disabled={downloading}
              title={downloading ? "下载中…" : "下载文件"}
            >
              {downloading
                ? <RotateCw className="w-4 h-4 gfs-spin" />
                : <Download className="w-4 h-4" />}
              <span>{downloading ? "下载中…" : "下载文件"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── TreeNode ────────────────────────────────────────────────────────────────

interface TreeFile extends GfsObjectInfo {
  id: string;
  name: string;
  children?: TreeFile[] | null;
}

function buildNode(item: GfsObjectInfo, parentPrefix: string): TreeFile {
  const rel = item.path.slice(parentPrefix.length).replace(/\/$/, "");
  const name = rel.split("/").pop() ?? rel;
  return { ...item, id: item.path, name, children: item.isDir ? [] : null };
}

function normalizeGfsDirPath(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed ? `${trimmed}/` : "";
}

function isSameOrDescendantPath(parent: string, child: string): boolean {
  const p = parent.replace(/\/+$/, "");
  const c = child.replace(/\/+$/, "");
  if (!p) return false;
  return c === p || c.startsWith(`${p}/`);
}

const GFS_DND_MIME = "application/x-opendrsai-gfs-node";

const TreeNode: React.FC<{
  node: TreeFile;
  depth: number;
  expanded: Set<string>;
  loadingPaths: Set<string>;
  onToggleExpand: (id: string) => void;
  onNavigate: (path: string) => void;
  onPreview: (file: PreviewFile) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onDownload: (path: string) => void;
  downloadingPath: string | null;
  selectedPaths: Set<string>;
  onToggleSelect: (path: string) => void;
  renamingPath: string | null;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onStartRename: (node: TreeFile) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onMove: (sourcePath: string, targetDir: string, isDir: boolean) => void;
  dropTargetPath: string | null;
  onDropTargetChange: (path: string | null) => void;
  draggingPath: string | null;
  onDraggingPathChange: (path: string | null) => void;
}> = ({
  node, depth, expanded, loadingPaths, onToggleExpand, onNavigate, onPreview, onDelete, onDownload,
  downloadingPath, selectedPaths, onToggleSelect,
  renamingPath, renameDraft, onRenameDraftChange, onStartRename, onCommitRename, onCancelRename,
  onMove, dropTargetPath, onDropTargetChange, draggingPath, onDraggingPathChange,
}) => {
  const isDir = node.isDir;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedPaths.has(node.path);
  const isLoading = loadingPaths.has(node.id);
  const isRenaming = renamingPath === node.path;
  const isDropTarget = isDir && dropTargetPath === node.path;

  const handleClick = useCallback(() => {
    if (isRenaming) return;
    if (isDir) {
      onToggleExpand(node.id);
      onNavigate(node.path);
    } else {
      onPreview({ path: node.path, name: node.name, size: node.size, ext: getExt(node.path) });
    }
  }, [isDir, isRenaming, node, onNavigate, onPreview, onToggleExpand]);

  const handleChevron = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(node.id);
  }, [node.id, onToggleExpand]);

  return (
    <>
      <div
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        className={`gfs-tree-row group${isDropTarget ? " drop-target" : ""}`}
        onClick={handleClick}
        draggable={!isRenaming}
        onDragStart={(e) => {
          e.dataTransfer.setData(GFS_DND_MIME, JSON.stringify({
            path: node.path,
            isDir,
            name: node.name,
          }));
          e.dataTransfer.setData("text/plain", node.path);
          e.dataTransfer.effectAllowed = "move";
          onDraggingPathChange(node.path);
        }}
        onDragEnd={() => {
          onDraggingPathChange(null);
          onDropTargetChange(null);
        }}
        onDragOver={(e) => {
          if (!isDir || !draggingPath) return;
          if (isSameOrDescendantPath(draggingPath, node.path)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (dropTargetPath !== node.path) onDropTargetChange(node.path);
        }}
        onDragLeave={() => {
          if (dropTargetPath === node.path) onDropTargetChange(null);
        }}
        onDrop={(e) => {
          if (!isDir) return;
          e.preventDefault();
          e.stopPropagation();
          onDropTargetChange(null);
          onDraggingPathChange(null);
          try {
            const raw = e.dataTransfer.getData(GFS_DND_MIME) || "";
            const payload = raw
              ? JSON.parse(raw) as { path?: string; isDir?: boolean }
              : { path: e.dataTransfer.getData("text/plain"), isDir: false };
            const sourcePath = payload.path;
            if (!sourcePath || isSameOrDescendantPath(sourcePath, node.path) || sourcePath.replace(/\/+$/, "") === node.path.replace(/\/+$/, "")) {
              return;
            }
            onMove(sourcePath, node.path, Boolean(payload.isDir));
          } catch {
            /* ignore bad payload */
          }
        }}
      >
        {/* chevron */}
        {isDir ? (
          <button type="button" onClick={handleChevron} title={isOpen ? "折叠" : "展开"} className="gfs-tree-chevron">
            {isLoading
              ? <RotateCw className="w-3.5 h-3.5 gfs-spin" />
              : isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="gfs-tree-chevron-placeholder" />
        )}

        {/* checkbox */}
        <label className="gfs-tree-checkbox" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(node.path)} />
        </label>

        {/* icon */}
        <span className="flex-shrink-0">{fileIcon(node.path, isDir, isOpen)}</span>

        {/* name / rename */}
        {isRenaming ? (
          <input
            className="gfs-tree-rename-input"
            value={renameDraft}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onRenameDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename();
              }
            }}
            onBlur={() => onCommitRename()}
          />
        ) : (
          <span className="gfs-tree-name" title={node.name}>{node.name}</span>
        )}

        {/* size */}
        {!isDir && !isRenaming && <span className="gfs-tree-size">{formatSize(node.size)}</span>}

        {/* actions */}
        {!isRenaming && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onStartRename(node); }}
            title="重命名"
            className="gfs-tree-btn rename"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        {!isDir && !isRenaming && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPreview({ path: node.path, name: node.name, size: node.size, ext: getExt(node.path) }); }}
            title="预览"
            className="gfs-tree-btn preview"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
        )}
        {!isDir && !isRenaming && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDownload(node.path); }}
            title={downloadingPath === node.path ? "下载中…" : downloadingPath ? "请等待当前下载完成" : "下载"}
            className="gfs-tree-btn download"
            disabled={Boolean(downloadingPath)}
          >
            {downloadingPath === node.path
              ? <RotateCw className="w-3.5 h-3.5 gfs-spin" />
              : <Download className="w-3.5 h-3.5" />}
          </button>
        )}
        {!isRenaming && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(node.path, isDir); }}
            title="删除"
            className="gfs-tree-btn delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* children */}
      {isDir && isOpen && node.children && node.children.length > 0 &&
        node.children.map((child) => (
          <TreeNode
            key={child.id} node={child} depth={depth + 1}
            expanded={expanded} loadingPaths={loadingPaths}
            onToggleExpand={onToggleExpand} onNavigate={onNavigate}
            onPreview={onPreview} onDelete={onDelete} onDownload={onDownload}
            downloadingPath={downloadingPath}
            selectedPaths={selectedPaths} onToggleSelect={onToggleSelect}
            renamingPath={renamingPath} renameDraft={renameDraft}
            onRenameDraftChange={onRenameDraftChange}
            onStartRename={onStartRename} onCommitRename={onCommitRename} onCancelRename={onCancelRename}
            onMove={onMove} dropTargetPath={dropTargetPath} onDropTargetChange={onDropTargetChange}
            draggingPath={draggingPath} onDraggingPathChange={onDraggingPathChange}
          />
        ))
      }
      {isDir && isOpen && (!node.children || node.children.length === 0) && !isLoading && (
        <div style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }} className="gfs-tree-empty-dir">空文件夹</div>
      )}
    </>
  );
};

// ── Split: tree + resizable preview ────────────────────────────────────────────

const GFS_TREE_PANE_DEFAULT = 44;
const GFS_TREE_PANE_MIN = 22;
const GFS_TREE_PANE_MAX = 72;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function GfsSplitView({
  hasPreview,
  treePanePct,
  onTreePanePctChange,
  resizeTitle,
  tree,
  preview,
}: {
  hasPreview: boolean;
  treePanePct: number;
  onTreePanePctChange: (pct: number) => void;
  resizeTitle: string;
  tree: React.ReactNode;
  preview: React.ReactNode | null;
}): React.JSX.Element {
  const splitRef = useRef<HTMLDivElement>(null);
  const [resizing, setResizing] = useState(false);

  const startSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const split = splitRef.current;
    if (!split) return;
    const rect = split.getBoundingClientRect();
    if (rect.width <= 0) return;
    setResizing(true);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(moveEvent: PointerEvent): void {
      const nextPct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      onTreePanePctChange(clampNumber(nextPct, GFS_TREE_PANE_MIN, GFS_TREE_PANE_MAX));
    }

    function handlePointerUp(): void {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setResizing(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  return (
    <div
      ref={splitRef}
      className={`gfs-split${hasPreview ? " has-preview" : ""}${resizing ? " is-resizing" : ""}`}
    >
      <div
        className="gfs-tree"
        style={hasPreview ? { flexBasis: `${treePanePct}%` } : undefined}
      >
        {tree}
      </div>
      {hasPreview ? (
        <>
          <div
            className="gfs-split-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={Math.round(treePanePct)}
            aria-valuemin={GFS_TREE_PANE_MIN}
            aria-valuemax={GFS_TREE_PANE_MAX}
            title={resizeTitle}
            onPointerDown={startSplitResize}
          />
          {preview}
        </>
      ) : null}
    </div>
  );
}

// ── status ─────────────────────────────────────────────────────────────────────

type ConnStatus = "checking" | "connected" | "disconnected" | "error";
const STATUS_LABEL_ZH: Record<ConnStatus, string> = {
  connected: "已连接",
  disconnected: "未连接",
  checking: "检测中…",
  error: "连接异常",
};
const STATUS_LABEL_EN: Record<ConnStatus, string> = {
  connected: "Connected",
  disconnected: "Offline",
  checking: "Checking…",
  error: "Error",
};

// ── main ───────────────────────────────────────────────────────────────────────

export function GfsView({
  language,
}: {
  language: AppLanguage;
}): React.JSX.Element {
  const isZh = language === "zh";
  const STATUS_LABEL = isZh ? STATUS_LABEL_ZH : STATUS_LABEL_EN;
  const [connStatus, setConnStatus] = useState<ConnStatus>("checking");
  const [bucketName, setBucketName] = useState("");
  /** true：展示首次/更新密钥表单（密钥落盘到 $DRSAI_HOME/.env）。 */
  const [needsSetup, setNeedsSetup] = useState(false);
  const [portalUrl, setPortalUrl] = useState("https://gfs.ihep.ac.cn/");
  const [gfsEnabled, setGfsEnabled] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  // 密钥表单字段（Access / Secret / 桶名 / 可选邮箱）
  const [setupAccessKey, setSetupAccessKey] = useState("");
  const [setupSecretKey, setSetupSecretKey] = useState("");
  const [setupBucket, setSetupBucket] = useState("");
  const [setupEmail, setSetupEmail] = useState("");
  const [setupSaving, setSetupSaving] = useState(false);
  const [showAccessKey, setShowAccessKey] = useState(false);
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [activePane, setActivePane] = useState<GfsPane>("mine");
  const [favorites, setFavorites] = useState<GfsFavoriteItem[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(false);
  const [favoritesRefreshKey, setFavoritesRefreshKey] = useState(0);
  const [removingFavoritePath, setRemovingFavoritePath] = useState<string | null>(null);
  const [favoritesQuery, setFavoritesQuery] = useState("");
  /** 当前选中的上传目标目录前缀（树仍以 bucket 为根）。 */
  const [currentPath, setCurrentPath] = useState("");
  const [treeData, setTreeData]       = useState<TreeFile[]>([]);
  const [loading, setLoading]         = useState(false);
  /** 递增后触发「我的云盘」目录重载。 */
  const [refreshKey, setRefreshKey]   = useState(0);
  /** 递增后重新跑 gfsHealthcheck。 */
  const [healthKey, setHealthKey]     = useState(0);
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [actionToast, setActionToast] = useState<{ type: "success" | "warning" | "error"; message: string } | null>(null);
  const actionToastTimerRef = useRef<number | null>(null);
  /** 正在下载的远端路径；非 null 时禁用重复下载。 */
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  /** 右侧预览面板当前文件；null 表示关闭。 */
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  /** 有预览时左侧文件树宽度占比（%），拖拽分隔线可调。 */
  const [treePanePct, setTreePanePct] = useState(GFS_TREE_PANE_DEFAULT);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameIsDir, setRenameIsDir] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [mkdirBusy, setMkdirBusy] = useState(false);

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showActionToast = useCallback((type: "success" | "warning" | "error", text: string) => {
    if (actionToastTimerRef.current !== null) {
      window.clearTimeout(actionToastTimerRef.current);
    }
    setActionToast({ type, message: text });
    actionToastTimerRef.current = window.setTimeout(() => {
      setActionToast(null);
      actionToastTimerRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => () => {
    if (actionToastTimerRef.current !== null) {
      window.clearTimeout(actionToastTimerRef.current);
    }
  }, []);

  const refreshConfigSummary = useCallback(async () => {
    if (typeof desktopApi.gfsGetConfig !== "function") return;
    try {
      const cfg = await desktopApi.gfsGetConfig();
      setGfsEnabled(Boolean(cfg.enabled && cfg.configured));
      if (cfg.portalUrl) setPortalUrl(cfg.portalUrl);
      if (cfg.bucket) setBucketName(cfg.bucket);
    } catch {
      /* healthcheck already surfaces connectivity errors */
    }
  }, []);

  // 探活：未配置时 needsSetup=true，由 UI 引导去门户取密钥
  useEffect(() => {
    let cancelled = false;
    setConnStatus("checking");
    void (async () => {
      try {
        await desktopApi.startGateway();
        if (cancelled) return;
        const r = await desktopApi.gfsHealthcheck();
        if (cancelled) return;
        setNeedsSetup(Boolean(r.needsSetup));
        if (r.portalUrl) setPortalUrl(r.portalUrl);
        setConnStatus(r.ok ? "connected" : "disconnected");
        if (r.bucket) setBucketName(r.bucket);
        await refreshConfigSummary();
        if (cancelled) return;
        if (r.ok) {
          setNeedsSetup(false);
        }
      } catch {
        if (cancelled) return;
        setConnStatus("error");
        // 顶部状态卡已反映异常；不在进页时刷 toast
      }
    })();
    return () => { cancelled = true; };
  }, [healthKey, refreshConfigSummary]);

  const handleOpenPortal = useCallback(() => {
    void desktopApi.openExternal(portalUrl || "https://gfs.ihep.ac.cn/");
  }, [portalUrl]);

  /** 打开「配置密钥」：回填已保存的 $DRSAI_HOME/.env 凭证。 */
  const openCredentialForm = useCallback(async () => {
    setNeedsSetup(true);
    setShowAccessKey(false);
    setShowSecretKey(false);
    try {
      await desktopApi.startGateway();
      const cfg = await desktopApi.gfsGetConfig();
      if (cfg.portalUrl) setPortalUrl(cfg.portalUrl);
      setSetupAccessKey(cfg.accessKey?.trim() || "");
      setSetupSecretKey(cfg.secretKey?.trim() || "");
      setSetupBucket(cfg.bucket?.trim() || "");
      setSetupEmail(cfg.email?.trim() || "");
      setGfsEnabled(Boolean(cfg.enabled && cfg.configured));
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      showActionToast("error", `读取已保存配置失败：${raw}`);
    }
  }, [showActionToast]);

  const handleToggleEnabled = useCallback(async (nextEnabled: boolean) => {
    if (toggleBusy) return;
    setToggleBusy(true);
    try {
      await desktopApi.startGateway();
      if (!nextEnabled) {
        const confirmed = await requestAppDecision({
          id: "gfs-clear-config",
          tone: "danger",
          title: "关闭 GFS？",
          description: "将清除本机已保存的 Access Key / Secret Key / 桶名，并停用 Agent 的 GFS 工具。",
          impact: "云盘浏览与 GFS 工具将不可用，需重新配置后才能再次开启。",
          confirmLabel: "关闭并清除配置",
        });
        if (!confirmed) return;
        if (typeof desktopApi.gfsClearConfig !== "function") {
          throw new Error("当前环境不支持关闭 GFS 配置。");
        }
        const result = await desktopApi.gfsClearConfig();
        setGfsEnabled(false);
        setNeedsSetup(true);
        setConnStatus("disconnected");
        setBucketName("");
        setTreeData([]);
        setPreviewFile(null);
        setSetupAccessKey("");
        setSetupSecretKey("");
        setSetupBucket("");
        setSetupEmail("");
        showActionToast("success", result.message || "已关闭 GFS 并清除配置。");
        setHealthKey((k) => k + 1);
        return;
      }
      // 开启：进入配置表单；保存成功后即启用并同步 Agent 工具配置
      await openCredentialForm();
      showActionToast("warning", "请填写并保存 GFS 密钥以开启云盘与 Agent 工具。");
    } catch (e) {
      showActionToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setToggleBusy(false);
    }
  }, [toggleBusy, openCredentialForm, showActionToast]);

  const handleSaveSetup = useCallback(async () => {
    setSetupSaving(true);
    try {
      await desktopApi.startGateway();
      const result = await desktopApi.gfsSaveConfig({
        accessKey: setupAccessKey.trim(),
        secretKey: setupSecretKey.trim(),
        bucket: setupBucket.trim(),
        email: setupEmail.trim() || undefined,
      });
      showActionToast("success", result.message || "GFS 密钥已保存");
      setNeedsSetup(false);
      setGfsEnabled(true);
      if (result.bucket) setBucketName(result.bucket);
      await refreshConfigSummary();
      setHealthKey((k) => k + 1);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const detailMatch = raw.match(/\{.*"detail"\s*:\s*"([^"]+)"/);
      showActionToast("error", detailMatch?.[1] || raw);
    } finally {
      setSetupSaving(false);
    }
  }, [setupAccessKey, setupSecretKey, setupBucket, setupEmail, refreshConfigSummary, showActionToast]);

  // Always load a rooted tree: bucket -> children (lazy expand for deeper folders)
  useEffect(() => {
    if (connStatus !== "connected") return;
    let cancelled = false;
    setLoading(true);
    setSelectedPaths(new Set());

    const rootId = bucketName ? `${bucketName}/` : "";
    void (async () => {
      try {
        const r = await desktopApi.gfsList({ prefix: undefined, recursive: false, maxItems: 500 });
        if (cancelled) return;
        const children = r.items.map((item) => buildNode(item, ""));
        if (bucketName) {
          setTreeData([{
            id: rootId,
            name: bucketName,
            path: rootId,
            isDir: true,
            size: 0,
            etag: "",
            modifiedMs: 0,
            children,
          }]);
          setExpanded(new Set([rootId]));
        } else {
          setTreeData(children);
          setExpanded(new Set());
        }
        setCurrentPath("");
      } catch (e) {
        if (cancelled) return;
        showActionToast("error", `加载目录失败：${e instanceof Error ? e.message : String(e)}`);
        setTreeData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [connStatus, refreshKey, bucketName, showActionToast]);

  /** 仅重载目录树（上传/删除等内部调用，不关预览）。 */
  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  /** 用户点「刷新 / 重新加载」：先关右侧预览，再重载目录。 */
  const handleRefreshClick = useCallback(() => {
    setPreviewFile(null);
    triggerRefresh();
  }, [triggerRefresh]);
  const retryConnection = useCallback(() => {
    setHealthKey((k) => k + 1);
  }, []);

  const upsertChildren = useCallback((id: string, children: TreeFile[]) => {
    setTreeData((cur) => {
      const replace = (ns: TreeFile[]): TreeFile[] =>
        ns.map((n) =>
          n.id === id
            ? { ...n, children }
            : n.children
              ? { ...n, children: replace(n.children) }
              : n,
        );
      return replace(cur);
    });
  }, []);

  const resolveListPrefix = useCallback((id: string): string | undefined => {
    if (bucketName && (id === `${bucketName}/` || id === bucketName)) return undefined;
    let prefix = id.endsWith("/") ? id : `${id}/`;
    if (bucketName && prefix.startsWith(`${bucketName}/`)) {
      prefix = prefix.slice(bucketName.length + 1);
    }
    return prefix || undefined;
  }, [bucketName]);

  // expand lazy load in-place (tree stays rooted)
  const handleToggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      next.add(id);

      setTreeData((cur) => {
        let needsFetch = false;
        const walk = (nodes: TreeFile[]): void => {
          for (const n of nodes) {
            if (n.id === id && n.isDir && Array.isArray(n.children) && n.children.length === 0) {
              needsFetch = true;
            }
            if (n.children?.length) walk(n.children);
          }
        };
        walk(cur);
        if (!needsFetch) return cur;

        setLoadingPaths((p) => new Set(p).add(id));
        const listPrefix = resolveListPrefix(id);
        desktopApi.gfsList({
          prefix: listPrefix,
          recursive: false,
          maxItems: 500,
        })
          .then((r) => {
            const children = r.items.map((item) => buildNode(item, listPrefix || ""));
            upsertChildren(id, children);
          })
          .catch((e) => {
            showActionToast("error", `展开目录失败：${e instanceof Error ? e.message : String(e)}`);
          })
          .finally(() => {
            setLoadingPaths((p) => {
              const n = new Set(p);
              n.delete(id);
              return n;
            });
          });
        return cur;
      });
      return next;
    });
  }, [resolveListPrefix, upsertChildren, showActionToast]);

  /** Select a folder as upload target; does not flatten the tree. */
  const handleNavigate = useCallback((path: string) => {
    if (!path || path === "/" || (bucketName && (path === bucketName || path === `${bucketName}/`))) {
      setCurrentPath("");
      return;
    }
    let next = path.endsWith("/") ? path : `${path}/`;
    if (bucketName && next.startsWith(`${bucketName}/`)) {
      next = next.slice(bucketName.length + 1);
    }
    setCurrentPath(next);
  }, [bucketName]);

  const selectedPathLabel = (() => {
    if (!bucketName) return currentPath || "根目录";
    const trimmed = currentPath.replace(/\/$/, "");
    return trimmed ? `${bucketName}/${trimmed}` : bucketName;
  })();

  const handleDelete = useCallback(async (path: string, isDir: boolean) => {
    const name = path.replace(/\/$/, "").split("/").pop() ?? path;
    if (!await requestAppDecision({ id: "delete-gfs-object", tone: "danger", title: isDir ? `删除文件夹“${name}”？` : `删除“${name}”？`, description: isDir ? "该文件夹及其全部内容将被删除。" : "该文件将被删除。", impact: "此操作不可恢复。", confirmLabel: "确认删除" })) return;
    try {
      const deletePath = isDir ? normalizeGfsDirPath(path) : path;
      await desktopApi.gfsDelete({ path: deletePath });
      showActionToast("success", `已删除：${name}`);
      if (previewFile?.path === path || previewFile?.path === deletePath) setPreviewFile(null);
      triggerRefresh();
    } catch (e) {
      showActionToast("error", e instanceof Error ? e.message : String(e));
    }
  }, [triggerRefresh, previewFile, showActionToast]);

  const handleStartRename = useCallback((node: TreeFile) => {
    setRenamingPath(node.path);
    setRenameDraft(node.name);
    setRenameIsDir(Boolean(node.isDir));
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingPath(null);
    setRenameDraft("");
    setRenameIsDir(false);
  }, []);

  const handleCommitRename = useCallback(async () => {
    if (!renamingPath) return;
    const nextName = renameDraft.trim();
    const oldName = renamingPath.replace(/\/$/, "").split("/").pop() ?? "";
    if (!nextName || nextName === oldName) {
      handleCancelRename();
      return;
    }
    if (nextName.includes("/") || nextName === "." || nextName === "..") {
      showActionToast("error", isZh ? "名称不能包含路径分隔符" : "Name cannot contain path separators");
      return;
    }
    try {
      await desktopApi.gfsRename({
        path: renamingPath,
        newName: nextName,
        isDir: renameIsDir,
      });
      showActionToast("success", isZh ? `已重命名为 ${nextName}` : `Renamed to ${nextName}`);
      if (previewFile?.path === renamingPath) setPreviewFile(null);
      handleCancelRename();
      triggerRefresh();
    } catch (e) {
      showActionToast("error", e instanceof Error ? e.message : String(e));
    }
  }, [renamingPath, renameDraft, renameIsDir, handleCancelRename, previewFile, triggerRefresh, showActionToast, isZh]);

  const handleMove = useCallback(async (sourcePath: string, targetDir: string, isDir: boolean) => {
    const src = sourcePath.replace(/\/$/, "");
    const destDir = targetDir.replace(/\/$/, "");
    if (!src || isSameOrDescendantPath(src, destDir)) return;
    const name = src.split("/").pop() ?? src;
    try {
      await desktopApi.gfsMove({
        sourcePath,
        targetDir: destDir,
        isDir,
      });
      showActionToast("success", isZh ? `已移动：${name}` : `Moved: ${name}`);
      if (previewFile && isSameOrDescendantPath(src, previewFile.path.replace(/\/$/, ""))) {
        setPreviewFile(null);
      }
      triggerRefresh();
    } catch (e) {
      showActionToast("error", e instanceof Error ? e.message : String(e));
    }
  }, [previewFile, triggerRefresh, showActionToast, isZh]);

  const handleCreateFolder = useCallback(async () => {
    if (mkdirBusy || connStatus !== "connected") return;
    const suggested = isZh ? "新建文件夹" : "New folder";
    const name = window.prompt(isZh ? "文件夹名称" : "Folder name", suggested)?.trim();
    if (!name) return;
    if (name.includes("/") || name === "." || name === "..") {
      showActionToast("error", isZh ? "名称不能包含路径分隔符" : "Name cannot contain path separators");
      return;
    }
    setMkdirBusy(true);
    try {
      await desktopApi.gfsMkdir({
        parentPath: currentPath.replace(/\/$/, ""),
        name,
      });
      showActionToast("success", isZh ? `已创建：${name}` : `Created: ${name}`);
      triggerRefresh();
    } catch (e) {
      showActionToast("error", e instanceof Error ? e.message : String(e));
    } finally {
      setMkdirBusy(false);
    }
  }, [mkdirBusy, connStatus, currentPath, triggerRefresh, showActionToast, isZh]);

  const handleDownload = useCallback(async (path: string) => {
    if (downloadingPath) return;
    const name = path.replace(/\/$/, "").split("/").pop() ?? path;
    setDownloadingPath(path);
    try {
      const r = await desktopApi.gfsDownloadToDisk({ path });
      if (r.canceled) return;
      showActionToast("success", `下载完成：${name}`);
    } catch (e) {
      showActionToast("error", `下载失败（${name}）：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloadingPath(null);
    }
  }, [downloadingPath, showActionToast]);

  const handleFilesPicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (e.target) e.target.value = "";
    if (picked.length === 0) return;
    setUploading(true);
    let uploaded = 0;
    const destDir = currentPath || "uploads/";
    for (const file of picked) {
      const remotePath = `${destDir}${file.name}`;
      try {
        const nf = file as File & { path?: string };
        if (nf.path) {
          // Electron 提供本地绝对路径时走文件上传
          await desktopApi.gfsUploadFile({ localPath: nf.path, remotePath });
        } else {
          // 浏览器 File 无 path：改走 base64 upload-content
          const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
          await desktopApi.gfsUploadContent({
            remotePath,
            contentBase64,
            contentType: file.type || undefined,
          });
        }
        uploaded += 1;
      } catch (err) {
        showActionToast("error", `上传失败（${file.name}）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setUploading(false);
    if (uploaded > 0) {
      showActionToast("success", `已上传 ${uploaded} 个文件到 ${destDir}`);
      triggerRefresh();
    }
  }, [currentPath, triggerRefresh, showActionToast]);

  const toggleSelect = useCallback((path: string) => {
    setSelectedPaths((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });
  }, []);

  const refreshFavorites = useCallback(() => {
    setFavoritesRefreshKey((k) => k + 1);
  }, []);

  // 从 GFS favorites/ 拉取收藏列表（与 WebUI CloudPage 一致）
  useEffect(() => {
    if (connStatus !== "connected") {
      setFavorites([]);
      setFavoritesLoading(false);
      return;
    }
    let cancelled = false;
    setFavoritesLoading(true);
    void (async () => {
      try {
        const r = await desktopApi.gfsList({
          prefix: `${GFS_FAVORITES_DIR}/`,
          recursive: false,
          maxItems: 500,
        });
        if (cancelled) return;
        const items: GfsFavoriteItem[] = r.items
          .filter((item) => !item.isDir)
          .map((item) => {
            const name = fileBaseName(item.path);
            return {
              path: item.path,
              name,
              size: item.size ?? 0,
              modifiedMs: typeof item.modifiedMs === "number" ? item.modifiedMs : undefined,
            };
          })
          .sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));
        setFavorites(items);
      } catch (e) {
        if (cancelled) return;
        // 目录不存在时视为空收藏，不打断主流程
        const msg = e instanceof Error ? e.message : String(e);
        if (/not\s*found|nosuch|404/i.test(msg)) {
          setFavorites([]);
        } else {
          showActionToast("error", isZh ? `加载收藏失败：${msg}` : `Failed to load favorites: ${msg}`);
          setFavorites([]);
        }
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [connStatus, favoritesRefreshKey, showActionToast, isZh]);

  const removeFavorite = useCallback(async (item: GfsFavoriteItem) => {
    if (removingFavoritePath) return;
    setRemovingFavoritePath(item.path);
    try {
      await desktopApi.gfsDelete({ path: item.path });
      showActionToast("success", isZh ? `已取消收藏：${item.name}` : `Removed from favorites: ${item.name}`);
      if (previewFile?.path === item.path) setPreviewFile(null);
      refreshFavorites();
      triggerRefresh();
    } catch (e) {
      showActionToast(
        "error",
        isZh
          ? `取消收藏失败：${e instanceof Error ? e.message : String(e)}`
          : `Remove favorite failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      refreshFavorites();
    } finally {
      setRemovingFavoritePath(null);
    }
  }, [removingFavoritePath, previewFile, refreshFavorites, triggerRefresh, showActionToast, isZh]);

  const filteredFavorites = useMemo(() => {
    const q = favoritesQuery.trim().toLowerCase();
    if (!q) return favorites;
    return favorites.filter((item) =>
      item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q),
    );
  }, [favorites, favoritesQuery]);

  const gfsIsOn = gfsEnabled || connStatus === "connected";
  const statusHint = bucketName
    ? (isZh ? `存储桶：${bucketName}` : `Bucket: ${bucketName}`)
    : (isZh
      ? "配置密钥后即可浏览云盘并供 Agent 使用。"
      : "Configure credentials to browse cloud storage for agents.");

  return (
    <div className="gfs-page skills-manager skills-manager-page" data-testid="gfs-panel">
      {actionToast ? (
        <div
          className={`skills-action-toast skills-action-toast-${actionToast.type}`}
          role="status"
          aria-live="polite"
        >
          {actionToast.message}
        </div>
      ) : null}
      <div className="skills-page-top">
        <header className="skills-header">
          <span className="skills-header-mark" aria-hidden>
            <Cloud size={16} />
          </span>
          <div className="skills-header-text">
            <h2 className="skills-title">{isZh ? "云盘（GFS）" : "Cloud Drive (GFS)"}</h2>
            <p className="skills-relation-hint">{statusHint}</p>
          </div>
        </header>

        <div className="skills-online-stats" aria-label={isZh ? "统计" : "Stats"}>
          <div className="skills-online-stat-card" title={bucketName || undefined}>
            <div className="skills-online-stat-title">{isZh ? "连接" : "Status"}</div>
            <div className="skills-online-stat-value gfs-stat-status">{STATUS_LABEL[connStatus]}</div>
          </div>
          {/* 收藏统计卡片暂隐藏，后续再开
          <div className="skills-online-stat-card">
            <div className="skills-online-stat-title">{isZh ? "收藏" : "Favorites"}</div>
            <div className="skills-online-stat-value">{favorites.length}</div>
          </div>
          */}
          <div className="skills-online-stat-card">
            <div className="skills-online-stat-title">{isZh ? "已开启" : "Enabled"}</div>
            <div className="skills-online-stat-value">{gfsIsOn ? (isZh ? "是" : "On") : (isZh ? "否" : "Off")}</div>
          </div>
        </div>
      </div>

      <div className="skills-page-content skills-local gfs-page-content">
        {needsSetup ? (
          <div className="gfs-setup gfs-setup-card">
            <h3 className="gfs-setup-title">
              {connStatus === "connected"
                ? (isZh ? "更新 GFS 访问密钥" : "Update GFS credentials")
                : (isZh ? "首次使用：配置 GFS 访问密钥" : "First-time setup: GFS credentials")}
            </h3>
            <p className="gfs-setup-desc">
              {isZh
                ? <>请先在 GFS 网页创建或查看你的 Access Key / Secret Key 与存储桶，再填回本页。密钥保存在本机用户目录，无需编辑仓库 <code>.env</code>。</>
                : <>Create or view your Access Key / Secret Key and bucket on the GFS portal, then paste them here. Keys are stored in the local user directory — no need to edit the repo <code>.env</code>.</>}
            </p>
            <ol className="gfs-setup-steps">
              <li>{isZh ? "打开 GFS 控制台，进入「访问密钥」" : "Open the GFS console → Access Keys"}</li>
              <li>{isZh ? "创建永久密钥或点击「显示密钥」复制 Access Key / Secret Key" : "Create a permanent key or reveal and copy Access / Secret Key"}</li>
              <li>{isZh ? <>在「存储桶」页确认完整桶名（如 <code>20001-username</code>）</> : <>Confirm the full bucket name (e.g. <code>20001-username</code>)</>}</li>
              <li>{isZh ? "将密钥填入下方并保存" : "Paste credentials below and save"}</li>
            </ol>
            <button type="button" className="skills-btn ghost gfs-setup-portal-btn" onClick={handleOpenPortal}>
              <ExternalLink className="w-4 h-4" />
              <span>打开 https://gfs.ihep.ac.cn/</span>
            </button>
            <div className="gfs-setup-form">
              <label className="gfs-setup-field">
                <span>Access Key（访问密钥 ID）</span>
                <span className="gfs-setup-hint">{isZh ? "在 GFS 网页「显示密钥」中复制" : "Copy from GFS portal “Show key”"}</span>
                <div className="gfs-setup-secret-input">
                  <input
                    type={showAccessKey ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    value={setupAccessKey}
                    onChange={(e) => setSetupAccessKey(e.target.value)}
                    placeholder="例如 20240527-xxxxxxxxxxxx"
                  />
                  <button
                    type="button"
                    className="gfs-setup-secret-toggle"
                    onClick={() => setShowAccessKey((v) => !v)}
                    title={showAccessKey ? "隐藏 Access Key" : "显示 Access Key"}
                    aria-label={showAccessKey ? "隐藏 Access Key" : "显示 Access Key"}
                  >
                    {showAccessKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>
              <label className="gfs-setup-field">
                <span>Secret Key（密钥口令）</span>
                <span className="gfs-setup-hint">{isZh ? "网页里的「凭据值」，与 Access Key 成对" : "Credential value paired with Access Key"}</span>
                <div className="gfs-setup-secret-input">
                  <input
                    type={showSecretKey ? "text" : "password"}
                    autoComplete="new-password"
                    spellCheck={false}
                    value={setupSecretKey}
                    onChange={(e) => setSetupSecretKey(e.target.value)}
                    placeholder={isZh ? "显示密钥后复制凭据值" : "Paste secret after revealing key"}
                  />
                  <button
                    type="button"
                    className="gfs-setup-secret-toggle"
                    onClick={() => setShowSecretKey((v) => !v)}
                    title={showSecretKey ? "隐藏 Secret Key" : "显示 Secret Key"}
                    aria-label={showSecretKey ? "隐藏 Secret Key" : "显示 Secret Key"}
                  >
                    {showSecretKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>
              <label className="gfs-setup-field">
                <span>{isZh ? "完整桶名（Bucket）" : "Full bucket name"}</span>
                <span className="gfs-setup-hint">
                  {isZh
                    ? "你的 GFS 存储空间名称，在侧栏「存储桶」页面。一般是「数字-用户名」，例如 20001-username，不要只填短名。"
                    : "Your GFS storage name from the Buckets page (e.g. 20001-username). Use the full name."}
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={setupBucket}
                  onChange={(e) => setSetupBucket(e.target.value)}
                  placeholder="例如 20001-username"
                />
              </label>
              <label className="gfs-setup-field">
                <span>{isZh ? "邮箱（可选）" : "Email (optional)"}</span>
                <span className="gfs-setup-hint">{isZh ? "用于标识，可用你的 IHEP 邮箱" : "Optional identity, e.g. IHEP email"}</span>
                <input
                  type="email"
                  autoComplete="off"
                  value={setupEmail}
                  onChange={(e) => setSetupEmail(e.target.value)}
                  placeholder="user@ihep.ac.cn"
                />
              </label>
            </div>
            <div className="gfs-setup-actions">
              <button
                type="button"
                className="skills-btn primary"
                disabled={setupSaving || !setupAccessKey.trim() || !setupSecretKey.trim() || !setupBucket.trim()}
                onClick={() => void handleSaveSetup()}
              >
                {setupSaving
                  ? (isZh ? "保存并检测中…" : "Saving…")
                  : (isZh ? "保存并连接" : "Save & connect")}
              </button>
              {connStatus === "connected" && (
                <button
                  type="button"
                  className="skills-btn ghost"
                  onClick={() => {
                    setNeedsSetup(false);
                    setShowAccessKey(false);
                    setShowSecretKey(false);
                  }}
                >
                  {isZh ? "取消" : "Cancel"}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="skills-online-filters gfs-filters">
              <div className="skills-online-filter-bar">
                <div className="skills-online-cat-tabs" role="tablist" aria-label={isZh ? "云盘分区" : "Cloud panes"}>
                  {/* 我的收藏 Tab 暂隐藏，后续再开
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activePane === "favorites"}
                    className={`skills-online-cat-tab${activePane === "favorites" ? " active" : ""}`}
                    onClick={() => {
                      setPreviewFile(null);
                      setFavoritesQuery("");
                      setActivePane("favorites");
                    }}
                  >
                    {isZh ? "我的收藏" : "Favorites"}
                  </button>
                  */}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activePane === "mine"}
                    className={`skills-online-cat-tab${activePane === "mine" ? " active" : ""}`}
                    onClick={() => {
                      setPreviewFile(null);
                      setFavoritesQuery("");
                      setActivePane("mine");
                    }}
                  >
                    {isZh ? "我的云盘" : "My drive"}
                  </button>
                </div>
                <div className="skills-online-filter-actions">
                  <label
                    className="gfs-switch"
                    data-testid="gfs-manage-bar"
                    title={gfsIsOn
                      ? (isZh ? "关闭并清除 GFS 配置" : "Disable and clear GFS config")
                      : (isZh ? "开启 GFS（需配置密钥）" : "Enable GFS (credentials required)")}
                  >
                    <input
                      type="checkbox"
                      checked={gfsIsOn}
                      disabled={toggleBusy || connStatus === "checking"}
                      onChange={(e) => { void handleToggleEnabled(e.target.checked); }}
                    />
                    <span className="gfs-switch-track" aria-hidden />
                    <span className="gfs-switch-label">
                      {gfsIsOn
                        ? (isZh ? "已开启" : "On")
                        : (isZh ? "已关闭" : "Off")}
                    </span>
                  </label>
                  <button
                    type="button"
                    className="skills-btn ghost"
                    data-testid="gfs-configure-credentials"
                    onClick={() => void openCredentialForm()}
                    title={isZh ? "填写或更新 GFS 密钥" : "Configure GFS credentials"}
                  >
                    {isZh ? "配置密钥" : "Credentials"}
                  </button>
                  {connStatus !== "connected" ? (
                    <button
                      type="button"
                      className="skills-btn ghost"
                      onClick={retryConnection}
                      disabled={connStatus === "checking"}
                      title={isZh ? "重新检测连接" : "Retry connection"}
                    >
                      <RotateCw className={`w-3.5 h-3.5${connStatus === "checking" ? " gfs-spin" : ""}`} />
                      <span>{isZh ? "重试连接" : "Retry"}</span>
                    </button>
                  ) : activePane === "favorites" ? (
                    <button
                      type="button"
                      className="skills-btn ghost"
                      onClick={() => {
                        setPreviewFile(null);
                        refreshFavorites();
                      }}
                      disabled={favoritesLoading}
                      title={isZh ? "刷新收藏" : "Refresh favorites"}
                    >
                      <RotateCw className={`w-3.5 h-3.5${favoritesLoading ? " gfs-spin" : ""}`} />
                      <span>{isZh ? "刷新" : "Refresh"}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="skills-btn ghost"
                      onClick={handleRefreshClick}
                      disabled={loading}
                      title={isZh ? "刷新当前目录" : "Refresh folder"}
                    >
                      <RotateCw className={`w-3.5 h-3.5${loading ? " gfs-spin" : ""}`} />
                      <span>{isZh ? "刷新" : "Refresh"}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="gfs-workspace">
              {activePane === "favorites" ? (
                <div className="gfs-favorites">
                  <div className="gfs-breadcrumb-bar">
                    <Star className="w-3 h-3" />
                    <span className="gfs-breadcrumb-btn current" title={`${GFS_FAVORITES_DIR}/`}>
                      {GFS_FAVORITES_DIR}
                    </span>
                    {connStatus === "connected" && favorites.length > 0 ? (
                      <label className="gfs-favorites-search">
                        <Search className="w-3.5 h-3.5" aria-hidden />
                        <input
                          type="search"
                          value={favoritesQuery}
                          onChange={(e) => setFavoritesQuery(e.target.value)}
                          placeholder={isZh ? "搜索" : "Search"}
                          aria-label={isZh ? "搜索收藏文件" : "Search favorites"}
                        />
                      </label>
                    ) : null}
                  </div>

                  <GfsSplitView
                    hasPreview={Boolean(previewFile)}
                    treePanePct={treePanePct}
                    onTreePanePctChange={setTreePanePct}
                    resizeTitle={isZh ? "拖拽调整预览宽度" : "Drag to resize preview"}
                    tree={(
                      <>
                        {connStatus !== "connected" ? (
                          <div className="gfs-tree-empty">
                            <Cloud className="w-10 h-10" style={{ color: "#6b7280" }} />
                            <p>{isZh ? "云盘未连接" : "Cloud drive not connected"}</p>
                            <small>{isZh ? "检查配置后点击「重试连接」" : "Check config, then retry"}</small>
                            <button type="button" className="skills-btn ghost" onClick={retryConnection} style={{ marginTop: 8 }}>
                              <RotateCw className="w-3.5 h-3.5" />
                              <span>{isZh ? "重试连接" : "Retry"}</span>
                            </button>
                          </div>
                        ) : favoritesLoading && favorites.length === 0 ? (
                          <div className="gfs-tree-loading">
                            <RotateCw className="w-4 h-4 gfs-spin" />
                            <span>{isZh ? "加载中…" : "Loading…"}</span>
                          </div>
                        ) : favorites.length === 0 ? (
                          <div className="gfs-tree-empty">
                            <Star className="w-10 h-10" style={{ color: "#6b7280" }} />
                            <p>{isZh ? "还没有收藏过文件" : "No favorites yet"}</p>
                            <small>
                              {isZh
                                ? "在文件预览中点击「收藏」后会出现在这里"
                                : "Collect files from preview to see them here"}
                            </small>
                            <button
                              type="button"
                              className="skills-btn ghost"
                              onClick={refreshFavorites}
                              disabled={favoritesLoading}
                              style={{ marginTop: 8 }}
                            >
                              <RotateCw className={`w-3.5 h-3.5${favoritesLoading ? " gfs-spin" : ""}`} />
                              <span>{isZh ? "刷新" : "Refresh"}</span>
                            </button>
                          </div>
                        ) : filteredFavorites.length === 0 ? (
                          <div className="gfs-tree-empty">
                            <Search className="w-10 h-10" style={{ color: "#6b7280" }} />
                            <p>{isZh ? "没有匹配的收藏" : "No matching favorites"}</p>
                            <small>
                              {isZh
                                ? `未找到包含「${favoritesQuery.trim()}」的文件`
                                : `No files match “${favoritesQuery.trim()}”`}
                            </small>
                            <button
                              type="button"
                              className="skills-btn ghost"
                              onClick={() => setFavoritesQuery("")}
                              style={{ marginTop: 8 }}
                            >
                              {isZh ? "清除搜索" : "Clear search"}
                            </button>
                          </div>
                        ) : (
                          filteredFavorites.map((item) => {
                            const ext = getExt(item.path);
                            const modified = formatFavoriteTime(item.modifiedMs);
                            const selected = previewFile?.path === item.path;
                            return (
                              <div
                                key={item.path}
                                className={`gfs-tree-row group${selected ? " selected" : ""}`}
                                onClick={() => setPreviewFile({
                                  path: item.path,
                                  name: item.name,
                                  size: item.size,
                                  ext,
                                })}
                              >
                                <span className="gfs-tree-chevron-placeholder" />
                                <span className="flex-shrink-0">{fileIcon(item.path, false)}</span>
                                <span className="gfs-tree-name" title={item.path}>{item.name}</span>
                                {modified ? (
                                  <span className="gfs-tree-mtime" title={modified}>{modified}</span>
                                ) : null}
                                <span className="gfs-tree-size">{formatSize(item.size)}</span>
                                <button
                                  type="button"
                                  className="gfs-tree-btn preview"
                                  title={isZh ? "预览" : "Preview"}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPreviewFile({
                                      path: item.path,
                                      name: item.name,
                                      size: item.size,
                                      ext,
                                    });
                                  }}
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="gfs-tree-btn download"
                                  title={downloadingPath === item.path
                                    ? (isZh ? "下载中…" : "Downloading…")
                                    : downloadingPath
                                      ? (isZh ? "请等待当前下载完成" : "Wait for current download")
                                      : (isZh ? "下载" : "Download")}
                                  disabled={Boolean(downloadingPath)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDownload(item.path);
                                  }}
                                >
                                  {downloadingPath === item.path
                                    ? <RotateCw className="w-3.5 h-3.5 gfs-spin" />
                                    : <Download className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  type="button"
                                  className="gfs-tree-btn delete"
                                  title={isZh ? "取消收藏" : "Remove from favorites"}
                                  disabled={Boolean(removingFavoritePath)}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void removeFavorite(item);
                                  }}
                                >
                                  {removingFavoritePath === item.path
                                    ? <RotateCw className="w-3.5 h-3.5 gfs-spin" />
                                    : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            );
                          })
                        )}
                      </>
                    )}
                    preview={previewFile ? (
                      <PreviewPanel
                        file={previewFile}
                        onClose={() => setPreviewFile(null)}
                        onDownload={handleDownload}
                        downloading={downloadingPath === previewFile.path}
                      />
                    ) : null}
                  />

                  {!favoritesLoading && connStatus === "connected" && favorites.length > 0 && !previewFile ? (
                    <div className="gfs-tree-footer">
                      <span>
                        {favoritesQuery.trim()
                          ? (isZh
                            ? `显示 ${filteredFavorites.length} / ${favorites.length} 个文件`
                            : `Showing ${filteredFavorites.length} / ${favorites.length} files`)
                          : (isZh
                            ? `共 ${favorites.length} 个文件`
                            : `${favorites.length} file${favorites.length === 1 ? "" : "s"}`)}
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : (
              <div className="gfs-mine">
                  <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={handleFilesPicked} />

                  <div
                    className={`gfs-breadcrumb-bar${dropTargetPath === "__current__" ? " drop-target" : ""}`}
                    onDragOver={(e) => {
                      if (!draggingPath) return;
                      if (currentPath && isSameOrDescendantPath(draggingPath, currentPath)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dropTargetPath !== "__current__") setDropTargetPath("__current__");
                    }}
                    onDragLeave={() => {
                      if (dropTargetPath === "__current__") setDropTargetPath(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropTargetPath(null);
                      setDraggingPath(null);
                      try {
                        const raw = e.dataTransfer.getData(GFS_DND_MIME) || "";
                        const payload = raw
                          ? JSON.parse(raw) as { path?: string; isDir?: boolean }
                          : { path: e.dataTransfer.getData("text/plain"), isDir: false };
                        if (!payload.path) return;
                        const target = currentPath.replace(/\/$/, "");
                        if (target && isSameOrDescendantPath(payload.path, target)) return;
                        void handleMove(payload.path, currentPath, Boolean(payload.isDir));
                      } catch {
                        /* ignore */
                      }
                    }}
                  >
                    <Home className="w-3 h-3" />
                    <span className="gfs-breadcrumb-btn current" title={selectedPathLabel}>
                      {selectedPathLabel}
                    </span>
                    <div className="gfs-breadcrumb-actions">
                      <button
                        type="button"
                        className="gfs-breadcrumb-action"
                        disabled={uploading || connStatus !== "connected"}
                        onClick={() => fileInputRef.current?.click()}
                        title={isZh ? "上传文件到当前目录" : "Upload files here"}
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>{uploading ? (isZh ? "上传中…" : "Uploading…") : (isZh ? "上传文件" : "Upload")}</span>
                      </button>
                      <button
                        type="button"
                        className="gfs-breadcrumb-action"
                        disabled={mkdirBusy || connStatus !== "connected"}
                        onClick={() => void handleCreateFolder()}
                        title={isZh ? "在当前目录新建文件夹" : "Create folder here"}
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>{isZh ? "新建文件夹" : "New folder"}</span>
                      </button>
                    </div>
                  </div>

                  <GfsSplitView
                    hasPreview={Boolean(previewFile)}
                    treePanePct={treePanePct}
                    onTreePanePctChange={setTreePanePct}
                    resizeTitle={isZh ? "拖拽调整预览宽度" : "Drag to resize preview"}
                    tree={(
                      <>
                        {connStatus === "checking" || loading ? (
                          <div className="gfs-tree-loading">
                            <RotateCw className="w-4 h-4 gfs-spin" />
                            <span>{isZh ? "加载中…" : "Loading…"}</span>
                          </div>
                        ) : connStatus !== "connected" ? (
                          <div className="gfs-tree-empty">
                            <Folder className="w-10 h-10" style={{ color: "#6b7280" }} />
                            <p>{isZh ? "云盘未连接" : "Cloud drive not connected"}</p>
                            <small>{isZh ? "检查配置后点击「重试连接」" : "Check config, then retry"}</small>
                            <button type="button" className="skills-btn ghost" onClick={retryConnection} style={{ marginTop: 8 }}>
                              <RotateCw className="w-3.5 h-3.5" />
                              <span>{isZh ? "重试连接" : "Retry"}</span>
                            </button>
                          </div>
                        ) : treeData.length === 0 ? (
                          <div className="gfs-tree-empty">
                            <Folder className="w-10 h-10" style={{ color: "#6b7280" }} />
                            <p>{isZh ? "此目录为空" : "This folder is empty"}</p>
                            <small>{isZh ? "上传文件、新建文件夹或切换目录" : "Upload, create a folder, or change directory"}</small>
                            <button
                              type="button"
                              className="skills-btn ghost"
                              disabled={uploading || connStatus !== "connected"}
                              onClick={() => fileInputRef.current?.click()}
                              style={{ marginTop: 8 }}
                            >
                              <Upload className="w-3.5 h-3.5" />
                              <span>{uploading ? (isZh ? "上传中…" : "Uploading…") : (isZh ? "上传文件" : "Upload")}</span>
                            </button>
                          </div>
                        ) : (
                          treeData.map((node) => (
                            <TreeNode
                              key={node.id} node={node} depth={0}
                              expanded={expanded} loadingPaths={loadingPaths}
                              onToggleExpand={handleToggleExpand} onNavigate={handleNavigate}
                              onPreview={setPreviewFile} onDelete={handleDelete} onDownload={handleDownload}
                              downloadingPath={downloadingPath}
                              selectedPaths={selectedPaths} onToggleSelect={toggleSelect}
                              renamingPath={renamingPath} renameDraft={renameDraft}
                              onRenameDraftChange={setRenameDraft}
                              onStartRename={handleStartRename}
                              onCommitRename={() => { void handleCommitRename(); }}
                              onCancelRename={handleCancelRename}
                              onMove={(sourcePath, targetDir, isDir) => { void handleMove(sourcePath, targetDir, isDir); }}
                              dropTargetPath={dropTargetPath}
                              onDropTargetChange={setDropTargetPath}
                              draggingPath={draggingPath}
                              onDraggingPathChange={setDraggingPath}
                            />
                          ))
                        )}
                      </>
                    )}
                    preview={previewFile ? (
                      <PreviewPanel
                        file={previewFile}
                        onClose={() => setPreviewFile(null)}
                        onDownload={handleDownload}
                        downloading={downloadingPath === previewFile.path}
                      />
                    ) : null}
                  />

                  {!loading && connStatus === "connected" && treeData.length > 0 && !previewFile && (
                    <div className="gfs-tree-footer">
                      <span>
                        {isZh
                          ? `共 ${treeData.filter((n) => n.isDir).length} 个目录，${treeData.filter((n) => !n.isDir).length} 个文件`
                          : `${treeData.filter((n) => n.isDir).length} folders, ${treeData.filter((n) => !n.isDir).length} files`}
                      </span>
                      {selectedPaths.size > 0 && (
                        <span className="gfs-tree-footer-sel">
                          {isZh ? `已选 ${selectedPaths.size} 项` : `${selectedPaths.size} selected`}
                        </span>
                      )}
                    </div>
                  )}
              </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
