import { FileType2, FileSpreadsheet, Presentation, FileText, RotateCw } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { MetadataPreviewer } from "./MetadataPreviewer";
import type { PreviewerProps } from "./types";

/* ─── types ────────────────────────────────────────────────────────────────── */

interface PptxSlide { index: number; text: string; }
interface XlsxSheet { name: string; rows: string[][]; }

type RenderState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "docx" }
  | { phase: "pptx"; slides: PptxSlide[] }
  | { phase: "xlsx"; sheets: XlsxSheet[] }
  | { phase: "text" };

/* ─── helpers ────────────────────────────────────────────────────────────────── */

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function extractPptxSlideText(xml: string): string {
  const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((m) => decodeXmlEntities(m[1] ?? "").trim())
    .filter(Boolean);
  return runs.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function getOfficeExtension(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** Extract text runs from a sheet XML cell. */
function extractCellText(xml: string): string {
  const runs = [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)]
    .map((m) => decodeXmlEntities(m[1] ?? "").trim())
    .filter(Boolean);
  return runs.join("");
}

/** Parse sharedStrings.xml to get the string table. */
function parseSharedStrings(xml: string): string[] {
  const matches = [...xml.matchAll(/<si\b[\s\S]*?<\/si>/g)];
  return matches.map((si) => extractCellText(si[0]));
}

/** Parse a worksheet XML into rows of cell values. */
function parseWorksheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: string[][] = [];
  const rowMatches = [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)];
  for (const rowMatch of rowMatches) {
    const rowXml = rowMatch[1] ?? "";
    const cells: string[] = [];
    const cellMatches = [...rowXml.matchAll(/<c\b[^>]*?(?:\bt="([^"]*)")?[^>]*>(?:<v>([^<]*)<\/v>)?/g)];
    for (const cellMatch of cellMatches) {
      const type = cellMatch[1] ?? "";
      const value = cellMatch[2] ?? "";
      if (type === "s" && sharedStrings[Number(value)]) {
        cells.push(sharedStrings[Number(value)]);
      } else if (value) {
        cells.push(value);
      } else {
        cells.push("");
      }
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

/* ─── main component ────────────────────────────────────────────────────────── */

export function OfficePreviewer(props: PreviewerProps): React.JSX.Element {
  const { preview } = props;
  // Container is always rendered so docx-preview can write to it during useEffect.
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RenderState>({ phase: "loading" });

  const ext = getOfficeExtension(preview.path);

  useEffect(() => {
    if (!preview.dataUrl && !preview.content) {
      setState({ phase: "error", message: "No content available for preview." });
      return;
    }

    // If we have raw bytes, attempt rich rendering.
    if (preview.dataUrl) {
      let cancelled = false;
      setState({ phase: "loading" });

      (async () => {
        try {
          // Convert dataUrl to ArrayBuffer.
          const response = await fetch(preview.dataUrl);
          const arrayBuffer = await response.arrayBuffer();
          if (cancelled) return;

          if (ext === ".docx" || ext === ".doc") {
            // Wait one frame so the container div is mounted.
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (cancelled) return;
            const container = containerRef.current;
            if (!container) { setState({ phase: "text" }); return; }
            container.innerHTML = "";
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
            if (!cancelled) setState({ phase: "docx" });
            return;
          }

          if (ext === ".pptx" || ext === ".ppt") {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(arrayBuffer);
            const entryNames = Object.keys(zip.files).filter((n) => !n.endsWith("/"));

            // Check if it's actually a docx mislabelled as pptx.
            const isActuallyDocx = entryNames.some((n) => n === "word/document.xml");
            if (isActuallyDocx) {
              await new Promise((resolve) => requestAnimationFrame(resolve));
              if (cancelled) return;
              const container = containerRef.current;
              if (!container) { setState({ phase: "text" }); return; }
              container.innerHTML = "";
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
              if (!cancelled) setState({ phase: "docx" });
              return;
            }

            // Extract slides.
            const slideEntries = entryNames
              .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
              .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

            const slides: PptxSlide[] = [];
            for (const name of slideEntries) {
              const match = name.match(/slide(\d+)\.xml$/i);
              const index = match ? Number.parseInt(match[1], 10) : slides.length + 1;
              const xml = await zip.files[name].async("string");
              slides.push({ index, text: extractPptxSlideText(xml) });
            }

            if (slides.length > 0 && !cancelled) {
              setState({ phase: "pptx", slides });
            } else if (!cancelled) {
              setState({ phase: "text" });
            }
            return;
          }

          if (ext === ".xlsx" || ext === ".xls") {
            const JSZip = (await import("jszip")).default;
            const zip = await JSZip.loadAsync(arrayBuffer);
            const entryNames = Object.keys(zip.files).filter((n) => !n.endsWith("/"));

            // Parse shared strings.
            const ssFile = entryNames.find((n) => n === "xl/sharedStrings.xml");
            const sharedStrings = ssFile
              ? parseSharedStrings(await zip.files[ssFile].async("string"))
              : [];

            // Parse worksheets.
            const sheetEntries = entryNames
              .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n))
              .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

            const sheets: XlsxSheet[] = [];
            for (const name of sheetEntries) {
              const xml = await zip.files[name].async("string");
              const rows = parseWorksheet(xml, sharedStrings);
              sheets.push({ name: name.replace(/^xl\/worksheets\//, "").replace(/\.xml$/i, ""), rows });
            }

            // Also try to get sheet names from workbook.xml.
            const workbookXml = entryNames.find((n) => n === "xl/workbook.xml");
            let sheetNames: string[] = [];
            if (workbookXml) {
              const wbContent = await zip.files[workbookXml].async("string");
              sheetNames = [...wbContent.matchAll(/<sheet\b[^>]*?\bname="([^"]*)"[^>]*>/g)]
                .map((m) => decodeXmlEntities(m[1] ?? ""));
            }

            if (sheets.length > 0 && !cancelled) {
              sheets.forEach((s, i) => { s.name = sheetNames[i] ?? s.name; });
              setState({ phase: "xlsx", sheets });
            } else if (!cancelled) {
              setState({ phase: "text" });
            }
            return;
          }

          // Unknown office type — fall back to text.
          if (!cancelled) setState({ phase: "text" });
        } catch {
          if (!cancelled) setState({ phase: "text" });
        }
      })();

      return () => { cancelled = true; };
    }

    // No raw data — use plain text content.
    if (preview.content) {
      setState({ phase: "text" });
    } else {
      setState({ phase: "error", message: "No content available for preview." });
    }
  }, [preview.dataUrl, preview.content, ext]);

  /* ─── render ──────────────────────────────────────────────────────────────── */

  const icon = ext === ".xlsx" || ext === ".xls"
    ? <FileSpreadsheet size={13} />
    : ext === ".pptx" || ext === ".ppt"
      ? <Presentation size={13} />
      : <FileText size={13} />;

  return (
    <div className="files-preview-office">
      <div className="files-preview-subtoolbar">
        <span>{icon} {preview.name}</span>
        {preview.message ? <span className="files-preview-office-msg">{preview.message}</span> : null}
        {state.phase === "loading" ? <span><RotateCw size={12} className="files-preview-spin" /> Rendering…</span> : null}
        {state.phase === "docx" ? <span><FileType2 size={12} /> Rich preview</span> : null}
        {state.phase === "pptx" && "slides" in state ? <span><Presentation size={12} /> {state.slides.length} slides</span> : null}
        {state.phase === "xlsx" && "sheets" in state ? <span><FileSpreadsheet size={12} /> {state.sheets.length} sheets</span> : null}
      </div>

      {/* Loading */}
      {state.phase === "loading" && (
        <div className="files-preview-office-loading">
          <RotateCw size={24} className="files-preview-spin" />
          <p>Rendering office document…</p>
        </div>
      )}

      {/* Error */}
      {state.phase === "error" && (
        <div className="files-preview-office-error">
          <FileType2 size={24} />
          <p>{state.message}</p>
        </div>
      )}

      {/* Rich docx rendering — container always mounted, hidden when not active */}
      <div
        ref={containerRef}
        className="files-preview-office-docx"
        style={{ display: state.phase === "docx" ? "block" : "none" }}
      />

      {/* PPTX slide preview */}
      {state.phase === "pptx" && "slides" in state && (
        <div className="files-preview-office-pptx">
          {state.slides.map((slide) => (
            <article key={slide.index} className="files-preview-pptx-slide">
              <header className="files-preview-pptx-slide-label">Slide {slide.index}</header>
              {slide.text ? (
                <pre className="files-preview-pptx-slide-text">{slide.text}</pre>
              ) : (
                <p className="files-preview-pptx-slide-empty">(No text content on this slide)</p>
              )}
            </article>
          ))}
        </div>
      )}

      {/* XLSX table preview */}
      {state.phase === "xlsx" && "sheets" in state && (
        <div className="files-preview-office-xlsx">
          {state.sheets.map((sheet, sheetIdx) => (
            <div key={sheetIdx} className="files-preview-xlsx-sheet">
              <header className="files-preview-xlsx-sheet-label">{sheet.name}</header>
              <div className="files-preview-xlsx-table-wrap">
                <table className="files-preview-xlsx-table">
                  <tbody>
                    {sheet.rows.slice(0, 200).map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        {row.length > 0 ? row.map((cell, cellIdx) => (
                          <td key={cellIdx}>{cell}</td>
                        )) : <td>&nbsp;</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sheet.rows.length > 200 ? (
                <p className="files-preview-xlsx-truncated">…{sheet.rows.length - 200} more rows</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Plain text fallback */}
      {state.phase === "text" && preview.content && (
        <pre className="files-preview-code">{preview.content}</pre>
      )}

      {/* Metadata fallback when no content at all */}
      {state.phase === "text" && !preview.content && (
        <MetadataPreviewer {...props} />
      )}
    </div>
  );
}
