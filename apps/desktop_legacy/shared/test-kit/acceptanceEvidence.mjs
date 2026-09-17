import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function currentCommit(repositoryRoot) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

export function worktreeFingerprint(repositoryRoot) {
  const hash = createHash("sha256");
  const diff = execFileSync("git", ["diff", "--binary", "HEAD", "--"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  hash.update("tracked\0").update(diff);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString("utf8").split("\0").filter(Boolean)
    .filter((path) => !path.replace(/\\/g, "/").startsWith("apps/desktop/macos/build/acceptance/"))
    .sort();
  for (const path of untracked) {
    hash.update("untracked\0").update(path).update("\0").update(readFileSync(resolve(repositoryRoot, path)));
  }
  return hash.digest("hex");
}
