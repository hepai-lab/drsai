import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const binary = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/binary_provider.py");
const gateway = read("cores/python/packages/drsai/src/drsai/backend/gateway.py");
const runtimeClient = read("apps/desktop/shared/main/runtimeClient.ts");
const preload = read("apps/desktop/shared/main/preload.ts");
const main = read("apps/desktop/windows/src/main/index.ts");
const app = read("apps/desktop/shared/renderer/src/App.tsx");
const codexSettings = read("apps/desktop/shared/renderer/src/components/CodexIntegrationSettings.tsx");
const shell = read("apps/desktop/shared/renderer/src/components/WorkspaceShell.tsx");

const checks = [
  ["discovers real Codex Desktop CLI", binary.includes("discover_windows_codex_desktop") && binary.includes('OpenAI" / "Codex" / "bin')],
  ["rejects WindowsApps alias", binary.includes("codex_windowsapps_alias_inaccessible")],
  ["requires valid OpenAI Authenticode signature", binary.includes("Get-AuthenticodeSignature") && binary.includes("codex_desktop_signature_invalid")],
  ["accepts semantic prerelease CLI versions", binary.includes("[0-9A-Za-z.-]+")],
  ["Runtime exposes backend-only restart", gateway.includes('/v1/agent-backends/{backend_id}/restart')],
  ["Desktop restart IPC is end to end", runtimeClient.includes("restartBackend(backendId") && preload.includes("desktop:restart-codex-backend") && main.includes("client.restartBackend(\"codex\")")],
  ["setup presents three contextual user steps", codexSettings.includes('data-testid="codex-setup-steps"') && codexSettings.includes("Check or install Codex") && codexSettings.includes("Start a Codex conversation") && codexSettings.includes("view.showSetup")],
  ["install upgrade and restart are actionable buttons", codexSettings.includes('"codex-install-action"') && codexSettings.includes('"codex-upgrade-action"') && codexSettings.includes('"codex-restart-action"')],
  ["workspace has explicit new-session action", shell.includes('className="workspace-new-session-button"') && shell.includes("onCreateWorkspaceSession(workspace)")],
  ["workspace remembers backend preference", app.includes("WORKSPACE_AGENT_STORAGE_KEY") && app.includes("persistWorkspaceAgentPreference(activeWorkspaceId, agent.id)")],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) {
  console.error(`Codex V3 P1 verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(`Codex V3 P1 verification passed (${checks.length}/${checks.length}).`);
