import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getWorkspaceGitDiff,
  getWorkspaceGitFileAtRef,
  revertWorkspaceFile,
  stageWorkspaceFile,
} from "../main/workspaceContext";

const fixture = await mkdtemp(join(tmpdir(), "opendrsai-workspace-git-"));
const workspace = join(fixture, "workspace");
const file = join(workspace, "report.txt");
try {
  await mkdir(workspace, { recursive: true });
  git("init", "-q");
  git("config", "user.email", "acceptance@opendrsai.local");
  git("config", "user.name", "OpenDrSai Acceptance");
  await writeFile(file, "version one\n", "utf8");
  git("add", "report.txt");
  git("commit", "-q", "-m", "baseline");

  await writeFile(file, "version two\n", "utf8");
  const unstaged = await getWorkspaceGitDiff({ workspacePath: workspace, path: file });
  assert.match(unstaged.diff, /-version one/);
  assert.match(unstaged.diff, /\+version two/);
  assert.equal(unstaged.staged, false);
  await assert.rejects(
    stageWorkspaceFile({ workspacePath: workspace, path: file, expectedDiffHash: "0".repeat(64) }),
    /changed since review/i,
  );
  assert.equal((await getWorkspaceGitDiff({ workspacePath: workspace, path: file })).diffHash, unstaged.diffHash);

  const staged = await stageWorkspaceFile({ workspacePath: workspace, path: file, expectedDiffHash: unstaged.diffHash });
  assert.equal(staged.staged, true);
  assert.equal((await getWorkspaceGitDiff({ workspacePath: workspace, path: file })).diff, "");
  const stagedDiff = await getWorkspaceGitDiff({ workspacePath: workspace, path: file, staged: true });
  assert.match(stagedDiff.diff, /\+version two/);
  const head = await getWorkspaceGitFileAtRef({ workspacePath: workspace, path: file, ref: "HEAD" });
  assert.equal(head.content, "version one\n");
  assert.equal(head.missing, false);

  await writeFile(file, "version three\n", "utf8");
  const third = await getWorkspaceGitDiff({ workspacePath: workspace, path: file });
  await assert.rejects(
    revertWorkspaceFile({ workspacePath: workspace, path: file, expectedDiffHash: stagedDiff.diffHash }),
    /changed since review/i,
  );
  assert.equal(await readFile(file, "utf8"), "version three\n");
  const reverted = await revertWorkspaceFile({ workspacePath: workspace, path: file, expectedDiffHash: third.diffHash });
  assert.equal(reverted.reverted, true);
  assert.equal((await readFile(file, "utf8")).replaceAll("\r\n", "\n"), "version two\n");
  assert.equal((await revertWorkspaceFile({ workspacePath: workspace, path: file, expectedDiffHash: third.diffHash })).reverted, false);

  await assert.rejects(
    getWorkspaceGitDiff({ workspacePath: workspace, path: join(fixture, "outside.txt") }),
    /outside|within|workspace/i,
  );
  console.log("Workspace Git diff/stage/ref/revert, stale-review refusal and path-boundary verification passed.");
} finally {
  await rm(fixture, { recursive: true, force: true });
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: workspace, encoding: "utf8", timeout: 10_000 });
}
