/**
 * Structured "canvas" payloads for the right-rail 产出物 tab.
 * Agents send JSON in the message body with metadata.type === "ui_canvas",
 * or (fallback) a message whose entire text body is that JSON object alone.
 */

export type UiCanvasStatTone = "default" | "success" | "warning" | "danger";

export type UiCanvasSection =
  | {
      kind: "markdown";
      title?: string;
      body: string;
    }
  | {
      kind: "stats";
      title?: string;
      items: Array<{ label: string; value: string; tone?: UiCanvasStatTone }>;
    }
  | {
      kind: "table";
      title?: string;
      headers: string[];
      rows: string[][];
    };

export type UiCanvasDocument = {
  version: 1;
  title: string;
  subtitle?: string;
  sections: UiCanvasSection[];
};

export type ParsedUiCanvasArtifact = {
  id: string;
  messageIndex: number;
  messageVersion?: number;
  doc: UiCanvasDocument;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") return null;
    out.push(x);
  }
  return out;
}

function parseSection(raw: unknown): UiCanvasSection | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (kind === "markdown") {
    const body = asString(raw.body);
    if (!body) return null;
    const title = asString(raw.title) ?? undefined;
    return { kind: "markdown", title, body };
  }
  if (kind === "stats") {
    const title = asString(raw.title) ?? undefined;
    const itemsRaw = raw.items;
    if (!Array.isArray(itemsRaw)) return null;
    const items: Array<{ label: string; value: string; tone?: UiCanvasStatTone }> = [];
    for (const it of itemsRaw) {
      if (!isRecord(it)) return null;
      const label = asString(it.label);
      const value = asString(it.value);
      if (!label || value === null) return null;
      const tone = asString(it.tone);
      const okTone: UiCanvasStatTone | undefined =
        tone === "success" || tone === "warning" || tone === "danger" || tone === "default"
          ? (tone as UiCanvasStatTone)
          : undefined;
      items.push({ label, value, tone: okTone });
    }
    return { kind: "stats", title, items };
  }
  if (kind === "table") {
    const title = asString(raw.title) ?? undefined;
    const headers = asStringArray(raw.headers);
    if (!headers?.length) return null;
    const rowsRaw = raw.rows;
    if (!Array.isArray(rowsRaw)) return null;
    const rows: string[][] = [];
    for (const row of rowsRaw) {
      const r = asStringArray(row);
      if (!r) return null;
      rows.push(r);
    }
    return { kind: "table", title, headers, rows };
  }
  return null;
}

/** Parse message content into a canvas document, or null if invalid. */
export function parseUiCanvasDocument(content: unknown): UiCanvasDocument | null {
  let obj: unknown = content;
  if (typeof content === "string") {
    try {
      obj = JSON.parse(content) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(obj)) return null;
  if (obj.version !== 1) return null;
  const title = asString(obj.title);
  if (!title) return null;
  const subtitle = asString(obj.subtitle) ?? undefined;
  const sectionsRaw = obj.sections;
  if (!Array.isArray(sectionsRaw)) return null;
  const sections: UiCanvasSection[] = [];
  for (const s of sectionsRaw) {
    const sec = parseSection(s);
    if (!sec) return null;
    sections.push(sec);
  }
  return { version: 1, title, subtitle, sections };
}

/** Optional stable id when the model includes `"canvas_id"` on the JSON root (ignored by layout parser). */
export function extractCanvasIdFromUiCanvasJsonString(content: string): string | null {
  try {
    const o = JSON.parse(content.trim()) as Record<string, unknown>;
    const c = o.canvas_id;
    return typeof c === "string" && c.trim() ? c.trim() : null;
  } catch {
    return null;
  }
}

/**
 * True when the entire message body is one JSON object that matches the ui_canvas schema
 * (no markdown fence, no leading prose). Lets 产出物 work without backend metadata.
 */
export function isStandaloneUiCanvasPayload(content: unknown): boolean {
  if (typeof content !== "string") return false;
  const s = content.trim();
  if (s.length < 35) return false;
  if (!s.startsWith("{") || !s.endsWith("}")) return false;
  return parseUiCanvasDocument(s) !== null;
}
