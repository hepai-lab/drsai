import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { executeLocalGitCommit, gitCommitApprovalIdempotencyKey, normalizeGitCommitApprovalRequest } from "../main/gitCommit.ts";

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "opendrsai-git-approval-"));
try {
  await exec("git", ["init", root]);
  await exec("git", ["-C", root, "config", "user.email", "desktop-test@example.invalid"]);
  await exec("git", ["-C", root, "config", "user.name", "Desktop Test"]);
  await writeFile(join(root, "result.txt"), "approved\n");
  await exec("git", ["-C", root, "add", "result.txt"]);
  const request = normalizeGitCommitApprovalRequest({ workspacePath: root, message: "approved; literal command", body: "Verified by automated test.", requestId: "request-001" });
  assert.match(gitCommitApprovalIdempotencyKey(request), /^git-commit:[a-f0-9]{64}$/);
  await executeLocalGitCommit(request, [root], "approval:git-response-lost");
  const subject = (await exec("git", ["-C", root, "log", "-1", "--pretty=%s"])).stdout.trim();
  assert.equal(subject, "approved; literal command", "Commit messages must be passed as argv and never interpreted by a shell.");
  const body = (await exec("git", ["-C", root, "log", "-1", "--pretty=%B"])).stdout; assert.match(body, /OpenDrSai-Approval: approval:git-response-lost/);
  await executeLocalGitCommit(request, [root], "approval:git-response-lost");
  const commitCount = Number((await exec("git", ["-C", root, "rev-list", "--count", "HEAD"])).stdout.trim()); assert.equal(commitCount, 1, "response-loss retry must reconcile the approval trailer without creating another commit");
  await assert.rejects(async () => normalizeGitCommitApprovalRequest({ workspacePath: root, message: "bad\nmessage" }), /incomplete/);
  await assert.rejects(() => executeLocalGitCommit(request, [join(root, "outside")]), /outside/i);
  console.log("Git commit approval validation, path boundary and argv execution verification passed.");
} finally { await rm(root, { recursive: true, force: true }); }
