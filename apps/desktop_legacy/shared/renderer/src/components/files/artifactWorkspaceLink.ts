import type { WorkspaceFileNode } from "@shared/desktopApi";

export function normalizeWorkspaceArtifactPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function findWorkspaceNodeByArtifactPath(
  nodes: WorkspaceFileNode[],
  path: string,
): WorkspaceFileNode | null {
  const relativePath = normalizeWorkspaceArtifactPath(path);
  for (const node of nodes) {
    if (node.path === path || normalizeWorkspaceArtifactPath(node.relativePath) === relativePath) return node;
    const child = findWorkspaceNodeByArtifactPath(node.children ?? [], path);
    if (child) return child;
  }
  return null;
}
