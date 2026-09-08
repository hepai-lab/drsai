/**
 * Client-side skill folder → ZIP packing (WebUI skills-square/utils parity).
 */

import JSZip from "jszip";

export const HEPAI_MAX_ZIP_BYTES = 10 * 1024 * 1024;
export const MAX_SKILL_FOLDER_FILES = 200;

type FileWithRelativePath = File & { webkitRelativePath?: string };

export type PackPreviewEntry = { path: string; size: number };

export async function zipFolderFileListToZipFile(files: FileList): Promise<File> {
  const zip = new JSZip();
  const n = files.length;
  if (n === 0) throw new Error("No files selected");
  if (n > MAX_SKILL_FOLDER_FILES) {
    throw new Error(`Max ${MAX_SKILL_FOLDER_FILES} files per folder`);
  }
  let hasSkillMd = false;
  for (let i = 0; i < n; i++) {
    const f = files[i] as FileWithRelativePath;
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    if (/(^|\/)SKILL\.MD$/i.test(rel)) hasSkillMd = true;
    zip.file(rel, await f.arrayBuffer());
  }
  if (!hasSkillMd) {
    throw new Error("Folder must contain a SKILL.md");
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  if (blob.size > HEPAI_MAX_ZIP_BYTES) {
    throw new Error("Archive exceeds 10 MB, please reduce and retry");
  }
  const first = files[0] as FileWithRelativePath;
  const firstRel = (first.webkitRelativePath || first.name).replace(/\\/g, "/");
  const rootFolder = firstRel.includes("/") ? (firstRel.split("/")[0] ?? "skill") : "skill";
  const safeStem =
    rootFolder.replace(/[^\w\u4e00-\u9fff.-]/g, "-").slice(0, 80) || "skill";
  return new File([blob], `${safeStem}.zip`, { type: "application/zip" });
}

export function listFolderFileEntries(files: FileList): PackPreviewEntry[] {
  const out: PackPreviewEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i] as FileWithRelativePath;
    const path = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    if (path) out.push({ path, size: f.size });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function listZipFileEntries(file: File): Promise<PackPreviewEntry[]> {
  const zip = await JSZip.loadAsync(file);
  const out: PackPreviewEntry[] = [];
  zip.forEach((relPath, zf) => {
    if (zf.dir) return;
    const path = relPath.replace(/\\/g, "/");
    const raw = (zf as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    out.push({ path, size: typeof raw === "number" ? raw : 0 });
  });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function extractMarkdownToc(body: string): { id: string; level: number; text: string }[] {
  const headingRegex = /^(#{1,3})\s+(.+)$/gm;
  const items: { id: string; level: number; text: string }[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(body)) !== null) {
    const level = match[1].length;
    const text = match[2].trim();
    const id = `md-h-${text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")}`;
    items.push({ id, level, text });
  }
  return items;
}
