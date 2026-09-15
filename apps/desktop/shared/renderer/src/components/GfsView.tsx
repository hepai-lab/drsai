import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  ChevronRight,
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
  X,
  Eye,
  EyeOff,
  ArrowLeft,
  Star,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GfsObjectInfo } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { requestAppDecision } from "./AppDecisionDialog";

type GfsPane = "favorites" | "mine";

interface GfsFavorite {
  path: string;
  name: string;
  size: number;
  favoritedAt: number;
}

/** 收藏仅存本机 localStorage，不与 GFS / 网关同步。 */
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
    // 上限 200 条，避免 localStorage 膨胀
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
  favoritePaths: Set<string>;
  onToggleFavorite: (file: { path: string; name: string; size: number }) => void;
}> = ({
  node, depth, expanded, loadingPaths, onToggleExpand, onNavigate, onPreview, onDelete, onDownload,
  downloadingPath, selectedPaths, onToggleSelect, favoritePaths, onToggleFavorite,
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
            title={downloadingPath === node.path ? "下载中…" : downloadingPath ? "请等待当前下载完成" : "下载"}
            className="gfs-tree-btn download"
            disabled={Boolean(downloadingPath)}
          >
            {downloadingPath === node.path
              ? <RotateCw className="w-3.5 h-3.5 gfs-spin" />
              : <Download className="w-3.5 h-3.5" />}
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
            downloadingPath={downloadingPath}
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
  const [favorites, setFavorites] = useState<GfsFavorite[]>(() => loadFavorites());
  const favoritePaths = useMemo(() => new Set(favorites.map((item) => item.path)), [favorites]);
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
  const [error, setError]             = useState<string | null>(null);
  const [message, setMessage]         = useState<string | null>(null);
  /** 正在下载的远端路径；非 null 时展示 loading 横幅并禁用重复下载。 */
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  /** 右侧预览面板当前文件；null 表示关闭。 */
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);

  const [_uploading, setUploading]    = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        if (!r.ok) {
          // 缺密钥时只出表单，不叠错误条
          setError(
            r.needsSetup
              ? null
              : (r.reason
                || (r.mode === "admin"
                  ? "GFS admin 模式未就绪。请检查配置或重新填写个人密钥。"
                  : "GFS 未连接。请检查密钥或网络后重试。")),
          );
        } else {
          setError(null);
          setNeedsSetup(false);
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
  }, [healthKey, refreshConfigSummary]);

  const handleOpenPortal = useCallback(() => {
    void desktopApi.openExternal(portalUrl || "https://gfs.ihep.ac.cn/");
  }, [portalUrl]);

  /** 打开「配置密钥」：回填已保存的 $DRSAI_HOME/.env 凭证。 */
  const openCredentialForm = useCallback(async () => {
    setNeedsSetup(true);
    setError(null);
    setMessage(null);
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
      setError(`读取已保存配置失败：${raw}`);
    }
  }, []);

  const handleToggleEnabled = useCallback(async (nextEnabled: boolean) => {
    if (toggleBusy) return;
    setToggleBusy(true);
    setError(null);
    setMessage(null);
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
        setMessage(result.message || "已关闭 GFS 并清除配置。");
        setHealthKey((k) => k + 1);
        return;
      }
      // 开启：进入配置表单；保存成功后即启用并同步 Agent 工具配置
      await openCredentialForm();
      setMessage("请填写并保存 GFS 密钥以开启云盘与 Agent 工具。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggleBusy(false);
    }
  }, [toggleBusy, openCredentialForm]);

  const handleSaveSetup = useCallback(async () => {
    setSetupSaving(true);
    setError(null);
    setMessage(null);
    try {
      await desktopApi.startGateway();
      const result = await desktopApi.gfsSaveConfig({
        accessKey: setupAccessKey.trim(),
        secretKey: setupSecretKey.trim(),
        bucket: setupBucket.trim(),
        email: setupEmail.trim() || undefined,
      });
      setMessage(result.message || "GFS 密钥已保存");
      setNeedsSetup(false);
      setGfsEnabled(true);
      if (result.bucket) setBucketName(result.bucket);
      await refreshConfigSummary();
      setHealthKey((k) => k + 1);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      const detailMatch = raw.match(/\{.*"detail"\s*:\s*"([^"]+)"/);
      setError(detailMatch?.[1] || raw);
    } finally {
      setSetupSaving(false);
    }
  }, [setupAccessKey, setupSecretKey, setupBucket, setupEmail, refreshConfigSummary]);

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

  /** 仅重载目录树（上传/删除等内部调用，不关预览）。 */
  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  /** 用户点「刷新 / 重新加载」：先关右侧预览，再重载目录。 */
  const handleRefreshClick = useCallback(() => {
    setPreviewFile(null);
    triggerRefresh();
  }, [triggerRefresh]);
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
    if (!await requestAppDecision({ id: "delete-gfs-object", tone: "danger", title: isDir ? `删除文件夹“${name}”？` : `删除“${name}”？`, description: isDir ? "该文件夹及其全部内容将被删除。" : "该文件将被删除。", impact: "此操作不可恢复。", confirmLabel: "确认删除" })) return;
    setMessage(null);
    try {
      await desktopApi.gfsDelete({ path });
      setMessage(`已删除：${name}`);
      if (previewFile?.path === path) setPreviewFile(null);
      triggerRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [triggerRefresh, previewFile]);

  const handleDownload = useCallback(async (path: string) => {
    if (downloadingPath) return;
    const name = path.replace(/\/$/, "").split("/").pop() ?? path;
    setError(null);
    setMessage(null);
    setDownloadingPath(path);
    try {
      const r = await desktopApi.gfsDownloadToDisk({ path });
      if (r.canceled) return;
      setMessage(`下载完成：${name}`);
    } catch (e) {
      setError(`下载失败（${name}）：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloadingPath(null);
    }
  }, [downloadingPath]);

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

  /** 用户刷新收藏列表时同步关闭预览。 */
  const refreshFavorites = useCallback(() => {
    setPreviewFile(null);
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
          <button
            type="button"
            className="gfs-header-btn"
            data-testid="gfs-configure-credentials"
            onClick={() => void openCredentialForm()}
            title="填写或更新 GFS 密钥"
          >
            <span>配置密钥</span>
          </button>
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
              onClick={handleRefreshClick}
              disabled={loading}
              title="刷新当前目录"
            >
              <RotateCw className={`w-3.5 h-3.5${loading ? " gfs-spin" : ""}`} />
              <span>刷新</span>
            </button>
          )}
        </div>
      </div>

      <div className="gfs-manage-bar" data-testid="gfs-manage-bar">
        <label className="gfs-switch" title={gfsEnabled ? "关闭并清除 GFS 配置" : "开启 GFS（需配置密钥）"}>
          <input
            type="checkbox"
            checked={gfsEnabled || connStatus === "connected"}
            disabled={toggleBusy || connStatus === "checking"}
            onChange={(e) => { void handleToggleEnabled(e.target.checked); }}
          />
          <span className="gfs-switch-track" aria-hidden />
          <span className="gfs-switch-label">
            {gfsEnabled || connStatus === "connected" ? "GFS 已开启" : "GFS 已关闭"}
          </span>
        </label>
      </div>

      {/* content */}
      <div className="gfs-tab-content">
          {needsSetup ? (
            <div className="gfs-setup">
              <h3 className="gfs-setup-title">
                {connStatus === "connected" ? "更新 GFS 访问密钥" : "首次使用：配置 GFS 访问密钥"}
              </h3>
              <p className="gfs-setup-desc">
                请先在 GFS 网页创建或查看你的 Access Key / Secret Key 与存储桶，再填回本页。
                密钥保存在本机用户目录，无需编辑仓库 <code>.env</code>。
              </p>
              <ol className="gfs-setup-steps">
                <li>打开 GFS 控制台，进入「访问密钥」</li>
                <li>创建永久密钥或点击「显示密钥」复制 Access Key / Secret Key</li>
                <li>在「存储桶」页确认完整桶名（如 <code>20001-username</code>）</li>
                <li>将密钥填入下方并保存</li>
              </ol>
              <button type="button" className="gfs-setup-portal-btn" onClick={handleOpenPortal}>
                <ExternalLink className="w-4 h-4" />
                <span>打开 https://gfs.ihep.ac.cn/</span>
              </button>
              <div className="gfs-setup-form">
                <label className="gfs-setup-field">
                  <span>Access Key（访问密钥 ID）</span>
                  <span className="gfs-setup-hint">在 GFS 网页「显示密钥」中复制</span>
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
                  <span className="gfs-setup-hint">网页里的「凭据值」，与 Access Key 成对</span>
                  <div className="gfs-setup-secret-input">
                    <input
                      type={showSecretKey ? "text" : "password"}
                      autoComplete="new-password"
                      spellCheck={false}
                      value={setupSecretKey}
                      onChange={(e) => setSetupSecretKey(e.target.value)}
                      placeholder="显示密钥后复制凭据值"
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
                  <span>完整桶名（Bucket）</span>
                  <span className="gfs-setup-hint">
                    你的 GFS 存储空间名称，在侧栏「存储桶」页面。一般是「数字-用户名」，例如 20001-username，不要只填短名。
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
                  <span>邮箱（可选）</span>
                  <span className="gfs-setup-hint">用于标识，可用你的 IHEP 邮箱</span>
                  <input
                    type="email"
                    autoComplete="off"
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    placeholder="user@ihep.ac.cn"
                  />
                </label>
              </div>
              {error && <div className="gfs-setup-error">{error}</div>}
              {message && <div className="gfs-setup-message">{message}</div>}
              <div className="gfs-setup-actions">
                <button
                  type="button"
                  className="gfs-setup-save"
                  disabled={setupSaving || !setupAccessKey.trim() || !setupSecretKey.trim() || !setupBucket.trim()}
                  onClick={() => void handleSaveSetup()}
                >
                  {setupSaving ? "保存并检测中…" : "保存并连接"}
                </button>
                {connStatus === "connected" && (
                  <button
                    type="button"
                    className="gfs-header-btn"
                    onClick={() => {
                      setNeedsSetup(false);
                      setError(null);
                      setMessage(null);
                      setShowAccessKey(false);
                      setShowSecretKey(false);
                    }}
                  >
                    取消
                  </button>
                )}
              </div>
            </div>
          ) : (
          <>
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

          {downloadingPath && (
            <div className="gfs-banner info" role="status" aria-live="polite">
              <span className="gfs-banner-loading">
                <RotateCw className="w-3.5 h-3.5 gfs-spin" />
                正在下载：{downloadingPath.replace(/\/$/, "").split("/").pop() ?? downloadingPath}…
              </span>
            </div>
          )}
          {!downloadingPath && message && (
            <div className="gfs-banner success" role="status" aria-live="polite">
              <span>{message}</span>
              <button type="button" onClick={() => setMessage(null)} aria-label="关闭">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {!downloadingPath && error && (
            <div className="gfs-banner error">
              <span>{error}</span>
              <div className="gfs-banner-actions">
                {connStatus !== "connected" ? (
                  <button type="button" onClick={retryConnection}>重试</button>
                ) : (
                  <button type="button" onClick={handleRefreshClick}>重新加载</button>
                )}
                <button type="button" onClick={() => setError(null)} aria-label="关闭"><X className="w-3 h-3" /></button>
              </div>
            </div>
          )}

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
                          title={downloadingPath === item.path ? "下载中…" : downloadingPath ? "请等待当前下载完成" : "下载"}
                          disabled={Boolean(downloadingPath)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(item.path);
                          }}
                        >
                          {downloadingPath === item.path
                            ? <RotateCw className="w-3.5 h-3.5 gfs-spin" />
                            : <Download className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ))}
                  </div>
                  {previewFile && (
                    <PreviewPanel
                      file={previewFile}
                      onClose={() => setPreviewFile(null)}
                      onDownload={handleDownload}
                      downloading={downloadingPath === previewFile.path}
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
                      downloadingPath={downloadingPath}
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
                  downloading={downloadingPath === previewFile.path}
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
          </>
          )}
      </div>
    </div>
  );
}
