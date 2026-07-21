import { Network } from "lucide-react";
import type { WorkspaceFileNode, WorkspaceFilePreview } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";

export function RepoMapPanel({
  language,
  nodes,
  preview,
}: {
  language: AppLanguage;
  nodes: WorkspaceFileNode[];
  preview: WorkspaceFilePreview | null;
}): React.JSX.Element {
  const zh = language === "zh";
  const stats = collectRepoStats(nodes);
  const dependencies = extractDependencies(preview?.content ?? "");
  const outline = preview?.outline ?? [];
  return (
    <section className="files-repo-map" aria-label="Repo map">
      <div className="files-repo-map-title">
        <Network size={13} />
        <span>{zh ? "Repo Map" : "Repo Map"}</span>
        <small>{stats.files} files</small>
      </div>
      <div className="files-repo-map-grid">
        <span>dirs <strong>{stats.directories}</strong></span>
        <span>changed <strong>{stats.changed}</strong></span>
        <span>code <strong>{stats.code}</strong></span>
        <span>docs <strong>{stats.docs}</strong></span>
      </div>
      <div className="files-repo-hotspots">
        {stats.hotspots.length === 0 ? (
          <p>{zh ? "暂无热点文件。" : "No hotspots yet."}</p>
        ) : (
          stats.hotspots.map((item) => <span key={item}>{item}</span>)
        )}
      </div>
      <div className="files-repo-map-detail">
        <div>
          <strong>{zh ? "当前文件符号" : "Current Symbols"}</strong>
          {outline.length === 0 ? (
            <p>{zh ? "选择代码文件后显示 outline。" : "Select a code file to show outline."}</p>
          ) : (
            <ol>
              {outline.slice(0, 12).map((item, index) => (
                <li key={`${preview?.path}-symbol-${index}`}>{item}</li>
              ))}
            </ol>
          )}
        </div>
        <div>
          <strong>{zh ? "轻量依赖" : "Light Dependencies"}</strong>
          {dependencies.length === 0 ? (
            <p>{zh ? "未检测到 import/require。" : "No import/require edges detected."}</p>
          ) : (
            <ol>
              {dependencies.slice(0, 12).map((item) => (
                <li key={`${preview?.path}-dep-${item}`}>{item}</li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

function collectRepoStats(nodes: WorkspaceFileNode[]): {
  changed: number;
  code: number;
  directories: number;
  docs: number;
  files: number;
  hotspots: string[];
} {
  const all = flattenNodes(nodes);
  const files = all.filter((node) => node.type === "file");
  return {
    changed: all.filter((node) => node.gitStatus && node.gitStatus !== "clean").length,
    code: files.filter((node) => node.previewKind === "code").length,
    directories: all.filter((node) => node.type === "directory").length,
    docs: files.filter((node) => node.previewKind === "markdown" || node.previewKind === "text").length,
    files: files.length,
    hotspots: all
      .filter((node) => node.gitStatus && node.gitStatus !== "clean")
      .slice(0, 8)
      .map((node) => node.relativePath),
  };
}

function flattenNodes(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);
}

function extractDependencies(content: string): string[] {
  const dependencies = new Set<string>();
  for (const line of content.split(/\r?\n/).slice(0, 400)) {
    const importMatch =
      line.match(/^\s*import\s+.*?\s+from\s+["']([^"']+)["']/) ??
      line.match(/^\s*import\s+["']([^"']+)["']/) ??
      line.match(/^\s*from\s+([\w.]+)\s+import\s+/) ??
      line.match(/require\(["']([^"']+)["']\)/);
    if (importMatch?.[1]) dependencies.add(importMatch[1]);
  }
  return Array.from(dependencies);
}
