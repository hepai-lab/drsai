import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const app = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const root = resolve(app, "../../..");
const fixtures = JSON.parse(await readFile(join(root, "protocol/orca-inspired/domain.fixtures.json"), "utf8"));
const schema = JSON.parse(await readFile(join(root, "protocol/orca-inspired/domain.schema.json"), "utf8"));
const temp = await mkdtemp(join(tmpdir(), "opendrsai-workspace-resources-"));

try {
  const bundle = join(temp, "workspaceResources.mjs");
  await build({ entryPoints: [join(app, "../shared/api/workspaceResources.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const api = await import(pathToFileURL(bundle).href);
  assert.equal(schema.version, "1.0");
  assert.deepEqual(schema["x-worktree-transitions"].removed, []);
  assert.deepEqual(schema["x-terminal-transitions"].exited, []);
  for (const value of fixtures.worktrees) api.assertWorktreeResource(value);
  for (const value of fixtures.terminals) api.assertTerminalResource(value);
  assert.equal(api.canTransitionWorktree("creating", "active"), true);
  assert.equal(api.canTransitionWorktree("removed", "active"), false);
  assert.equal(api.canTransitionTerminal("running", "detached"), true);
  assert.equal(api.canTransitionTerminal("exited", "running"), false);
  assert.equal(api.terminalStatusAfterTransportLoss("running"), "reconnecting");
  assert.notEqual(api.terminalStatusAfterTransportLoss("running"), "exited");
  for (const [kind, valid] of Object.entries({ worktree: "worktree-1", terminal: "terminal-1", terminalLease: "terminal-lease-1", hostProfile: "host-profile-1", portForward: "port-forward-1" })) {
    assert.equal(api.isWorkspaceResourceId(kind, valid), true);
    assert.equal(api.isWorkspaceResourceId(kind, "wrong-1"), false);
  }
  assert.throws(() => api.assertWorktreeResource({ ...fixtures.worktrees[0], unexpected: true }), /unknown_field/);
  assert.throws(() => api.assertWorktreeResource({ ...fixtures.worktrees[0], workspaceId: fixtures.worktrees[0].sourceWorkspaceId }), /identity_invalid/);
  console.log("Worktree and Terminal cross-language domain verification passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
