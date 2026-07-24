import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertRuntimeSymlinkStaysInsideRoot } from "../../macos/src/main/runtimeFilesystemPolicy";

const sandbox = await mkdtemp(join(tmpdir(), "opendrsai-runtime-links-"));
const root = join(sandbox, "runtime");
const outside = join(sandbox, "outside");
try {
  await mkdir(join(root, "Framework.framework", "Versions", "1.0"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, "Framework.framework", "Versions", "1.0", "binary"), "safe");
  await writeFile(join(outside, "secret"), "outside");

  const current = join(root, "Framework.framework", "Versions", "Current");
  const frameworkBinary = join(root, "Framework.framework", "Framework");
  await symlink("1.0", current);
  await symlink("Versions/Current/binary", frameworkBinary);
  await assertRuntimeSymlinkStaysInsideRoot(root, current);
  await assertRuntimeSymlinkStaysInsideRoot(root, frameworkBinary);

  const escape = join(root, "escape");
  await symlink("../../outside/secret", escape);
  await assert.rejects(() => assertRuntimeSymlinkStaysInsideRoot(root, escape), /escapes its root/);

  const absolute = join(root, "absolute");
  await symlink(join(outside, "secret"), absolute);
  await assert.rejects(() => assertRuntimeSymlinkStaysInsideRoot(root, absolute), /must be relative/);

  const dangling = join(root, "dangling");
  await symlink("missing", dangling);
  await assert.rejects(() => assertRuntimeSymlinkStaysInsideRoot(root, dangling), /is dangling/);
} finally {
  await rm(sandbox, { recursive: true, force: true });
}

console.log("macOS Runtime Framework symlink policy passed (in-root chains allowed; absolute, escape and dangling links rejected).");
