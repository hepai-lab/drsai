import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { redactText } from "../../shared/main/diagnostics";
import { describeUserFacingError } from "../../shared/renderer/src/userFacingErrors";
import { applyThreadSnapshotPatch } from "../../shared/renderer/src/threadSnapshotPatch";

const root = resolve(process.cwd(), "../../..");
const canary = "Bearer SUPER_SECRET prompt=user-private-body command=remove-all https://example.test/?token=QUERY_SECRET";
const redacted = redactText(canary);
for (const secret of ["SUPER_SECRET", "user-private-body", "remove-all", "QUERY_SECRET"]) assert.equal(redacted.includes(secret), false);

const conflict = describeUserFacingError(new Error("codex_session_binding_conflict"), "en");
assert.deepEqual(conflict.actions.map((action) => action.id), ["resync_workspace", "new_task", "diagnostics"]);
const login = describeUserFacingError(new Error("codex_authentication_required"), "en");
assert.equal(login.actions[0]?.id, "login_codex");
const mismatch = describeUserFacingError(new Error("codex_session_model_mismatch"), "en");
assert.ok(mismatch.actions.some((action) => action.id === "new_task"));

const snapshot = { threadId: "t", title: "t", messages: [], updatedAt: 1, messageCount: 0 };
const afterConnection = applyThreadSnapshotPatch(snapshot, { version: 2, threadId: "t", runtimeSessionId: "s",
  generation: 1, baseSequence: 0, sessionSequence: 0,
  patch: { kind: "connection.state", state: "retrying", updatedAt: 2 } });
assert.equal(afterConnection, snapshot, "Transient connection state must not enter persisted conversation state");

const app = readFileSync(resolve(root, "apps/desktop/shared/renderer/src/App.tsx"), "utf8");
const renderer = readFileSync(resolve(root, "apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
const backend = readFileSync(resolve(root, "cores/python/packages/drsai/src/drsai/backend/codex_adapter/backend_client.py"), "utf8");
assert.equal(app.includes("THREAD_SNAPSHOT_STORAGE_KEY"), false);
assert.match(app, /connectionState: _transientConnectionState/);
assert.match(renderer, /structured-run-status/);
assert.match(renderer, /structured-process-label/);
assert.match(renderer, /structured-result-layer/);
assert.equal(/self\.rpc\._(?:generation|state)|self\.rpc\.supervisor/.test(backend), false,
  "Backend client must use the public JSON-RPC facade");

console.log(JSON.stringify({ passed: true, contentFreeDiagnostics: true, actionableErrors: true,
  transientConnectionState: true, fourLayerOutput: true, privateCouplingRemoved: true }));
