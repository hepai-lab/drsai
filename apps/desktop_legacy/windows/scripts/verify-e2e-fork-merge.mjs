import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const exePath = join(root, "release", "win-unpacked", "OpenDrSai.exe");
const port = Number(process.env.OPENDRSAI_E2E_FORK_MERGE_PORT || "18651");
const baseUrl = `http://127.0.0.1:${port}`;
const systemPath = [
  process.env.SystemRoot ? join(process.env.SystemRoot, "System32") : "C:\\Windows\\System32",
  process.env.SystemRoot || "C:\\Windows",
  process.env.PATH || "",
].join(delimiter);

if (process.platform !== "win32") {
  console.log("E2E fork merge-back smoke is only supported on Windows; skipped.");
  process.exit(0);
}

if (!existsSync(exePath)) {
  throw new Error("Build the unpacked Windows app before running verify:e2e-fork-merge.");
}

const tempDir = mkdtempSync(join(tmpdir(), "opendrsai-e2e-fork-merge-"));
const appHome = join(tempDir, "drsai-home");
const resultPath = join(tempDir, "result.json");
mkdirSync(appHome, { recursive: true });

let server = null;

try {
  await assertPortFree();
  server = await startGateway();
  await runPackagedApp({ appHome, resultPath });
  if (!existsSync(resultPath)) {
    throw new Error("E2E fork merge-back smoke did not write a result.");
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  if (!result.ok) {
    throw new Error(`E2E fork merge-back smoke failed:\n${JSON.stringify(result, null, 2)}`);
  }
  assertForkMergeDiagnostics(result);
  console.log("E2E fork merge-back passed with packaged Electron approval gating.");
} finally {
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(tempDir, { recursive: true, force: true });
}

async function assertPortFree() {
  try {
    await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(800) });
    throw new Error(`${baseUrl} is already serving HTTP. Stop the existing gateway before running verify:e2e-fork-merge.`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already serving")) throw error;
  }
}

function startGateway() {
  const serverInstance = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "drsai", object: "model" }] }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "fake gateway" }));
  });
  return new Promise((resolveListen, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(port, "127.0.0.1", () => resolveListen(serverInstance));
  });
}

function assertForkMergeDiagnostics(result) {
  const checks = result?.checks ?? {};
  for (const name of [
    "bridge",
    "domReady",
    "login",
    "workspacesCreated",
    "threadCreated",
    "approvalQueued",
    "pendingApprovalListed",
    "approvalDetailMentionsBoundaries",
    "rejectionAccepted",
    "approvalClearedAfterReject",
    "threadStillActiveAfterReject",
    "rejectDidNotMergeOrClose",
    "approvedWorkspacesRegistered",
    "approvedThreadCreated",
    "approvedMergeQueued",
    "approvedPendingListed",
    "approvalAccepted",
    "approvalClearedAfterApprove",
    "threadMergedAfterApprove",
    "approvedMergeMessageMentionsCleanup",
    "approvedSourceContainsForkChange",
    "approvedSourceHeadAdvanced",
    "approvedMergeCommitHasTwoParents",
    "cleanupQueued",
    "cleanupPendingListed",
    "cleanupApprovalAccepted",
    "cleanupClearedAfterApprove",
    "threadClosedAfterCleanup",
    "cleanupMessageMentionsBranchDelete",
    "cleanupRemovedWorktree",
    "cleanupDeletedMergedBranch",
    "conflictWorkspacesRegistered",
    "conflictThreadCreated",
    "conflictMergeQueued",
    "conflictPendingListed",
    "conflictApprovalAccepted",
    "conflictClearedAfterApprove",
    "threadMergePendingAfterConflict",
    "conflictDidNotMarkMerged",
    "conflictSourceContentPreserved",
    "conflictSourceHeadPreserved",
    "conflictMergeWasAborted",
  ]) {
    if (checks[name] !== true) {
      throw new Error(`E2E fork merge-back check failed: ${name}\n${JSON.stringify(result, null, 2)}`);
    }
  }
  const approval = result?.details?.approvalResult?.approval;
  if (!approval || approval.actionKind !== "fork.lifecycle" || approval.source !== "fork") {
    throw new Error(`E2E fork merge-back did not queue a fork lifecycle approval:\n${JSON.stringify(result, null, 2)}`);
  }
  const threadAfter = result?.details?.threadAfter;
  if (threadAfter?.fork?.lifecycleStatus !== "active") {
    throw new Error(`Rejected merge-back changed fork lifecycle state:\n${JSON.stringify(threadAfter, null, 2)}`);
  }
  const approvedThreadAfter = result?.details?.approvedThreadAfter;
  if (
    approvedThreadAfter?.fork?.lifecycleStatus !== "merged" ||
    !approvedThreadAfter?.fork?.mergedCommit ||
    approvedThreadAfter?.fork?.branchCleanupStatus !== "pending"
  ) {
    throw new Error(`Approved merge-back did not update fork lifecycle state:\n${JSON.stringify(approvedThreadAfter, null, 2)}`);
  }
  const cleanupThreadAfter = result?.details?.cleanupThreadAfter;
  if (
    cleanupThreadAfter?.fork?.lifecycleStatus !== "closed" ||
    cleanupThreadAfter?.fork?.branchCleanupStatus !== "deleted"
  ) {
    throw new Error(`Approved cleanup did not close the fork and delete the merged branch:\n${JSON.stringify(cleanupThreadAfter, null, 2)}`);
  }
  const conflictThreadAfter = result?.details?.conflictThreadAfter;
  if (
    conflictThreadAfter?.fork?.lifecycleStatus !== "merge_pending" ||
    conflictThreadAfter?.fork?.mergedCommit
  ) {
    throw new Error(`Conflict merge-back did not remain merge_pending without a merged commit:\n${JSON.stringify(conflictThreadAfter, null, 2)}`);
  }
  const approvedFixture = result?.details?.approvedFixture;
  if (!approvedFixture?.mergedHead || approvedFixture.mergedHead === approvedFixture.baseRef) {
    throw new Error(`Approved merge-back did not advance the source repository HEAD:\n${JSON.stringify(approvedFixture, null, 2)}`);
  }
  if (approvedFixture?.cleanupWorktreeExists || approvedFixture?.cleanupBranchExists) {
    throw new Error(`Approved cleanup left the throwaway worktree or branch behind:\n${JSON.stringify(approvedFixture, null, 2)}`);
  }
  const conflictFixture = result?.details?.conflictFixture;
  if (!conflictFixture?.sourceHead || conflictFixture.conflictHead !== conflictFixture.sourceHead || conflictFixture.conflictStatus) {
    throw new Error(`Conflict merge-back did not preserve a clean source repository:\n${JSON.stringify(conflictFixture, null, 2)}`);
  }
}

function runPackagedApp({ appHome, resultPath }) {
  return new Promise((resolveRun, reject) => {
    let settled = false;
    const child = spawn(exePath, [], {
      cwd: root,
      env: {
        SystemRoot: process.env.SystemRoot,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
        APPDATA: process.env.APPDATA,
        PATH: systemPath,
        DRSAI_HOME: appHome,
        DRSAI_GATEWAY_DEV_MANAGED: "1",
        OPENDRSAI_GATEWAY_PORT: String(port),
        OPENDRSAI_DEV_AUTH_BYPASS: "1",
        OPENDRSAI_E2E_FORK_MERGE: "1",
        OPENDRSAI_E2E_RESULT: resultPath,
        OPENDRSAI_E2E_TIMEOUT_MS: "45000",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTree(child.pid);
      reject(new Error(`E2E fork merge-back timed out.\n${stdout}\n${stderr}`));
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolveRun();
        return;
      }
      const result = existsSync(resultPath) ? `\n${readFileSync(resultPath, "utf8")}` : "";
      reject(new Error(`Packaged app exited with code ${code}.${result}\n${stdout}\n${stderr}`));
    });
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}
