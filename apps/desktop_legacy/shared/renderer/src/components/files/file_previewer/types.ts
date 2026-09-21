import type { WorkspaceFilePreview } from "@shared/desktopApi";
import type { AppLanguage } from "../../../navigation";

/** 1-based, inclusive range of file lines to mark and scroll to. */
export interface LineHighlight {
  start: number;
  end: number;
}

export interface PreviewerProps {
  language: AppLanguage;
  preview: WorkspaceFilePreview;
  /**
   * Set only when the file was opened to check a specific claim. Absent for
   * ordinary file browsing, which leaves every existing caller unchanged.
   */
  highlight?: LineHighlight;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function toFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${encodeURI(prefixed).replace(/#/g, "%23")}`;
}
