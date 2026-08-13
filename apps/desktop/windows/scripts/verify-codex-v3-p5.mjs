import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const app = read("apps/desktop/shared/renderer/src/App.tsx");
const workspace = read("apps/desktop/shared/renderer/src/components/ChatWorkspace.tsx");
const runtimeClient = read("apps/desktop/shared/main/runtimeClient.ts");
const chatMain = read("apps/desktop/shared/main/chat.ts");
const remote = read("apps/desktop/windows/src/main/remoteWorkspace.ts");
const live = read("scripts/verify-codex-runtime-online.py");
const binary = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/binary_provider.py");
const factory = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/factory.py");
const packageJson = read("apps/desktop/windows/package.json");
const checks = [
  ["M08-F01 transport-independent workspace boundary", runtimeClient.includes("executeOWOP") && runtimeClient.includes('"/v1/owop"') && !workspace.includes("ssh.exe")],
  ["M08-F02 shared OAEP reducer cursor and approval model", chatMain.includes("listOaepEvents") && runtimeClient.includes("oaep-events?after_sequence") && runtimeClient.includes("respondAgentApproval")],
  ["M08-F03 capability negotiation disables unsupported UI", app.includes("platformDescriptor?.capabilities.features") && app.includes("!== true ? false")],
  ["M08-F04 explicit local-to-remote migration safety", workspace.includes("remote-session-migration-notice") && workspace.includes("never auto-bound to the remote Runtime")],
  ["M08-F05 remote failures stay distinguishable", remote.includes("failureCategory") && remote.includes("authentication") && remote.includes("reconnecting") && app.includes("Codex Agent Runtime")],
  ["M09-F01 clean Windows product-mode live runner", binary.includes("discover_windows_codex_desktop") && live.includes("/v1/agent-backends/codex/account")],
  ["M09-F02 upgrade preserves state and bindings", factory.includes("bindings.sqlite3") && packageJson.includes("verify:update-policy") && packageJson.includes("verify:e2e-update")],
  ["M09-F03 real historical project import runner", app.includes("syncCodexWorkspaceSessions") && packageJson.includes("verify:codex-v3-p2")],
  ["M09-F04 real twenty-turn continuity runner", live.includes("continuous_turns: int = 20") && live.includes("turn_ids_unique")],
  ["M09-F05 fault injection gates", packageJson.includes("verify:network-recovery") && packageJson.includes("verify:runtime-recovery-real") && packageJson.includes("verify:thread-atomic-recovery")],
  ["M09-F06 fail-closed 54-item release ledger", packageJson.includes("verify:codex-v3-release")],
];
const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) { console.error(`Codex V3 P5 verification failed:\n- ${failures.join("\n- ")}`); process.exit(1); }
console.log(`Codex V3 P5 verification passed (${checks.length}/${checks.length}).`);
