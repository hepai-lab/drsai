import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = mkdtempSync(join(tmpdir(), "opendrsai-remote-runtime-"));
const bundle = join(temp, "runtime-client.mjs");
const home = join(temp, "home");
process.env.DRSAI_HOME = home;
try {
  await build({ entryPoints: [join(root, "src/main/runtimeClient.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const runtime = await import(pathToFileURL(bundle).href + `?t=${Date.now()}`);
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert(body.binding?.kind === "ssh", "Remote OWOP request did not use the SSH binding");
    assert(body.workspace_id === "ws-remote", "Remote OWOP lost authoritative Workspace identity");
    assert(["pty.list", "git.worktree.list"].includes(body.operation), "unexpected OWOP operation");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, result: body.operation === "pty.list" ? { terminals: [] } : { worktrees: [] } }));
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(0, "127.0.0.1", ok));
  const address = server.address();
  const client = new runtime.RemoteRuntimeClient(`http://127.0.0.1:${address.port}`, "temporary-test-token");
  await client.executeOWOP("ws-remote", "pty.list", {});
  await client.executeOWOP("ws-remote", "git.worktree.list", {});
  await new Promise((resolveClose) => server.close(resolveClose));

  mkdirSync(join(home, "desktop"), { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(home, "desktop", "workspaces.json"), JSON.stringify([{
    id: "ws-offline", name: "Offline remote", path: "/srv/offline", location: "remote", transport: "ssh", type: "remote-ssh", trusted: true,
    createdAt: now, updatedAt: now, lastOpenedAt: now,
    remote: { hostAlias: "gpu-lab", canonicalPath: "/srv/offline", workspaceId: "ws-offline", connectionState: "disconnected" },
  }]));
  await expectReject(
    () => runtime.connectRuntimeClientForWorkspace("/srv/offline", "ws-offline"),
    /offline.*without local fallback.*stale cache is read-only/i,
    "offline Remote Workspace silently fell back to Local Runtime",
  );

  const remote = readFileSync(join(root, "src/main/remoteWorkspace.ts"), "utf8");
  const order = ["recovery.handshake", "recovery.instance-check", "recovery.workspace-reopen", "recovery.worktree-reconcile", "recovery.pty-discover", "recovery.event-replay-ready"];
  let cursor = -1;
  for (const phase of order) { const next = remote.indexOf(phase); assert(next > cursor, `recovery phase is missing or out of order: ${phase}`); cursor = next; }
  assert(remote.includes("remoteReadCache") && remote.includes("no stale read-only cache"), "offline read-only cache contract is missing");
  const terminal = readFileSync(join(root, "src/main/terminal.ts"), "utf8");
  assert(terminal.indexOf("if (options.workspaceId)") < terminal.indexOf("OPENDRSAI_ENABLE_LEGACY_REMOTE_PTY"), "Remote Terminal does not prefer unified Runtime OWOP");
  assert(terminal.includes("connectRuntimeClientForWorkspace") && terminal.includes('"pty.attach"'), "Remote Terminal is not using the shared Runtime lease path");
  const main = readFileSync(join(root, "src/main/index.ts"), "utf8");
  for (const channel of ["desktop:workspace-files", "desktop:workspace-file-preview", "desktop:workspace-file-write", "desktop:workspace-git-diff"]) {
    const section = main.slice(main.indexOf(channel), main.indexOf(channel) + 600);
    assert(section.includes("resolveRemoteWorkspaceTarget"), `${channel} lacks offline Remote fail-closed routing`);
  }
  const chat = readFileSync(join(root, "src/main/chat.ts"), "utf8");
  assert(chat.includes("connectRuntimeClientForWorkspace") && chat.includes("Agent Backend execution cannot fall back to Local Runtime"), "Agent Backend can still fall back locally for a Remote Workspace");
  assert(!chat.includes("LocalRuntimeClient"), "Codex Backend remains hard-wired to Local Runtime");
  console.log("Remote SSH OWOP binding, ordered recovery, unified PTY lease, stale reads, and offline fail-closed verification passed.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function assert(value, message) { if (!value) throw new Error(message); }
async function expectReject(operation, pattern, message) {
  try { await operation(); } catch (error) { if (pattern.test(String(error?.message || error))) return; throw error; }
  throw new Error(message);
}
