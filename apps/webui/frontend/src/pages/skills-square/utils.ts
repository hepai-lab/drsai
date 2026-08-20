import JSZip from "jszip";
import { HEPAI_MAX_ZIP_BYTES, MAX_SKILL_FOLDER_FILES } from "./constants";

/** Backend may store literal "undefined" when edit form state was out of sync. */
export const sanitizeChangelog = (v?: string | null) =>
  v && v !== "undefined" ? v : "";

type FileWithRelativePath = File & { webkitRelativePath?: string };

export async function zipFolderFileListToZipFile(
  files: FileList,
): Promise<File> {
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
    if (/(^|\/)SKILL\.MD$/i.test(rel)) {
      hasSkillMd = true;
    }
    zip.file(rel, await f.arrayBuffer());
  }
  if (!hasSkillMd) {
    throw new Error("Folder must contain a SKILL.md");
  }
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
  if (blob.size > HEPAI_MAX_ZIP_BYTES) {
    throw new Error("Archive exceeds 10 MB, please reduce and retry");
  }
  const first = files[0] as FileWithRelativePath;
  const firstRel = (first.webkitRelativePath || first.name).replace(/\\/g, "/");
  const rootFolder = firstRel.includes("/")
    ? (firstRel.split("/")[0] ?? "skill")
    : "skill";
  const safeStem =
    rootFolder.replace(/[^\w\u4e00-\u9fff.-]/g, "-").slice(0, 80) || "skill";
  return new File([blob], `${safeStem}.zip`, { type: "application/zip" });
}

export function splitArchiveName(filename: string): {
  stem: string;
  ext: string;
} {
  if (filename.toLowerCase().endsWith(".zip")) {
    return { stem: filename.slice(0, -4), ext: ".zip" };
  }
  return { stem: filename, ext: "" };
}

export type PackPreviewEntry = { path: string; size: number };

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

export type FileWithRelativePathExport = FileWithRelativePath;
