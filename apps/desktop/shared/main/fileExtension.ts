import { basename, extname, join } from "path";

/** Extensions the desktop host can classify / open by association. */
export const CANONICAL_FILE_EXTENSIONS = [
  ".pptx",
  ".docx",
  ".xlsx",
  ".ppt",
  ".doc",
  ".xls",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".md",
  ".mdx",
  ".json",
  ".csv",
  ".tsv",
  ".html",
  ".htm",
  ".ipynb",
  ".txt",
  ".rtf",
  ".zip",
] as const;

const KNOWN = new Set<string>(CANONICAL_FILE_EXTENSIONS);

/**
 * Resolve a usable file extension even when display text was appended after a
 * real suffix (e.g. `Deck.pptx（3页介绍）` → `.pptx`).
 */
export function resolveCanonicalExtension(filePath: string): string {
  const direct = extname(filePath).toLowerCase();
  if (KNOWN.has(direct)) return direct;

  const base = basename(filePath).toLowerCase();
  const ordered = [...CANONICAL_FILE_EXTENSIONS].sort((a, b) => b.length - a.length);
  for (const ext of ordered) {
    const idx = base.lastIndexOf(ext);
    if (idx < 0) continue;
    const after = base.slice(idx + ext.length);
    if (after.length > 0) return ext;
  }
  return direct;
}

/** Basename truncated to the canonical extension (drops trailing junk). */
export function basenameWithCanonicalExtension(filePath: string): string {
  const ext = resolveCanonicalExtension(filePath);
  const base = basename(filePath);
  if (!ext) return base;
  const lower = base.toLowerCase();
  const idx = lower.lastIndexOf(ext);
  if (idx >= 0) return base.slice(0, idx + ext.length);
  return `${base}${ext}`;
}

export function joinWithCanonicalBasename(dir: string, filePath: string): string {
  return join(dir, basenameWithCanonicalExtension(filePath));
}
