import { GitCompare } from "lucide-react";
import type { WorkspaceGitDiffResult } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export function GitDiffPreview({
  diff,
  language,
}: {
  diff: WorkspaceGitDiffResult;
  language: AppLanguage;
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <div className="files-diff-preview">
      <header>
        <GitCompare size={15} />
        <div>
          <strong>
            {diff.staged ? "Staged: " : ""}
            {diff.path || (zh ? "工作区 diff" : "Workspace diff")}
          </strong>
          <span>{diff.truncated ? (zh ? "已截断" : "truncated") : "ready"}</span>
        </div>
      </header>
      <pre>{diff.diff || (zh ? "该文件没有 diff。" : "No diff for this file.")}</pre>
    </div>
  );
}
