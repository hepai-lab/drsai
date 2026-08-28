import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = mkdtempSync(join(tmpdir(), "opendrsai-host-manager-"));
const bundle = join(temp, "host-manager.mjs");
try {
  await build({ entryPoints: [join(root, "src/main/hostConnectionManager.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const api = await import(pathToFileURL(bundle).href);
  let state = "disconnected";
  for (const next of ["resolving", "authenticating", "connecting", "runtime_check", "ready", "degraded", "reconnecting", "runtime_check", "ready"]) {
    state = api.transitionHostConnection(state, next);
  }
  assert(state === "ready", "Host Connection state machine did not converge to ready");
  assert(!api.canTransitionHostConnection("ready", "authenticating"), "invalid Host Connection transition was allowed");

  const file = join(temp, "host-profiles.json");
  const store = new api.HostProfileStore(file);
  const profile = api.makeHostProfile({ alias: "gpu-lab", hostname: "gpu.internal", port: 2222, user: "alice", configSource: "C:/Users/alice/.ssh/config", authPreference: "ssh_agent", identityFiles: ["~/.ssh/id_ed25519"], proxyJump: "bastion", knownHostFingerprint: "SHA256:test" });
  await store.upsert(profile);
  const restored = await store.list();
  assert(restored.length === 1 && restored[0].profileId === profile.profileId, "Host Profile did not persist");
  const raw = readFileSync(file, "utf8");
  assert(!/password|private key material|bearer/i.test(raw), "Host Profile persisted a plaintext secret");
  await expectReject(() => store.remove(profile.profileId, { workspaces: 1, ptys: 0, portForwards: 0 }), "active Host removal was allowed");
  assert(await store.remove(profile.profileId, { workspaces: 0, ptys: 0, portForwards: 0 }), "inactive Host removal failed");

  const redacted = api.redactSshDiagnostic("Permission denied token=abcdefghijklmnopqrstuvwxyz1234567890 password=hunter2");
  assert(!redacted.includes("hunter2") && !redacted.includes("abcdefghijklmnopqrstuvwxyz"), "SSH diagnostic leaked a secret");

  const remote = readFileSync(join(root, "src/main/remoteWorkspace.ts"), "utf8");
  assert(remote.includes('"-G", alias') && remote.includes("readSshConfigSources"), "OpenSSH Config/Include resolution is missing");
  assert(remote.includes("StrictHostKeyChecking=accept-new") && remote.includes("StrictHostKeyChecking=yes") && remote.includes("knownHostFingerprint"), "strict known_hosts confirmation/fingerprint persistence is missing");
  assert(remote.includes("hostConnections") && remote.includes("workspaceIds: new Set()"), "Host Connection is not shared by Workspaces");
  assert(remote.includes("ReconnectBackoff") && remote.includes("RuntimeInstanceTracker"), "reconnect handshake/backoff is missing");
  assert(remote.includes("nextRetryAt") && remote.includes("failureCategory") && remote.includes("redactSshDiagnostic"), "diagnostic phase/category/retry/redaction evidence is missing");
  for (const action of ["connectSshHost", "disconnectSshHost", "reconnectSshHost", "removeSshHostProfile"]) assert(remote.includes(`function ${action}`), `Host action ${action} is missing`);
  console.log("Host Profile, Connection state, reuse, security, recovery, diagnostics, and lifecycle verification passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function assert(value, message) { if (!value) throw new Error(message); }
async function expectReject(operation, message) { let rejected = false; try { await operation(); } catch { rejected = true; } assert(rejected, message); }
