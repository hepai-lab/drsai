import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronRight,
  Code,
  Download,
  File,
  FileText,
  Folder,
  FolderOpen,
  Home,
  Image as ImageIcon,
  RotateCw,
  Trash2,
  X,
  Eye,
  ArrowLeft,
  Star,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GfsObjectInfo } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";

type GfsPane = "favorites" | "mine";

interface GfsFavorite {
  path: string;
  name: string;
  size: number;
  favoritedAt: number;
}

const FAVORITES_KEY = "drsai:gfs:favorites";

function loadFavorites(): GfsFavorite[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is GfsFavorite =>
        Boolean(item)
        && typeof item === "object"
        && typeof (item as GfsFavorite).path === "string"
        && typeof (item as GfsFavorite).name === "string",
      )
      .map((item) => ({
        path: item.path,
        name: item.name,
        size: typeof item.size === "number" ? item.size : 0,
        favoritedAt: typeof item.favoritedAt === "number" ? item.favoritedAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function saveFavorites(items: GfsFavorite[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(items.slice(0, 200)));
  } catch {
    /* ignore quota */
  }
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
}> = ({ file, onClose, onDownload }) => {
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
          title="下载"
        >
          <Download className="w-3.5 h-3.5" />
          <span>下载</span>
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
            >
              <Download className="w-4 h-4" />
              <span>下载文件</span>
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
  selectedPaths: Set<string>;
  onToggleSelect: (path: string) => void;
  favoritePaths: Set<string>;
  onToggleFavorite: (file: { path: string; name: string; size: number }) => void;
}> = ({
  node, depth, expanded, loadingPaths, onToggleExpand, onNavigate, onPreview, onDelete, onDownload,
  selectedPaths, onToggleSelect, favoritePaths, onToggleFavorite,
}) => {
  const isDir = node.isDir;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedPaths.has(node.path);
  const isFavorited = favoritePaths.has(node.path);
  const isLoading = loadingPaths.has(node.id);

  const handleClick = useCallback(() => {
    if (isDir) {
      onToggleExpand(node.id);
      onNavigate(node.path);
    } else {
      onPreview({ path: node.path, name: node.name, size: node.size, ext: getExt(node.path) });
    }
  }, [isDir, node, onNavigate, onPreview, onToggleExpand]);

  const handleChevron = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(node.id);
  }, [node.id, onToggleExpand]);

  return (
    <>
      <div
        style={{ paddingLeft: `${depth * 14 + 4}px` }}
        className="gfs-tree-row group"
        onClick={handleClick}
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

        {/* name */}
        <span className="gfs-tree-name" title={node.name}>{node.name}</span>

        {/* size */}
        {!isDir && <span className="gfs-tree-size">{formatSize(node.size)}</span>}

        {/* actions */}
        {!isDir && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite({ path: node.path, name: node.name, size: node.size });
            }}
            title={isFavorited ? "取消收藏" : "加入收藏"}
            className={`gfs-tree-btn favorite${isFavorited ? " active" : ""}`}
          >
            <Star className="w-3.5 h-3.5" fill={isFavorited ? "currentColor" : "none"} />
          </button>
        )}
        {!isDir && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPreview({ path: node.path, name: node.name, size: node.size, ext: getExt(node.path) }); }}
            title="预览"
            className="gfs-tree-btn preview"
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
        )}
        {!isDir && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDownload(node.path); }}
            title="下载"
            className="gfs-tree-btn download"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(node.path, isDir); }}
          title="删除"
          className="gfs-tree-btn delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* children */}
      {isDir && isOpen && node.children && node.children.length > 0 &&
        node.children.map((child) => (
          <TreeNode
            key={child.id} node={child} depth={depth + 1}
            expanded={expanded} loadingPaths={loadingPaths}
            onToggleExpand={onToggleExpand} onNavigate={onNavigate}
            onPreview={onPreview} onDelete={onDelete} onDownload={onDownload}
            selectedPaths={selectedPaths} onToggleSelect={onToggleSelect}
            favoritePaths={favoritePaths} onToggleFavorite={onToggleFavorite}
          />
        ))
      }
      {isDir && isOpen && (!node.children || node.children.length === 0) && !isLoading && (
        <div style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }} className="gfs-tree-empty-dir">空文件夹</div>
      )}
    </>
  );
};

// ── status ─────────────────────────────────────────────────────────────────────

type ConnStatus = "checking" | "connected" | "disconnected" | "error";
const STATUS_DOT: Record<ConnStatus, string> = { connected: "🟢", disconnected: "🔴", checking: "🟡", error: "🔴" };
const STATUS_LABEL: Record<ConnStatus, string> = { connected: "已连接", disconnected: "未连接", checking: "检测中…", error: "连接异常" };

// ── main ───────────────────────────────────────────────────────────────────────

export function GfsView({
  language: _language,
}: {
  language: AppLanguage;
}): React.JSX.Element {
  const [connStatus, setConnStatus] = useState<ConnStatus>("checking");
  const [bucketName, setBucketName] = useState("");
  const [activePane, setActivePane] = useState<GfsPane>("mine");
  const [favorites, setFavorites] = useState<GfsFavorite[]>(() => loadFavorites());
  const favoritePaths = useMemo(() => new Set(favorites.map((item) => item.path)), [favorites]);
  /** Selected directory prefix for upload destination (tree stays rooted at bucket). */
  const [currentPath, setCurrentPath] = useState("");
  const [treeData, setTreeData]       = useState<TreeFile[]>([]);
  const [loading, setLoading]         = useState(false);
  const [refreshKey, setRefreshKey]   = useState(0);
  const [healthKey, setHealthKey]     = useState(0);
  const [expanded, setExpanded]       = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [error, setError]             = useState<string | null>(null);
  const [message, setMessage]         = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);

  const [_uploading, setUploading]    = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // health
  useEffect(() => {
    let cancelled = false;
    setConnStatus("checking");
    void (async () => {
      try {
        await desktopApi.startGateway();
        if (cancelled) return;
        const r = await desktopApi.gfsHealthcheck();
        if (cancelled) return;
        setConnStatus(r.ok ? "connected" : "disconnected");
        if (r.bucket) setBucketName(r.bucket);
        if (!r.ok) {
          setError(
            r.reason
              || (r.mode === "admin"
                ? "GFS admin 模式未就绪。请检查 GFS_OPENAPI_KEY / GFS_USER_EMAIL，或确认能访问 GFS OpenAPI。"
                : "GFS 未配置。请设置 DRSAI_GFS_ENABLED=true，以及 personal 的 GFS_ACCESS_KEY/GFS_SECRET_KEY/GFS_BUCKET，或 admin 的 GFS_OPENAPI_KEY + GFS_USER_EMAIL。"),
          );
        } else {
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        setConnStatus("error");
        const detail = e instanceof Error ? e.message : String(e);
        setError(detail.includes("404")
          ? "GFS API 未就绪，请重启桌面端以加载网关路由。"
          : `无法连接 GFS 网关。${detail ? ` (${detail})` : ""}`);
      }
    })();
    return () => { cancelled = true; };
  }, [healthKey]);

  // Always load a rooted tree: bucket -> children (lazy expand for deeper folders)
  useEffect(() => {
    if (connStatus !== "connected") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
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
        setError(`加载目录失败：${e instanceof Error ? e.message : String(e)}`);
        setTreeData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [connStatus, refreshKey, bucketName]);

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const retryConnection = useCallback(() => {
    setError(null);
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
            setError(`展开目录失败：${e instanceof Error ? e.message : String(e)}`);
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
  }, [resolveListPrefix, upsertChildren]);

  /** Select a folder as upload target; does not flatten the tree. */
  const handleNavigate = useCallback((path: string) => {
    setMessage(null);
    setError(null);
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
    if (!window.confirm(isDir ? `确定要删除文件夹 "${name}" 及其所有内容吗？此操作不可恢复。` : `确定要删除 "${name}" 吗？此操作不可恢复。`)) return;
    setMessage(null);
    try {
      await desktopApi.gfsDelete({ path });
      setMessage(`已删除：${name}`);
      if (previewFile?.path === path) setPreviewFile(null);
      triggerRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [triggerRefresh, previewFile]);

  const handleDownload = useCallback(async (path: string) => {
    setMessage(null);
    try {
      const r = await desktopApi.gfsShareUrl({ path, ttlMinutes: 60 });
      const a = document.createElement("a");
      a.href = r.url; a.download = path.split("/").pop() ?? path; a.target = "_blank"; a.click();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const handleFilesPicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (e.target) e.target.value = "";
    if (picked.length === 0) return;
    setUploading(true); setMessage(null); setError(null);
    let uploaded = 0;
    const destDir = currentPath || "uploads/";
    for (const file of picked) {
      const remotePath = `${destDir}${file.name}`;
      try {
        const nf = file as File & { path?: string };
        if (nf.path) {
          await desktopApi.gfsUploadFile({ localPath: nf.path, remotePath });
        } else {
          const fd = new FormData(); fd.append("file", file); fd.append("remote_path", remotePath);
          const res = await fetch("/api-gateway/v1/gfs/upload-browser", { method: "POST", body: fd });
          if (!res.ok) throw new Error(await res.text());
        }
        uploaded += 1;
      } catch (err) {
        setError(`上传失败（${file.name}）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setUploading(false);
    if (uploaded > 0) {
      setMessage(`已上传 ${uploaded} 个文件到 ${destDir}`);
      triggerRefresh();
    }
  }, [currentPath, triggerRefresh]);

  const toggleSelect = useCallback((path: string) => {
    setSelectedPaths((prev) => { const n = new Set(prev); n.has(path) ? n.delete(path) : n.add(path); return n; });
  }, []);

  const toggleFavorite = useCallback((file: { path: string; name: string; size: number }) => {
    setFavorites((prev) => {
      const exists = prev.some((item) => item.path === file.path);
      const next = exists
        ? prev.filter((item) => item.path !== file.path)
        : [{ path: file.path, name: file.name, size: file.size, favoritedAt: Date.now() }, ...prev];
      saveFavorites(next);
      return next;
    });
  }, []);

  const refreshFavorites = useCallback(() => {
    setFavorites(loadFavorites());
  }, []);

  return (
    <div className="gfs-page">
      {/* header */}
      <div className="gfs-page-header">
        <div className="gfs-page-header-left">
          <h2 className="gfs-page-title">云盘（GFS）</h2>
          <span title={`GFS ${STATUS_LABEL[connStatus]}${bucketName ? `\n${bucketName}` : ""}`} className="gfs-status-dot">
            {STATUS_DOT[connStatus]}
          </span>
          <span className="gfs-status-label">{STATUS_LABEL[connStatus]}</span>
          {bucketName && <span className="gfs-bucket-label" title={bucketName}>· {bucketName}</span>}
        </div>
        <div className="gfs-page-header-actions">
          {connStatus !== "connected" ? (
            <button
              type="button"
              className="gfs-header-btn"
              onClick={retryConnection}
              disabled={connStatus === "checking"}
              title="重新检测连接"
            >
              <RotateCw className={`w-3.5 h-3.5${connStatus === "checking" ? " gfs-spin" : ""}`} />
              <span>重试连接</span>
            </button>
          ) : activePane === "favorites" ? (
            <button
              type="button"
              className="gfs-header-btn"
              onClick={refreshFavorites}
              title="刷新收藏"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>刷新</span>
            </button>
          ) : (
            <button
              type="button"
              className="gfs-header-btn"
              onClick={triggerRefresh}
              disabled={loading}
              title="刷新当前目录"
            >
              <RotateCw className={`w-3.5 h-3.5${loading ? " gfs-spin" : ""}`} />
              <span>刷新</span>
            </button>
          )}
        </div>
      </div>

      {/* content */}
      <div className="gfs-tab-content">
          <div className="gfs-tabs" role="tablist" aria-label="云盘分区">
            <button
              type="button"
              role="tab"
              aria-selected={activePane === "favorites"}
              className={`gfs-tab${activePane === "favorites" ? " active" : ""}`}
              onClick={() => setActivePane("favorites")}
            >
              我的收藏
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePane === "mine"}
              className={`gfs-tab${activePane === "mine" ? " active" : ""}`}
              onClick={() => setActivePane("mine")}
            >
              我的云盘
            </button>
          </div>

          {activePane === "favorites" ? (
            <div className="gfs-favorites">
              {favorites.length === 0 ? (
                <div className="gfs-favorites-empty">
                  <Star className="w-10 h-10 gfs-favorites-empty-icon" />
                  <p className="gfs-favorites-empty-title">还没有收藏过文件</p>
                  <small className="gfs-favorites-empty-sub">在「我的云盘」里点击星标即可收藏</small>
                  <button type="button" className="gfs-header-btn" onClick={refreshFavorites} style={{ marginTop: 10 }}>
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>刷新</span>
                  </button>
                </div>
              ) : (
                <div className={`gfs-split${previewFile ? " has-preview" : ""}`}>
                  <div className="gfs-tree">
                    {favorites.map((item) => (
                      <div
                        key={item.path}
                        className="gfs-tree-row group"
                        onClick={() => setPreviewFile({
                          path: item.path,
                          name: item.name,
                          size: item.size,
                          ext: getExt(item.path),
                        })}
                      >
                        <span className="gfs-tree-chevron-placeholder" />
                        <span className="flex-shrink-0">{fileIcon(item.path, false)}</span>
                        <span className="gfs-tree-name" title={item.path}>{item.name}</span>
                        <span className="gfs-tree-size">{formatSize(item.size)}</span>
                        <button
                          type="button"
                          className="gfs-tree-btn favorite active"
                          title="取消收藏"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(item);
                          }}
                        >
                          <Star className="w-3.5 h-3.5" fill="currentColor" />
                        </button>
                        <button
                          type="button"
                          className="gfs-tree-btn preview"
                          title="预览"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewFile({
                              path: item.path,
                              name: item.name,
                              size: item.size,
                              ext: getExt(item.path),
                            });
                          }}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="gfs-tree-btn download"
                          title="下载"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(item.path);
                          }}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {previewFile && (
                    <PreviewPanel
                      file={previewFile}
                      onClose={() => setPreviewFile(null)}
                      onDownload={handleDownload}
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
          <div className="gfs-mine">
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={handleFilesPicked} />

            {/* selected path (upload target); navigation is tree expand/collapse */}
            <div className="gfs-breadcrumb-bar">
              <Home className="w-3 h-3" />
              <span className="gfs-breadcrumb-btn current" title={selectedPathLabel}>
                {selectedPathLabel}
              </span>
            </div>

            {/* messages */}
            {error && (
              <div className="gfs-banner error">
                <span>{error}</span>
                <div className="gfs-banner-actions">
                  {connStatus !== "connected" ? (
                    <button type="button" onClick={retryConnection}>重试</button>
                  ) : (
                    <button type="button" onClick={triggerRefresh}>重新加载</button>
                  )}
                  <button type="button" onClick={() => setError(null)} aria-label="关闭"><X className="w-3 h-3" /></button>
                </div>
              </div>
            )}
            {message && (
              <div className="gfs-banner success">
                <span>{message}</span>
                <button type="button" onClick={() => setMessage(null)}><X className="w-3 h-3" /></button>
              </div>
            )}

            {/* split: tree + preview */}
            <div className={`gfs-split${previewFile ? " has-preview" : ""}`}>
              {/* tree */}
              <div className="gfs-tree">
                {connStatus === "checking" || loading ? (
                  <div className="gfs-tree-loading"><RotateCw className="w-4 h-4 gfs-spin" /><span>加载中…</span></div>
                ) : connStatus !== "connected" ? (
                  <div className="gfs-tree-empty">
                    <Folder className="w-10 h-10" style={{ color: "#6b7280" }} />
                    <p>云盘未连接</p>
                    <small>检查配置后点击「重试连接」</small>
                    <button type="button" className="gfs-header-btn" onClick={retryConnection} style={{ marginTop: 8 }}>
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>重试连接</span>
                    </button>
                  </div>
                ) : treeData.length === 0 ? (
                  <div className="gfs-tree-empty">
                    <Folder className="w-10 h-10" style={{ color: "#6b7280" }} />
                    <p>此目录为空</p>
                    <small>上传文件或切换目录</small>
                  </div>
                ) : (
                  treeData.map((node) => (
                    <TreeNode
                      key={node.id} node={node} depth={0}
                      expanded={expanded} loadingPaths={loadingPaths}
                      onToggleExpand={handleToggleExpand} onNavigate={handleNavigate}
                      onPreview={setPreviewFile} onDelete={handleDelete} onDownload={handleDownload}
                      selectedPaths={selectedPaths} onToggleSelect={toggleSelect}
                      favoritePaths={favoritePaths} onToggleFavorite={toggleFavorite}
                    />
                  ))
                )}
              </div>

              {/* preview panel */}
              {previewFile && (
                <PreviewPanel
                  file={previewFile}
                  onClose={() => setPreviewFile(null)}
                  onDownload={handleDownload}
                />
              )}
            </div>

            {/* footer */}
            {!loading && connStatus === "connected" && treeData.length > 0 && !previewFile && (
              <div className="gfs-tree-footer">
                <span>共 {treeData.filter((n) => n.isDir).length} 个目录，{treeData.filter((n) => !n.isDir).length} 个文件</span>
                {selectedPaths.size > 0 && <span className="gfs-tree-footer-sel">已选 {selectedPaths.size} 项</span>}
              </div>
            )}
          </div>
          )}
      </div>
    </div>
  );
}
