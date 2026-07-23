import { Folder, ListPlus } from "lucide-react";
import type { WorkspaceFileNode } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export function DirectoryContextPreview({
  files,
  language,
  node,
  onAttach,
}: {
  files: WorkspaceFileNode[];
  language: AppLanguage;
  node: WorkspaceFileNode;
  onAttach: () => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const totalSize = files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  return (
    <div className="files-directory-preview">
      <header>
        <Folder size={18} />
        <div>
          <strong>{node.relativePath || node.name}</strong>
          <span>{files.length} files · {formatBytes(totalSize)}</span>
        </div>
        <button type="button" onClick={onAttach}>
          <ListPlus size={14} />
          {zh ? "加入目录" : "Attach folder"}
        </button>
      </header>
      <p>
        {zh
          ? "目录内容会作为可见清单交给智能体，不会悄悄发送所有文件内容。"
          : "Folder context is attached as a visible manifest, not silent full file contents."}
      </p>
      <ul>
        {files.slice(0, 80).map((file) => (
          <li key={file.path}>
            <span>{file.relativePath}</span>
            <small>{formatBytes(file.size ?? 0)}</small>
          </li>
        ))}
      </ul>
      {files.length > 80 ? (
        <small className="files-directory-truncated">
          {zh ? "清单已截断。" : "Manifest truncated."}
        </small>
      ) : null}
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
