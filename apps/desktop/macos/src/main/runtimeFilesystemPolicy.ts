import { readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export async function assertRuntimeSymlinkStaysInsideRoot(root: string, linkPath: string): Promise<void> {
  const lexicalRoot = resolve(root);
  const canonicalRoot = await realpath(root);
  const target = await readlink(linkPath);
  if (isAbsolute(target)) throw new Error(`Runtime symbolic link must be relative: ${linkPath}`);

  const lexicalTarget = resolve(dirname(linkPath), target);
  assertInside(lexicalRoot, lexicalTarget, linkPath);

  let canonicalTarget: string;
  try { canonicalTarget = await realpath(linkPath); }
  catch { throw new Error(`Runtime symbolic link is dangling: ${linkPath}`); }
  assertInside(canonicalRoot, canonicalTarget, linkPath);

  const info = await stat(canonicalTarget);
  if (!info.isFile() && !info.isDirectory()) throw new Error(`Runtime symbolic link has an unsupported target: ${linkPath}`);
}

function assertInside(root: string, target: string, linkPath: string): void {
  const rel = relative(root, target);
  if (rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(rel)) {
    throw new Error(`Runtime symbolic link escapes its root: ${linkPath}`);
  }
}
