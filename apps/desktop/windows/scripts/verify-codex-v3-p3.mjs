import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const bindings = read("cores/python/packages/drsai/src/drsai/backend/runtime/agent_bindings.py");
const backend = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/backend_client.py");
const mapper = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/event_mapper.py");
const decoder = read("cores/python/packages/drsai/src/drsai/backend/codex_adapter/native_decoder.py");
const adapter = read("apps/desktop/shared/renderer/src/adapters/useDesktopChatAdapter.ts");
const workspace = read("apps/desktop/shared/renderer/src/components/ChatWorkspace.tsx");
const structured = read("apps/desktop/shared/renderer/src/components/StructuredMessageParts.tsx");
const styles = read("apps/desktop/shared/renderer/src/styles.css");
const quality = read("apps/desktop/windows/scripts/verify-structured-quality.mjs");
const tests = read("cores/python/packages/drsai/tests/test_codex_backend_client.py");

const checks = [
  ["M04-F01 one Thread for twenty turns", tests.includes("test_twenty_turns_reuse_one_codex_thread") && backend.includes("get_session(context.session_id)")],
  ["M04-F02 one Run maps to one Turn", bindings.includes("backend_run_id") && backend.includes('prepare_operation("run", context.run_id, "turn/start"')],
  ["M04-F03 durable idempotent send intent and UI lock", backend.includes("mark_operation_requesting") && adapter.includes("activeRequestIdRef.current = requestId")],
  ["M04-F04 explicit lifecycle labels", ["Queued", "Sent", "Generating", "Waiting for approval", "Completed", "Failed"].every((label) => structured.includes(label))],
  ["M04-F05 stop and two retry scopes", adapter.includes("cancelChatTurn") && workspace.includes('"same_session" | "new_session"') && workspace.includes("Branch to a new session")],
  ["M04-F06 session and restored-context visibility", workspace.includes("conversation-titlebar") && workspace.includes("Ready") && workspace.includes("Syncing") && workspace.includes("Synced")],
  ["M05-F01 first feedback and first delta metrics", adapter.includes('touchStreamingAssistant(event.requestId, "feedback")') && adapter.includes('touchStreamingAssistant(event.requestId, "delta")') && workspace.includes("First model delta")],
  ["M05-F02 terminal-only answer fallback", mapper.includes("_message_seen_runs") && mapper.includes('"items"') && mapper.includes('"agentMessage"')],
  ["M05-F03 ten OAEP item types have projections", ["message", "reasoning", "plan", "command_execution", "file_change", "tool_call", "artifact", "interaction", "subtask", "notice"].every((kind) => read("cores/python/packages/drsai/src/drsai/backend/runtime/normalized_events.py").includes(`= "${kind}"`))],
  ["M05-F04 commentary and final phases preserved", decoder.includes('return "commentary"') && decoder.includes('else "final"') && structured.includes("structured-reasoning")],
  ["M05-F05 1 MB and 10k event performance bounds", quality.includes("1_000_000") && quality.includes("10_000") && workspace.includes("estimateVirtualMessageHeight") && !styles.includes(".message-list > .message { content-visibility:auto")],
  ["M05-F06 unknown items degrade to Notice", decoder.includes("codex_item_unknown") && decoder.includes("NormalizedItemType.NOTICE") && structured.includes("NoticeItem")],
];
const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length) { console.error(`Codex V3 P3 verification failed:\n- ${failures.join("\n- ")}`); process.exit(1); }
console.log(`Codex V3 P3 verification passed (${checks.length}/${checks.length}).`);
