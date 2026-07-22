import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = process.cwd();
const sourcePath = join(root, "..", "shared", "main", "remoteWorkspaceRestorePolicy.ts");
const output = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const loaded = { exports: {} };
new Function("exports", "module", "require", output)(loaded.exports, loaded, createRequire(import.meta.url));
const { isRemoteAcceptanceWorkspace, shouldRestorePersistedRemoteWorkspace } = loaded.exports;
const makeRemote = (overrides = {}) => ({ id: "workspace-real", name: "research", path: "/srv/research", location: "remote", transport: "ssh", type: "remote-ssh", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), trusted: true, remote: { hostAlias: "research-cluster", canonicalPath: "/srv/research", workspaceId: "workspace-real", connectionState: "disconnected", autoReconnect: true }, ...overrides });
const realWorkspace = makeRemote();
const acceptanceWorkspace = makeRemote({ id: "workspace-smoke", name: "opendrsai-remote-acceptance-rd_eqcyf", path: "/home/vscode/.cache/opendrsai/acceptance/opendrsai-remote-acceptance-rd_eqcyf", remote: { hostAlias: "opendrsai-external-smoke", canonicalPath: "/home/vscode/.cache/opendrsai/acceptance/opendrsai-remote-acceptance-rd_eqcyf", workspaceId: "workspace-smoke", connectionState: "disconnected" } });
assert.equal(shouldRestorePersistedRemoteWorkspace(realWorkspace), true, "Normal saved remote workspaces must retain startup restoration behavior.");
assert.equal(shouldRestorePersistedRemoteWorkspace(makeRemote({ remote: { ...realWorkspace.remote, autoReconnect: undefined } })), false, "Legacy workspaces without explicit reconnect intent must remain offline at startup.");
assert.equal(isRemoteAcceptanceWorkspace(acceptanceWorkspace), true);
assert.equal(shouldRestorePersistedRemoteWorkspace(acceptanceWorkspace), false, "Acceptance artifacts must never auto-connect in production.");
assert.equal(isRemoteAcceptanceWorkspace(makeRemote({ name: acceptanceWorkspace.name })), false, "A matching name alone must never remove a user workspace.");
assert.equal(isRemoteAcceptanceWorkspace(makeRemote({ remote: acceptanceWorkspace.remote })), false, "A matching host/path without the acceptance name must not be removed.");

const remoteSource = readFileSync(join(root, "src", "main", "remoteWorkspace.ts"), "utf8");
const acceptanceSource = readFileSync(join(root, "scripts", "verify-external-remote-host.mjs"), "utf8");
assert.ok(remoteSource.includes("shouldRestorePersistedRemoteWorkspace(workspace)"));
assert.ok(remoteSource.includes("setRemoteWorkspaceAutoReconnect(id, false)"));
assert.ok(acceptanceSource.includes('process.env.DRSAI_HOME = join(temporaryRoot, "isolated-drsai-home")'));
console.log("Remote startup restoration verification passed (normal saved hosts restored; strict acceptance artifacts skipped; external smoke persistence isolated)." );
