import { build } from "esbuild";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const fixture = mkdtempSync(join(tmpdir(), "opendrsai-workspace-location-"));
const home = join(fixture, "home");
const localFolder = join(fixture, "selected-local-folder");
const bundle = join(fixture, "workspaces.mjs");
mkdirSync(localFolder, { recursive: true });
process.env.DRSAI_HOME = home;

try {
  await build({ entryPoints: [join(root, "src/main/workspaces.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const api = await import(`${pathToFileURL(bundle).href}?fixture=${Date.now()}`);
  const created = await api.createWorkspace({ source: "existing", path: localFolder, name: "Selected local", trusted: true });
  assert(created.location === "local" && created.type === "local", "Local folder did not create a Local Workspace");
  const statePath = join(home, "desktop", "workspaces.json");
  assert(existsSync(statePath), "Workspace state was not persisted");
  const persisted = JSON.parse(readFileSync(statePath, "utf8"));
  assert(persisted[0].location === "local", "Persisted Local Workspace lost its location");

  const timestamp = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify([{
    id: "legacy-remote",
    name: "Legacy remote",
    path: "/home/vscode",
    type: "remote-ssh",
    remote: { hostAlias: "fixture", canonicalPath: "/home/vscode", workspaceId: "legacy-remote", connectionState: "disconnected" },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
    trusted: true,
  }]), "utf8");
  const migrated = await api.listWorkspaces();
  assert(migrated[0].location === "remote" && migrated[0].transport === "ssh", "Persisted legacy Remote Workspace did not migrate");
  console.log("Workspace location integration verification passed.");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
