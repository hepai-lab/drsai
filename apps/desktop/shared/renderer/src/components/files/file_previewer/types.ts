import type { WorkspaceFilePreview } from "@shared/desktopApi";
import type { AppLanguage } from "../../../navigation";

export interface PreviewerProps {
  language: AppLanguage;
  preview: WorkspaceFilePreview;
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
