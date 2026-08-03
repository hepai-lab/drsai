import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requiresCodexSessionResume } from "../../shared/main/codexSessionResumePolicy";

assert.equal(
  requiresCodexSessionResume({ id: "thread-new", lastRunId: null, archiveSource: null }, "codex@1"),
  false,
  "a new local Codex thread must create its first Runtime Session even after optimistic message persistence",
);
assert.equal(requiresCodexSessionResume({ id: "session-codex-imported" }, "codex@1"), true);
assert.equal(requiresCodexSessionResume({ id: "legacy-thread", archiveSource: "codex" }, "codex@1"), true);
assert.equal(requiresCodexSessionResume({ id: "legacy-thread", lastRunId: "run-1" }, "codex@1"), true);
assert.equal(requiresCodexSessionResume({ id: "session-codex-imported" }, "opendrsai@1"), false);

const chatPath = resolve(process.cwd(), "../shared/main/chat.ts");
const chat = await readFile(chatPath, "utf8");
const syncIndex = chat.indexOf('client.syncBackendSessions(resolved.workspaceId, "codex")');
const failureIndex = chat.indexOf("codex_session_resume_required");
const createIndex = chat.indexOf("client.createSession(resolved.workspaceId");
assert(syncIndex >= 0 && failureIndex > syncIndex, "imported Codex tasks must try workspace sync before asking the user to recover");
assert(chat.includes("updateThread({ id: existingThread.id, runtimeSessionId })"), "a recovered binding must be persisted");
assert(createIndex > failureIndex, "new local tasks must fall through to Runtime Session creation");

console.log("Codex session resume policy verification passed.");
