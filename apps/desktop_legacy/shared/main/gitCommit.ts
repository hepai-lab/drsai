import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import type { DesktopGitCommitApprovalRequest } from "../api/desktopApi";
import { assertAllowedDesktopPath } from "./desktopPathPolicy";

export function normalizeGitCommitApprovalRequest(raw: unknown): DesktopGitCommitApprovalRequest {
  if (!raw || typeof raw !== "object") throw new Error("Git commit approval request must be an object.");
  const value = raw as Partial<DesktopGitCommitApprovalRequest>;
  if (typeof value.workspacePath !== "string" || !value.workspacePath.trim() || value.workspacePath.length > 2_048 || typeof value.message !== "string" || !value.message.trim() || value.message.length > 240 || /[\r\n]/.test(value.message)) throw new Error("Git commit approval request is incomplete.");
  if (value.body !== undefined && (typeof value.body !== "string" || value.body.length > 8_000)) throw new Error("Git commit body is invalid.");
  if (value.requestId !== undefined && (typeof value.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(value.requestId))) throw new Error("Git commit request id is invalid.");
  return { workspacePath: value.workspacePath.trim(), message: value.message.trim(), ...(value.body?.trim() ? { body: value.body.trim() } : {}), ...(value.checklist ? { checklist: value.checklist } : {}), ...(value.requestId ? { requestId: value.requestId } : {}) };
}

export function gitCommitApprovalIdempotencyKey(request: DesktopGitCommitApprovalRequest): string {
  return `git-commit:${createHash("sha256").update(`${request.workspacePath}\0${request.message}\0${request.body ?? ""}\0${request.requestId ?? ""}`).digest("hex")}`;
}

export async function executeLocalGitCommit(request: DesktopGitCommitApprovalRequest, allowedRoots: string[], approvalId?: string): Promise<boolean> {
  const workspacePath = assertAllowedDesktopPath(request.workspacePath, allowedRoots, { directory: true });
  const marker = approvalId ? gitCommitApprovalTrailer(approvalId) : undefined;
  if (marker && await hasLocalGitCommitApproval(workspacePath, marker)) return true;
  const args = ["-C", workspacePath, "commit", "-m", request.message];
  if (request.body) args.push("-m", request.body);
  if (marker) args.push("-m", marker);
  await execute("git", args, workspacePath, 60_000);
  return true;
}

export function gitCommitApprovalTrailer(approvalId: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(approvalId)) throw new Error("Git commit approval id is invalid.");
  return `OpenDrSai-Approval: ${approvalId}`;
}

async function hasLocalGitCommitApproval(workspacePath: string, marker: string): Promise<boolean> {
  const history = await execute("git", ["-C", workspacePath, "log", "--all", "-n", "200", "--format=%B%x00"], workspacePath, 30_000);
  return history.split("\0").some((message) => message.split(/\r?\n/).some((line) => line.trim() === marker));
}

function execute(command: string, args: string[], cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
    if (error) reject(new Error(stderr.trim() || stdout.trim() || error.message));
    else resolve(stdout);
  }));
}
