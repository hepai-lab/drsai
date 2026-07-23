/**
 * Normalize a workspace path for equality / scoping comparisons.
 * Collapses separators, trims trailing slashes, and lowercases for Windows.
 *
 * Used when filtering sessions by workdir ↔ desktop workspace. Keep this
 * pure and side-effect free so main + renderer + tests share one contract.
 */
export function normalizeWorkspacePath(path: string | null | undefined): string {
  if (path == null) return "";
  const trimmed = String(path).trim();
  if (!trimmed) return "";
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** True when two workspace paths refer to the same location after normalize. */
export function sameWorkspacePath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normalizeWorkspacePath(left);
  const b = normalizeWorkspacePath(right);
  if (!a || !b) return false;
  return a === b;
}
