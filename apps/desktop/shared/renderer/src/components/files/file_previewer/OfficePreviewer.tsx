import {
  ChevronLeft,
  ChevronRight,
  FileType2,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import React, { useEffect, useId, useRef, useState } from "react";
import { MetadataPreviewer } from "./MetadataPreviewer";
import type { PreviewerProps } from "./types";

/* ─── types ────────────────────────────────────────────────────────────────── */

interface ExcelSheetGrid {
  name: string;
  rows: string[][];
  colCount: number;
}

type RenderState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "docx" }
  | { phase: "pptx-layout"; slideCount: number }
  | { phase: "xlsx-ui"; sheets: ExcelSheetGrid[]; active: number }
  | { phase: "text" };

/* ─── helpers ────────────────────────────────────────────────────────────────── */

function getOfficeExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Prefer decoding data URLs directly — `fetch(data:...)` is unreliable in Electron. */
function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/**
 * pptx-preview 1.0.7 calls Object.keys() on p:defaultTextStyle.
 * Some generators omit this optional OOXML element and crash the viewer.
 */
async function ensurePptxDefaultTextStyle(arrayBuffer: ArrayBuffer): Promise<ArrayBuffer> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(arrayBuffer);
    const xmlFile = zip.file("ppt/presentation.xml");
    if (!xmlFile) return arrayBuffer;
    const xml = await xmlFile.async("string");
    if (/<p:defaultTextStyle[\s/>]/.test(xml) || !xml.includes("</p:presentation>")) {
      return arrayBuffer;
    }
    zip.file(
      "ppt/presentation.xml",
      xml.replace("</p:presentation>", "  <p:defaultTextStyle/>\n</p:presentation>"),
    );
    return zip.generateAsync({ type: "arraybuffer" });
  } catch {
    return arrayBuffer;
  }
}

function columnLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

const DOCX_RENDER_OPTIONS = {
  className: "docx-preview",
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  breakPages: true,
  useBase64URL: true,
} as const;

const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;
const EXCEL_MAX_ROWS = 500;
const EXCEL_MAX_COLS = 64;
const PPTX_THUMB_SCALE_FALLBACK = 0.14;

/** Top-level pptx-preview slides only (ignore nested wrappers inside a slide). */
function collectPptxSlideNodes(stage: HTMLElement): HTMLElement[] {
  return Array.from(stage.querySelectorAll<HTMLElement>(".pptx-preview-slide-wrapper"))
    .filter((slide) => !slide.parentElement?.closest(".pptx-preview-slide-wrapper"));
}

/** Build a PowerPoint-like left thumbnail rail from rendered slide nodes. */
function mountPptxThumbnails(
  stage: HTMLElement,
  thumbs: HTMLElement,
  isZh: boolean,
): () => void {
  const slides = collectPptxSlideNodes(stage);
  const scrollRoot = (stage.closest(".files-preview-office-pptx-stage") as HTMLElement | null) ?? stage;
  thumbs.replaceChildren();
  const buttons: HTMLButtonElement[] = [];
  let activeIndex = 0;
  /** Ignore scroll-driven highlight updates while a thumb click is settling. */
  let suppressScrollSyncUntil = 0;
  let clickSettleTimer: number | null = null;
  /** Keep the clicked thumb until the user scrolls the stage manually. */
  let pinnedClickIndex: number | null = null;

  function setActive(index: number, options?: { scrollThumb?: boolean }): void {
    if (index < 0 || index >= buttons.length) return;
    activeIndex = index;
    buttons.forEach((item, buttonIndex) => {
      item.classList.toggle("active", buttonIndex === index);
    });
    if (options?.scrollThumb) {
      buttons[index]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  /** Prefer the slide whose top edge is nearest the stage's top reading anchor. */
  function syncActiveFromScroll(): void {
    if (Date.now() < suppressScrollSyncUntil) return;
    if (slides.length === 0) return;
    if (pinnedClickIndex !== null) {
      setActive(pinnedClickIndex, { scrollThumb: true });
      return;
    }

    const rootRect = scrollRoot.getBoundingClientRect();
    const anchor = rootRect.top + Math.min(56, Math.max(12, scrollRoot.clientHeight * 0.12));
    let next = 0;
    for (let index = 0; index < slides.length; index += 1) {
      const top = slides[index]!.getBoundingClientRect().top;
      if (top <= anchor + 1) next = index;
      else break;
    }
    if (next !== activeIndex) setActive(next, { scrollThumb: true });
  }

  slides.forEach((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `files-preview-pptx-thumb${index === 0 ? " active" : ""}`;
    button.setAttribute("aria-label", isZh ? `幻灯片 ${index + 1}` : `Slide ${index + 1}`);

    const indexLabel = document.createElement("span");
    indexLabel.className = "files-preview-pptx-thumb-index";
    indexLabel.textContent = String(index + 1);

    const frame = document.createElement("div");
    frame.className = "files-preview-pptx-thumb-frame";
    const clone = slide.cloneNode(true) as HTMLElement;
    clone.classList.add("files-preview-pptx-thumb-clone");
    clone.querySelectorAll("button, a, input, textarea").forEach((node) => {
      node.setAttribute("tabindex", "-1");
    });
    frame.appendChild(clone);
    button.append(indexLabel, frame);
    button.addEventListener("click", () => {
      // Pin the clicked page: last slides often cannot scroll to the stage top,
      // so a settle-time resync would otherwise snap the highlight backward.
      pinnedClickIndex = index;
      suppressScrollSyncUntil = Date.now() + 900;
      if (clickSettleTimer !== null) window.clearTimeout(clickSettleTimer);
      setActive(index, { scrollThumb: true });
      slide.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
      clickSettleTimer = window.setTimeout(() => {
        clickSettleTimer = null;
        suppressScrollSyncUntil = 0;
        setActive(index, { scrollThumb: true });
      }, 920);
    });
    thumbs.appendChild(button);
    buttons.push(button);

    window.requestAnimationFrame(() => {
      const naturalWidth = clone.offsetWidth || slide.offsetWidth || 960;
      const frameWidth = frame.clientWidth || 110;
      const scale = naturalWidth > 0 ? frameWidth / naturalWidth : PPTX_THUMB_SCALE_FALLBACK;
      clone.style.transform = `scale(${scale})`;
      clone.style.transformOrigin = "top left";
      frame.style.height = `${Math.max(62, Math.round((naturalWidth * 9) / 16 * scale))}px`;
    });
  });

  const releasePinFromUserScroll = (): void => {
    pinnedClickIndex = null;
  };

  scrollRoot.addEventListener("wheel", releasePinFromUserScroll, { passive: true });
  scrollRoot.addEventListener("pointerdown", releasePinFromUserScroll, { passive: true });
  scrollRoot.addEventListener("scroll", syncActiveFromScroll, { passive: true });
  window.requestAnimationFrame(() => syncActiveFromScroll());

  return () => {
    if (clickSettleTimer !== null) window.clearTimeout(clickSettleTimer);
    scrollRoot.removeEventListener("wheel", releasePinFromUserScroll);
    scrollRoot.removeEventListener("pointerdown", releasePinFromUserScroll);
    scrollRoot.removeEventListener("scroll", syncActiveFromScroll);
    thumbs.replaceChildren();
  };
}

async function parseWorkbookToSheets(arrayBuffer: ArrayBuffer): Promise<ExcelSheetGrid[]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return { name, rows: [], colCount: 0 };
    const ref = sheet["!ref"];
    if (!ref) return { name, rows: [], colCount: 0 };
    const range = XLSX.utils.decode_range(ref);
    const endRow = Math.min(range.e.r, range.s.r + EXCEL_MAX_ROWS - 1);
    const endCol = Math.min(range.e.c, range.s.c + EXCEL_MAX_COLS - 1);
    const colCount = Math.max(0, endCol - range.s.c + 1);
    const rows: string[][] = [];
    for (let row = range.s.r; row <= endRow; row += 1) {
      const cells: string[] = [];
      for (let col = range.s.c; col <= endCol; col += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const cell = sheet[address];
        if (!cell) {
          cells.push("");
          continue;
        }
        const formatted = XLSX.utils.format_cell(cell);
        cells.push(formatted ?? (typeof cell !== "string" && cell.w != null ? String(cell.w) : typeof cell !== "string" && cell.v != null ? String(cell.v) : ""));
      }
      rows.push(cells);
    }
    return { name, rows, colCount };
  });
}

/* ─── Excel workbook UI ─────────────────────────────────────────────────────── */

function ExcelWorkbookPreview({
  sheets,
  active,
  onSelectSheet,
  language,
}: {
  sheets: ExcelSheetGrid[];
  active: number;
  onSelectSheet: (index: number) => void;
  language: PreviewerProps["language"];
}): React.JSX.Element {
  const isZh = language === "zh";
  const sheet = sheets[active] ?? sheets[0];
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const selectedValue = selected && sheet
    ? (sheet.rows[selected.row]?.[selected.col] ?? "")
    : "";
  const selectedAddress = selected
    ? `${columnLabel(selected.col)}${selected.row + 1}`
    : "";

  useEffect(() => {
    setSelected(null);
  }, [active, sheet?.name]);

  if (!sheet) {
    return <div className="files-preview-office-error"><p>{isZh ? "工作簿为空" : "Workbook is empty"}</p></div>;
  }

  const colCount = Math.max(sheet.colCount, 1);
  const headers = Array.from({ length: colCount }, (_, index) => columnLabel(index));

  return (
    <div className="files-preview-excel">
      <div className="files-preview-excel-formula" aria-label={isZh ? "编辑栏" : "Formula bar"}>
        <span className="files-preview-excel-address">{selectedAddress || "—"}</span>
        <input
          className="files-preview-excel-formula-input"
          readOnly
          value={selectedValue}
          placeholder={isZh ? "选择单元格查看内容" : "Select a cell to inspect"}
          aria-label={isZh ? "单元格内容" : "Cell value"}
        />
      </div>
      <div className="files-preview-excel-grid-scroll">
        <table className="files-preview-excel-grid">
          <thead>
            <tr>
              <th className="files-preview-excel-corner" scope="col" />
              {headers.map((label) => (
                <th key={label} scope="col">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.length === 0 ? (
              <tr>
                <th scope="row">1</th>
                {headers.map((label) => <td key={label} />)}
              </tr>
            ) : sheet.rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                <th scope="row">{rowIdx + 1}</th>
                {headers.map((_, colIdx) => {
                  const activeCell = selected?.row === rowIdx && selected?.col === colIdx;
                  return (
                    <td
                      key={colIdx}
                      className={activeCell ? "selected" : undefined}
                      onClick={() => setSelected({ row: rowIdx, col: colIdx })}
                    >
                      {row[colIdx] ?? ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="files-preview-excel-tabs" role="tablist" aria-label={isZh ? "工作表" : "Sheets"}>
        {sheets.map((item, index) => (
          <button
            key={`${item.name}-${index}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            className={index === active ? "active" : undefined}
            onClick={() => onSelectSheet(index)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {sheet.rows.length >= EXCEL_MAX_ROWS || sheet.colCount >= EXCEL_MAX_COLS ? (
        <p className="files-preview-excel-truncated">
          {isZh
            ? `预览已限制为前 ${EXCEL_MAX_ROWS} 行 / ${EXCEL_MAX_COLS} 列，完整内容请用系统应用打开。`
            : `Preview limited to the first ${EXCEL_MAX_ROWS} rows / ${EXCEL_MAX_COLS} columns. Open with the system app for the full workbook.`}
        </p>
      ) : null}
    </div>
  );
}

/* ─── main component ────────────────────────────────────────────────────────── */

export function OfficePreviewer(props: PreviewerProps): React.JSX.Element {
  const { preview, language } = props;
  const isZh = language === "zh";
  const pptxThumbsId = useId();
  const docxContainerRef = useRef<HTMLDivElement>(null);
  const pptContainerRef = useRef<HTMLDivElement>(null);
  const pptThumbsRef = useRef<HTMLDivElement>(null);
  const pptThumbsCleanupRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<RenderState>({ phase: "loading" });
  const [renderError, setRenderError] = useState<string | null>(null);
  const [userZoom, setUserZoom] = useState(1);
  const [pptxThumbsCollapsed, setPptxThumbsCollapsed] = useState(false);

  const ext = getOfficeExtension(preview.path || preview.name);
  const isPptxExt = ext === ".pptx" || ext === ".ppt";
  const showPptxLayout =
    isPptxExt
    && (state.phase === "pptx-layout" || state.phase === "loading");
  const showZoomControls = state.phase === "docx" || state.phase === "pptx-layout";

  useEffect(() => {
    setUserZoom(1);
    setPptxThumbsCollapsed(false);
  }, [preview.dataUrl, preview.path, preview.name]);

  useEffect(() => {
    if (!preview.dataUrl && !preview.content) {
      setState({ phase: "error", message: isZh ? "没有可预览的内容。" : "No content available for preview." });
      setRenderError(null);
      return;
    }

    if (preview.dataUrl) {
      let cancelled = false;
      setState({ phase: "loading" });
      setRenderError(null);

      (async () => {
        try {
          const arrayBuffer = dataUrlToArrayBuffer(preview.dataUrl!);
          if (cancelled) return;

          if (ext === ".docx" || ext === ".doc") {
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            if (cancelled) return;
            const container = docxContainerRef.current;
            if (!container) {
              setState({ phase: "error", message: isZh ? "预览区域尚未就绪。" : "Preview surface is not ready." });
              return;
            }
            container.innerHTML = "";
            const { renderAsync } = await import("docx-preview");
            await renderAsync(arrayBuffer, container, undefined, DOCX_RENDER_OPTIONS);
            if (cancelled) return;
            setState({ phase: "docx" });
            return;
          }

          if (ext === ".pptx" || ext === ".ppt") {
            // Legacy .ppt is OLE binary — layout viewer only supports OOXML .pptx.
            if (ext === ".ppt") {
              throw new Error(isZh
                ? "旧版 .ppt 暂不支持完整幻灯片版式，请另存为 .pptx 或用系统应用打开。"
                : "Legacy .ppt does not support full slide layout preview. Save as .pptx or open with the system app.");
            }

            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            if (cancelled) return;
            const stage = pptContainerRef.current;
            const thumbs = pptThumbsRef.current;
            if (!stage) {
              setState({ phase: "error", message: isZh ? "预览区域尚未就绪。" : "Preview surface is not ready." });
              return;
            }
            stage.innerHTML = "";
            if (thumbs) thumbs.replaceChildren();
            pptThumbsCleanupRef.current?.();
            pptThumbsCleanupRef.current = null;

            // Mislabelled Word packages still arrive as .pptx.
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(arrayBuffer);
            const entryNames = Object.keys(zip.files);
            if (entryNames.some((name) => name === "word/document.xml")) {
              const docxContainer = docxContainerRef.current;
              if (!docxContainer) {
                setState({ phase: "error", message: isZh ? "预览区域尚未就绪。" : "Preview surface is not ready." });
                return;
              }
              docxContainer.innerHTML = "";
              const { renderAsync } = await import("docx-preview");
              await renderAsync(arrayBuffer, docxContainer, undefined, DOCX_RENDER_OPTIONS);
              if (cancelled) return;
              setState({ phase: "docx" });
              return;
            }

            const width = Math.max(480, Math.min(960, Math.floor(stage.clientWidth || 960)));
            const height = Math.round((width * 9) / 16);
            const { init } = await import("pptx-preview");
            const previewer = init(stage, { width, height, mode: "list" });
            const previewBuffer = await ensurePptxDefaultTextStyle(arrayBuffer);
            await previewer.preview(previewBuffer);
            const wrapper = stage.querySelector(".pptx-preview-wrapper") as HTMLElement | null;
            if (wrapper) {
              wrapper.style.height = "auto";
              wrapper.style.overflow = "visible";
            }
            if (cancelled) return;
            const slideCount = collectPptxSlideNodes(stage).length;
            if (thumbs) {
              pptThumbsCleanupRef.current = mountPptxThumbnails(stage, thumbs, isZh);
            }
            setState({ phase: "pptx-layout", slideCount });
            return;
          }

          if (ext === ".xlsx" || ext === ".xls") {
            const sheets = await parseWorkbookToSheets(arrayBuffer);
            if (cancelled) return;
            if (sheets.length === 0) {
              setState({ phase: "error", message: isZh ? "无法解析该工作簿。" : "Could not parse this workbook." });
              return;
            }
            setState({ phase: "xlsx-ui", sheets, active: 0 });
            return;
          }

          if (!cancelled) {
            setState({
              phase: "error",
              message: isZh ? "此 Office 格式暂无内联版式预览。" : "This Office format has no inline layout preview.",
            });
          }
        } catch (error) {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setRenderError(message);
          if (preview.content) {
            setState({ phase: "text" });
          } else {
            setState({
              phase: "error",
              message: isZh ? `版式预览失败：${message}` : `Layout preview failed: ${message}`,
            });
          }
        }
      })();

      return () => {
        cancelled = true;
        pptThumbsCleanupRef.current?.();
        pptThumbsCleanupRef.current = null;
        if (pptContainerRef.current) pptContainerRef.current.innerHTML = "";
        if (pptThumbsRef.current) pptThumbsRef.current.replaceChildren();
      };
    }

    if (preview.content) {
      setState({ phase: "text" });
      setRenderError(null);
    } else {
      setState({ phase: "error", message: isZh ? "没有可预览的内容。" : "No content available for preview." });
      setRenderError(null);
    }
    return;
  }, [preview.dataUrl, preview.content, ext, isZh]);

  const excelActive = state.phase === "xlsx-ui" ? state.active : 0;
  const excelSheets = state.phase === "xlsx-ui" ? state.sheets : [];

  return (
    <div className="files-preview-office">
      {state.phase === "text" ? (
        <p className="files-preview-office-msg">
          {renderError
            ? (isZh ? "版式预览失败 — 显示提取文本" : "Layout preview failed — showing extracted text")
            : (preview.message || (isZh ? "提取文本预览" : "Extracted text preview"))}
        </p>
      ) : null}

      {showZoomControls ? (
        <div className="files-preview-zoom files-preview-zoom-float" role="group" aria-label="Zoom">
          <button
            type="button"
            className="files-preview-zoom-btn"
            title="Zoom out"
            aria-label="Zoom out"
            disabled={userZoom <= ZOOM_MIN}
            onClick={() => setUserZoom((zoom) => Math.max(ZOOM_MIN, Number((zoom - ZOOM_STEP).toFixed(2))))}
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className="files-preview-zoom-label"
            title="Reset to 100%"
            aria-label={`Zoom ${Math.round(userZoom * 100)} percent. Click to reset.`}
            onClick={() => setUserZoom(1)}
          >
            {Math.round(userZoom * 100)}%
          </button>
          <button
            type="button"
            className="files-preview-zoom-btn"
            title="Zoom in"
            aria-label="Zoom in"
            disabled={userZoom >= ZOOM_MAX}
            onClick={() => setUserZoom((zoom) => Math.min(ZOOM_MAX, Number((zoom + ZOOM_STEP).toFixed(2))))}
          >
            <ZoomIn size={14} />
          </button>
        </div>
      ) : null}

      {state.phase === "loading" && (
        <div className="files-preview-office-loading">
          <RotateCw size={24} className="files-preview-spin" />
          <p>{isZh ? "正在渲染 Office 文档…" : "Rendering office document…"}</p>
        </div>
      )}

      {state.phase === "error" && (
        <div className="files-preview-office-error">
          <FileType2 size={24} />
          <p>{state.message}</p>
        </div>
      )}

      {/* Keep docx mount for mislabelled pptx→docx fallback; hide via [hidden] CSS. */}
      <div className="files-preview-office-docx" hidden={state.phase !== "docx"}>
        <div
          ref={docxContainerRef}
          className="files-preview-office-docx-canvas"
          style={{ zoom: userZoom }}
        />
      </div>

      {/* Only mount PPT chrome for ppt(x) — avoids Excel inheriting the gray stage. */}
      {isPptxExt ? (
        <div
          className={`files-preview-office-pptx-layout${pptxThumbsCollapsed ? " is-thumbs-collapsed" : ""}`}
          hidden={!showPptxLayout}
        >
          <aside
            id={pptxThumbsId}
            ref={pptThumbsRef}
            className="files-preview-pptx-thumbs"
            aria-label={isZh ? "幻灯片缩略图" : "Slide thumbnails"}
            hidden={pptxThumbsCollapsed}
          />
          <div className="files-preview-office-pptx-stage">
            <button
              type="button"
              className="files-preview-pptx-thumbs-toggle"
              aria-expanded={!pptxThumbsCollapsed}
              aria-controls={pptxThumbsId}
              title={pptxThumbsCollapsed
                ? (isZh ? "展开幻灯片导航" : "Expand slide navigator")
                : (isZh ? "收起幻灯片导航" : "Collapse slide navigator")}
              onClick={() => setPptxThumbsCollapsed((collapsed) => !collapsed)}
            >
              {pptxThumbsCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
            <div
              ref={pptContainerRef}
              className="files-preview-office-pptx-canvas"
              style={state.phase === "pptx-layout" ? { zoom: userZoom } : undefined}
            />
          </div>
        </div>
      ) : null}

      {state.phase === "xlsx-ui" ? (
        <ExcelWorkbookPreview
          sheets={excelSheets}
          active={excelActive}
          language={language}
          onSelectSheet={(index) => setState({ phase: "xlsx-ui", sheets: excelSheets, active: index })}
        />
      ) : null}

      {state.phase === "text" && preview.content ? (
        <pre className="files-preview-code">{preview.content}</pre>
      ) : null}

      {state.phase === "error" && !preview.dataUrl && !preview.content ? (
        <MetadataPreviewer language={language} preview={preview} />
      ) : null}
    </div>
  );
}
