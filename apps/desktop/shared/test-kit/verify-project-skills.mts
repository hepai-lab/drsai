import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "drsai-project-skills-"));
try {
  process.env.DRSAI_HOME = root;
  const [{ ProjectSkillStore }, { PersistentApprovalStore }] = await Promise.all([import("../main/projectSkills.ts"), import("../main/approvalStore.ts")]);
  const storePath = join(root, "desktop", "skills.json"); const skills = new ProjectSkillStore(storePath, join(root, "desktop")); const workspacePath = "/workspace/demo";
  const [draft, second] = await Promise.all([
    skills.create({ workspacePath, title: "API Review", content: "Always validate API compatibility and run contract tests.", source: "manual" }),
    skills.create({ workspacePath, content: "Document every migration with rollback evidence.", source: "project_memory", memoryEntryId: "memory-00000000-0000-4000-8000-000000000001" }),
  ]);
  assert.match(draft.skillMarkdown, /^---\nname: api-review-[a-f0-9-]{8}\ndescription: .+\n---\n/); assert.equal((await skills.list({ workspacePath, limit: 100 })).length, 2); assert.equal(second.source, "project_memory");
  await assert.rejects(() => skills.create({ workspacePath, content: "password=top-secret" }), /must not contain/i); await assert.rejects(() => skills.create({ workspacePath: "bad\npath", content: "valid" }), /path is invalid/i);

  const approvals = new PersistentApprovalStore(join(root, "approvals.json")); let installed: Awaited<ReturnType<typeof skills.install>> | undefined;
  const proposal = await approvals.propose({ source: "workflow", actionKind: "workflow.run", title: "Install project skill", detail: `Install ${draft.id}`, target: workspacePath, risk: "high", idempotencyKey: `skill-install:${"a".repeat(64)}` }, async () => { installed = await skills.install({ workspacePath, draftId: draft.id }); return true; });
  assert.equal(proposal.queued, true); assert(proposal.approval); assert.equal(installed, undefined); assert.equal(await approvals.decide({ id: proposal.approval.id, approved: true }), true); assert(installed); assert.equal(installed.alreadyInstalled, false); assert.equal(await readFile(installed.installPath, "utf8"), draft.skillMarkdown);
  assert.equal((await skills.install({ workspacePath, draftId: draft.id })).alreadyInstalled, true);
  await writeFile(installed.installPath, "tampered"); assert.equal((await skills.install({ workspacePath, draftId: draft.id })).alreadyInstalled, false); assert.equal(await readFile(installed.installPath, "utf8"), draft.skillMarkdown);

  const published = await skills.publish({ workspacePath, draftId: draft.id, notes: "Reviewed locally" }); assert.equal(published.alreadyPublished, false); const submission = JSON.parse(await readFile(published.submissionPath, "utf8")); assert.equal(submission.schemaVersion, 1); assert.match(submission.contentSha256, /^[a-f0-9]{64}$/); assert.equal(submission.notes, "Reviewed locally");
  assert.equal((await skills.publish({ workspacePath, draftId: draft.id, notes: "Reviewed locally" })).alreadyPublished, true);
  await assert.rejects(() => skills.publish({ workspacePath, draftId: draft.id, notes: "x".repeat(1001) }), /notes are invalid/i);
  const persisted = JSON.parse(await readFile(storePath, "utf8")); assert.equal(persisted.schemaVersion, 2);
  const allNames = await readdir(join(root, "desktop")); assert(allNames.every((name) => !name.includes(".staging-") && !name.includes(".backup-")));
  await approvals.shutdown();
  console.log("Project skill draft, frontmatter, secret validation, approval, atomic install/repair, publish integrity and migration passed.");
} finally { await rm(root, { recursive: true, force: true }); }
