import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { codexContinuationAction } from "../../shared/main/codexSessionResumePolicy";

const status = (state: "unbound" | "bound" | "recovery-required" | "conflict" | "backend-missing") =>
  ({ session_id: "session-1", backend_id: "codex", state });

assert.equal(codexContinuationAction(status("bound")), "continue");
assert.equal(codexContinuationAction(status("unbound")), "bind");
assert.equal(codexContinuationAction(status("backend-missing")), "create");
assert.equal(codexContinuationAction(status("recovery-required")), "recover");
assert.equal(codexContinuationAction(status("conflict")), "conflict");

const chat = await readFile(resolve(process.cwd(), "../shared/main/chat.ts"), "utf8");
const statusIndex = chat.indexOf("client.getBackendSessionBinding(existingThread.id)");
const syncIndex = chat.indexOf('client.syncBackendSessions(resolved.workspaceId, "codex"');
const createIndex = chat.indexOf("client.createSession(resolved.workspaceId");
assert(statusIndex >= 0 && syncIndex > statusIndex, "Codex continuation must query Runtime binding before discovery sync");
assert(chat.includes("codexContinuationAction(binding)"), "Desktop must interpret only the authoritative binding state");
assert(chat.includes("updateThread({ id: existingThread.id, runtimeSessionId })"), "a recovered binding must be persisted");
assert(createIndex > syncIndex, "an unbound new task must still fall through to Runtime Session creation");
assert(!chat.includes("requiresCodexSessionResume"), "thread metadata heuristics must be removed");

console.log("Codex authoritative Session binding policy verification passed.");
