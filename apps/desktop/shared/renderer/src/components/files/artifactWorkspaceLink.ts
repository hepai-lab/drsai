import type { WorkspaceFileNode } from "@shared/desktopApi";

const KNOWN_EXTENSIONS = [
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

export function normalizeWorkspaceArtifactPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Drop trailing junk after a real extension (`Deck.pptx（介绍）` → `Deck.pptx`). */
export function canonicalizeArtifactLeafName(name: string): string {
  const lower = name.toLowerCase();
  const ordered = [...KNOWN_EXTENSIONS].sort((a, b) => b.length - a.length);
  for (const ext of ordered) {
    const idx = lower.lastIndexOf(ext);
    if (idx < 0) continue;
    const after = lower.slice(idx + ext.length);
    if (after.length === 0) return name.slice(0, idx + ext.length);
    // Only rewrite when Path.extname-style suffix is not itself a known extension.
    const directDot = name.lastIndexOf(".");
    const direct = directDot >= 0 ? name.slice(directDot).toLowerCase() : "";
    if (!(KNOWN_EXTENSIONS as readonly string[]).includes(direct)) {
      return name.slice(0, idx + ext.length);
    }
  }
  return name;
}

function leafName(path: string): string {
  const normalized = normalizeWorkspaceArtifactPath(path);
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

function pathsEqual(left: string, right: string): boolean {
  return normalizeWorkspaceArtifactPath(left).toLowerCase() === normalizeWorkspaceArtifactPath(right).toLowerCase();
}

function collectFileNodes(nodes: WorkspaceFileNode[]): WorkspaceFileNode[] {
  const files: WorkspaceFileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") files.push(node);
    if (node.children?.length) files.push(...collectFileNodes(node.children));
  }
  return files;
}

export function findWorkspaceNodeByArtifactPath(
  nodes: WorkspaceFileNode[],
  path: string,
): WorkspaceFileNode | null {
  if (!path.trim()) return null;
  const relativePath = normalizeWorkspaceArtifactPath(path);
  const wantedLeaf = canonicalizeArtifactLeafName(leafName(path));
  const wantedLeafLower = wantedLeaf.toLowerCase();

  for (const node of nodes) {
    if (pathsEqual(node.path, path) || pathsEqual(node.relativePath, relativePath)) return node;
    const child = findWorkspaceNodeByArtifactPath(node.children ?? [], path);
    if (child) return child;
  }

  // Chat cards may still point at a renamed/mangled leaf
  // (`OpenDrSai-Intro (2).pptx（3页…）` → `OpenDrSai-Intro (2).pptx`).
  const files = collectFileNodes(nodes);
  const exactLeaf = files.find((node) => canonicalizeArtifactLeafName(node.name).toLowerCase() === wantedLeafLower);
  if (exactLeaf) return exactLeaf;

  const relativeDir = relativePath.includes("/")
    ? relativePath.slice(0, relativePath.lastIndexOf("/")).toLowerCase()
    : "";
  if (relativeDir) {
    const sameFolder = files.find((node) => {
      const nodeRel = normalizeWorkspaceArtifactPath(node.relativePath);
      const nodeDir = nodeRel.includes("/") ? nodeRel.slice(0, nodeRel.lastIndexOf("/")).toLowerCase() : "";
      return nodeDir === relativeDir && canonicalizeArtifactLeafName(node.name).toLowerCase() === wantedLeafLower;
    });
    if (sameFolder) return sameFolder;
  }

  return null;
}
