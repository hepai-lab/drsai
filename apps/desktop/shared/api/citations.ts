import type { CitationPart, StructuredPartStatus } from "./structuredConversation";

/**
 * Citation payloads carried on an OAEP assistant message.
 *
 * The wire schema types `citations` as an open object array, so this narrows it
 * on read rather than trusting it: a citation that cannot be resolved to a real
 * position is worse than no citation, because it looks sourced.
 */
export interface OaepCitationPayload {
  citation_id?: string;
  knowledge_base_id?: string;
  knowledge_base_revision?: string | number;
  document_id?: string;
  document_path?: string;
  document_sha256?: string;
  source?: string;
  title?: string;
  excerpt?: string;
  url?: string;
  path?: string;
  relation?: string;
  locator?: {
    kind?: string;
    label?: string;
    page?: number;
    line_start?: number;
    line_end?: number;
    slide?: number;
    sheet?: string;
    heading_path?: string[];
  };
}

/** Marker the grounded answering contract asks the model to attach: `[E3]`. */
const CITATION_MARKER = /\[E(\d{1,3})\]/g;

export function citationMarkerNumbers(markdown: string): number[] {
  if (!markdown) return [];
  const found: number[] = [];
  for (const match of markdown.matchAll(CITATION_MARKER)) {
    const value = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(value) && !found.includes(value)) found.push(value);
  }
  return found;
}

/**
 * Build a citation id that survives re-projection.
 *
 * The renderer links a paragraph to its citation by id, so an id that changed
 * between projections would silently break the jump back to the source.
 */
export function citationPartId(itemId: string, index: number, payload?: OaepCitationPayload): string {
  const declared = typeof payload?.citation_id === "string" ? payload.citation_id.trim() : "";
  return declared || `${itemId}:c${index}`;
}

export function locatorLabel(payload: OaepCitationPayload): string {
  const locator = payload.locator;
  if (!locator) return "";
  if (typeof locator.label === "string" && locator.label.trim()) return locator.label.trim();
  if (typeof locator.page === "number") return `p.${locator.page}`;
  if (typeof locator.slide === "number") return `slide ${locator.slide}`;
  if (typeof locator.sheet === "string" && locator.sheet) return locator.sheet;
  if (Array.isArray(locator.heading_path) && locator.heading_path.length) {
    return locator.heading_path.join(" > ");
  }
  if (typeof locator.line_start === "number") {
    const end = typeof locator.line_end === "number" ? locator.line_end : locator.line_start;
    return end > locator.line_start ? `L${locator.line_start}-${end}` : `L${locator.line_start}`;
  }
  return "";
}

function citationTitle(payload: OaepCitationPayload): string {
  const candidates = [payload.title, payload.document_path, payload.source, payload.url];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Source";
}

/**
 * Turn raw citation payloads into renderable parts bound to their paragraph.
 *
 * `markdownPartId` is what lets the reader go from a source back to the
 * sentence that used it; without it the relation is one-way and a citation
 * cannot be checked against the claim it supports.
 */
export function projectCitationParts(
  itemId: string,
  raw: unknown,
  status: StructuredPartStatus,
  markdownPartId: string,
): CitationPart[] {
  if (!Array.isArray(raw)) return [];
  const parts: CitationPart[] = [];
  raw.forEach((value, index) => {
    if (!value || typeof value !== "object") return;
    const payload = value as OaepCitationPayload;
    const target = typeof payload.path === "string" && payload.path.trim()
      ? payload.path.trim()
      : typeof payload.document_path === "string" && payload.document_path.trim()
        ? payload.document_path.trim()
        : undefined;
    const url = typeof payload.url === "string" && payload.url.trim() ? payload.url.trim() : undefined;
    if (!target && !url) return;
    const locator = locatorLabel(payload);
    const excerpt = typeof payload.excerpt === "string" && payload.excerpt.trim()
      ? payload.excerpt.trim()
      : undefined;
    parts.push({
      id: `${itemId}:citation:${index + 1}`,
      kind: "citation",
      status,
      citationId: citationPartId(itemId, index + 1, payload),
      title: citationTitle(payload),
      ...(target ? { path: target } : {}),
      ...(url ? { url } : {}),
      ...(locator ? { locator } : {}),
      ...(excerpt ? { excerpt } : {}),
      markdownPartId,
    });
  });
  return parts;
}

/**
 * Pick the citations a paragraph points at.
 *
 * Falls back to every citation when the text carries no markers: a refusal
 * still has to show the scope it searched, and dropping the link there would
 * leave it looking unsourced.
 */
export function citationIdsForMarkdown(markdown: string, citations: CitationPart[]): string[] {
  if (!citations.length) return [];
  const markers = citationMarkerNumbers(markdown);
  if (!markers.length) return citations.map((part) => part.citationId);
  const referenced = markers
    .map((marker) => citations[marker - 1]?.citationId)
    .filter((value): value is string => Boolean(value));
  return referenced.length ? referenced : citations.map((part) => part.citationId);
}
