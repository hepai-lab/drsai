import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "drsai-memory-"));
try {
  process.env.DRSAI_HOME = root;
  const [{ ProjectMemoryStore }, { TeamMemoryStore }] = await Promise.all([import("../main/projectMemory.ts"), import("../main/teamMemory.ts")]);
  const projectPath = join(root, "project.json"); const workspaceA = "/workspace/a"; const workspaceB = "/workspace/b"; const keyA = createHash("sha256").update(workspaceA).digest("hex");
  await writeFile(projectPath, JSON.stringify({ workspaces: { [keyA]: [{ id: "memory-00000000-0000-4000-8000-000000000001", workspacePath: workspaceA, content: "legacy architecture note", source: "manual", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }, { broken: true }] } }));
  const projects = new ProjectMemoryStore(projectPath); assert.equal((await projects.list({ workspacePath: workspaceA })).length, 1); assert.equal((await projects.list({ workspacePath: workspaceB })).length, 0);
  const [api, ui] = await Promise.all([projects.add({ workspacePath: workspaceA, content: "API uses version two", source: "retrospective" }), projects.add({ workspacePath: workspaceA, content: "UI follows shared tokens", source: "chat_command" })]);
  assert.equal((await projects.list({ workspacePath: workspaceA, query: "api" }))[0].id, api.id); assert.equal((await projects.list({ workspacePath: workspaceA, query: "SHARED" }))[0].id, ui.id);
  const updated = await projects.update({ workspacePath: workspaceA, entryId: api.id, content: "API uses version three", source: "manual" }); assert.equal(updated.content, "API uses version three");
  assert.equal((await projects.clear({ workspacePath: workspaceA, entryId: ui.id })).removedCount, 1);
  await assert.rejects(() => projects.add({ workspacePath: workspaceA, content: "api_key=super-secret" }), /must not contain/i);
  await assert.rejects(() => projects.list({ workspacePath: workspaceA, query: "x".repeat(241) }), /query is invalid/i);
  assert.equal(JSON.parse(await readFile(projectPath, "utf8")).schemaVersion, 2);
  const remaining = (await projects.list({ workspacePath: workspaceA, limit: 100 })).length; assert.equal((await projects.clear({ workspacePath: workspaceA })).removedCount, remaining); assert.equal((await projects.list({ workspacePath: workspaceA })).length, 0);

  const teamPath = join(root, "team.json"); let identity = { userId: "user-1", groups: ["team-alpha"] }; const teams = new TeamMemoryStore(teamPath, async () => identity);
  const [rule, glossary] = await Promise.all([teams.add({ teamId: "team-alpha", content: "Deploy only after review" }), teams.add({ teamId: "team-alpha", content: "CERN means research group" })]);
  assert.equal(rule.createdBy, "user-1"); assert.equal((await teams.list({ teamId: "team-alpha", query: "cern" }))[0].id, glossary.id);
  await assert.rejects(() => teams.list({ teamId: "team-beta" }), /not authorized/i); await assert.rejects(() => teams.add({ teamId: "team-beta", content: "unauthorized" }), /not authorized/i);
  await assert.rejects(() => teams.add({ teamId: "team-alpha", content: "Bearer abc.def.ghi" }), /must not contain/i);
  identity = { userId: "user-2", groups: ["team-beta"] }; await assert.rejects(() => teams.delete({ teamId: "team-alpha", entryId: rule.id }), /not authorized/i);
  identity = { userId: "user-1", groups: ["team-alpha", "team-alpha", "bad/team"] }; assert.equal((await teams.list({ query: "review" }))[0].id, rule.id); assert.equal((await teams.delete({ teamId: "team-alpha", entryId: rule.id })).removedCount, 1); assert.equal((await teams.delete({ teamId: "team-alpha", entryId: rule.id })).removedCount, 0);
  assert.equal(JSON.parse(await readFile(teamPath, "utf8")).schemaVersion, 2);
  console.log("Project/team memory isolation, authorization, search, migration, concurrency, secret rejection and cleanup passed.");
} finally { await rm(root, { recursive: true, force: true }); }
