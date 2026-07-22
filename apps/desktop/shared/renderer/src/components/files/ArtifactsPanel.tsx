import { Box, ExternalLink, Eye } from "lucide-react";
import type { WorkspaceFileNode } from "@shared/desktopApi";
import type { AppLanguage } from "../../navigation";
import type { AgentFileTraceEvent } from "./AgentFileActivityPanel";

export function ArtifactsPanel({
  events,
  language,
  nodes,
  onOpen,
  onPreview,
}: {
  events: AgentFileTraceEvent[];
  language: AppLanguage;
  nodes: WorkspaceFileNode[];
  onOpen: (node: WorkspaceFileNode) => void;
  onPreview: (node: WorkspaceFileNode) => void;
}): React.JSX.Element {
  const zh = language === "zh";
  const artifacts = collectArtifacts(nodes, events);
  return (
    <section className="files-artifacts" aria-label="Artifacts">
      <div className="files-artifacts-title">
        <Box size={13} />
        <span>{zh ? "Artifacts" : "Artifacts"}</span>
        <small>{artifacts.length} files</small>
      </div>
      {artifacts.length === 0 ? (
        <p>
          {zh
            ? "暂无新增或未跟踪文件。智能体生成的文件会在这里作为可审阅成果出现。"
            : "No added or untracked files yet. Agent-generated files appear here for review."}
        </p>
      ) : (
        <ol>
          {artifacts.slice(0, 12).map((artifact) => (
            <li key={artifact.path}>
              <span title={artifact.relativePath}>{artifact.relativePath}</span>
              <small>{artifact.source}</small>
              <button
                type="button"
                onClick={() => artifact.node && onPreview(artifact.node)}
                disabled={!artifact.node}
                title={zh ? "预览 artifact" : "Preview artifact"}
                aria-label={zh ? "预览 artifact" : "Preview artifact"}
              >
                <Eye size={12} />
              </button>
              <button
                type="button"
                onClick={() =>
                  onOpen(artifact.node ?? createSyntheticArtifactNode(artifact.path, artifact.relativePath))
                }
                title={zh ? "打开 artifact" : "Open artifact"}
                aria-label={zh ? "打开 artifact" : "Open artifact"}
              >
                <ExternalLink size={12} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

interface ArtifactItem {
  node?: WorkspaceFileNode;
  path: string;
  relativePath: string;
  source: string;
}

function collectArtifacts(
  nodes: WorkspaceFileNode[],
  events: AgentFileTraceEvent[],
): ArtifactItem[] {
  const byPath = new Map<string, ArtifactItem>();
  for (const node of flattenNodes(nodes)) {
    if (node.type === "file" && (node.gitStatus === "added" || node.gitStatus === "untracked")) {
      byPath.set(node.path, {
        node,
        path: node.path,
        relativePath: node.relativePath,
        source: node.gitStatus,
      });
    }
  }
  for (const event of events.filter((item) => item.action === "agent_artifact")) {
    byPath.set(event.path, {
      ...byPath.get(event.path),
      path: event.path,
      relativePath: event.name,
      source: "agent",
    });
  }
  return Array.from(byPath.values())
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function createSyntheticArtifactNode(
  path: string,
  relativePath: string,
): WorkspaceFileNode {
  return {
    modifiedAt: new Date().toISOString(),
    name: relativePath.split(/[\\/]/).filter(Boolean).at(-1) ?? relativePath,
    path,
    relativePath,
    type: "file",
  };
}

function flattenNodes(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);
}
