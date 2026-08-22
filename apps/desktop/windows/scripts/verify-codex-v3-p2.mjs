import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const registry = read("cores/python/packages/drsai/src/drsai/backend/runtime/registry.py");
const processSupervisor = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/app_server_process.py");
const client = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/backend_client.py");
const runtime = read("cores/python/packages/drsai/src/drsai/backend/runtime/agent.py");
const gateway = read("cores/python/packages/drsai/src/drsai/backend/gateway.py");
const main = read("apps/desktop/windows/src/main/index.ts");
const archive = read("apps/desktop/windows/src/main/threadArchive.ts");
const app = read("apps/desktop/shared/renderer/src/App.tsx");
const shell = read("apps/desktop/shared/renderer/src/components/WorkspaceShell.tsx");

const checks = [
  ["M02-F01 canonical workspace identity", registry.includes("canonical_path(path") && registry.includes("canonical_path TEXT NOT NULL UNIQUE")],
  ["M02-F02 automatic import scan", app.includes("await syncWorkspaceSessions(workspace)")],
  ["M02-F03 exact path filtering", client.includes("if actual != expected")],
  ["M02-F04 active and archived discovery", client.includes("for archived in (False, True)")],
  ["M02-F05 deterministic deduplicated import", runtime.includes("hashlib.sha256(backend_session_id") && client.includes("discovered[thread_id]")],
  ["M02-F06 bounded result feedback", app.includes("sync.active") && app.includes("sync.archived") && app.includes("sync.skipped")],
  ["M02-F07 workspace and Settings resync with cancel", shell.includes("workspace-sync-codex-sessions") && app.includes("codex-workspace-sync-settings") && app.includes("cancelWorkspaceSessionSync")],
  ["M03-F03 visible source labels", shell.includes("thread-source-label") && shell.includes('source === "remote"')],
  ["M03-F04 Codex rename scope is explicit", shell.includes("original Codex task name is unchanged")],
  ["M03-F05 archive converges and remains retryable", gateway.includes("Mirror to the owning Agent Backend first") && archive.includes("Nothing changed; retry")],
  ["M03-F06 protected deletion semantics", shell.includes("Remove from OpenDrSai list") && shell.includes("Permanently delete local conversation")],
  ["large Codex history frames are supported", processSupervisor.includes("CODEX_JSONL_FRAME_LIMIT")],
  ["desktop sync IPC is wired", main.includes("desktop:sync-codex-workspace-sessions")],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error(`Codex V3 P2 verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Codex V3 P2 verification passed (${checks.length}/${checks.length}).`);
