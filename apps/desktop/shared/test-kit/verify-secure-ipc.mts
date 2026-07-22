import { strict as assert } from "node:assert";
import {
  createSecureIpcHandle,
  DesktopIpcBoundaryError,
  getCurrentDesktopIpcAbortSignal,
  isTrustedDesktopIpcSender,
  type DesktopIpcAuditEvent,
  type DesktopIpcInvokeEvent,
} from "../main/secureIpc.ts";

function contents(url: string) {
  let destroyed = false;
  return {
    getURL: () => url,
    isDestroyed: () => destroyed,
    destroy: () => { destroyed = true; },
  };
}

const trusted = contents("file:///Applications/OpenDrSai.app/index.html");
const attacker = contents("https://attacker.invalid/");
assert.equal(isTrustedDesktopIpcSender({ sender: trusted, senderFrame: { url: trusted.getURL() } }, trusted), true);
assert.equal(isTrustedDesktopIpcSender({ sender: attacker, senderFrame: { url: trusted.getURL() } }, trusted), false);
assert.equal(isTrustedDesktopIpcSender({ sender: trusted, senderFrame: { url: attacker.getURL() } }, trusted), false);
assert.equal(isTrustedDesktopIpcSender({ sender: trusted, senderFrame: null }, trusted), false);
assert.equal(isTrustedDesktopIpcSender({ sender: trusted, senderFrame: { url: "http://localhost:5173/" } }, trusted, (url) => url === "http://localhost:5173/"), true);
trusted.destroy();
assert.equal(isTrustedDesktopIpcSender({ sender: trusted, senderFrame: { url: trusted.getURL() } }, trusted), false);

const owner = contents("file:///renderer/index.html");
const handlers = new Map<string, (event: DesktopIpcInvokeEvent, ...args: unknown[]) => unknown>();
const audit: DesktopIpcAuditEvent[] = [];
let clock = 100;
const secureHandle = createSecureIpcHandle({
  registrar: { handle: (channel, handler) => { handlers.set(channel, handler); } },
  getTrustedWebContents: () => owner,
  audit: (event) => { audit.push(event); },
  now: () => clock,
  defaultTimeoutMs: 50,
});

assert.throws(() => secureHandle("invalid channel", () => undefined), (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_CHANNEL_INVALID");
secureHandle("desktop:test-operation", async (_event, value) => {
  clock = 125;
  return `ok:${String(value)}`;
});
const invoke = handlers.get("desktop:test-operation");
assert.ok(invoke);
await assert.rejects(() => Promise.resolve(invoke({ sender: attacker, senderFrame: { url: owner.getURL() } }, "secret")), (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_CALLER_UNTRUSTED");
assert.equal(await invoke({ sender: owner, senderFrame: { url: owner.getURL() } }, "value"), "ok:value");
assert.deepEqual(audit.map(({ outcome, errorCode }) => ({ outcome, errorCode })), [
  { outcome: "blocked", errorCode: "IPC_CALLER_UNTRUSTED" },
  { outcome: "started", errorCode: undefined },
  { outcome: "succeeded", errorCode: undefined },
]);
assert.equal(audit.at(-1)?.durationMs, 25);
assert.equal(JSON.stringify(audit).includes("secret"), false, "audit must not contain IPC argument values");

secureHandle("desktop:test-failure", () => { throw new Error("private /Users/alice/token.txt"); });
const fail = handlers.get("desktop:test-failure");
assert.ok(fail);
await assert.rejects(
  () => Promise.resolve(fail({ sender: owner, senderFrame: { url: owner.getURL() } })),
  (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_HANDLER_FAILED" && !error.message.includes("/Users/alice"),
);
assert.equal(audit.at(-1)?.errorCode, "IPC_HANDLER_FAILED");
assert.equal(JSON.stringify(audit).includes("/Users/alice"), false, "audit must not contain handler errors");

secureHandle("desktop:test-schema", (_event, value) => value);
const schema = handlers.get("desktop:test-schema");
assert.ok(schema);
const cyclic: Record<string, unknown> = {};
cyclic.self = cyclic;
await assert.rejects(
  () => Promise.resolve(schema({ sender: owner, senderFrame: { url: owner.getURL() } }, cyclic)),
  (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_PAYLOAD_INVALID",
);
await assert.rejects(
  () => Promise.resolve(schema({ sender: owner, senderFrame: { url: owner.getURL() } }, () => undefined)),
  (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_PAYLOAD_INVALID",
);
class UnsupportedResult {}
secureHandle("desktop:test-result-schema", () => new UnsupportedResult());
await assert.rejects(
  () => Promise.resolve(handlers.get("desktop:test-result-schema")!({ sender: owner, senderFrame: { url: owner.getURL() } })),
  (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_PAYLOAD_INVALID",
);

let deduplicatedExecutions = 0;
secureHandle("desktop:test-deduplicate", async () => {
  deduplicatedExecutions += 1;
  await new Promise((resolve) => setTimeout(resolve, 5));
  return { execution: deduplicatedExecutions };
});
const deduplicate = handlers.get("desktop:test-deduplicate");
assert.ok(deduplicate);
const dedupeEvent = { sender: owner, senderFrame: { url: owner.getURL() } };
const [firstResult, secondResult] = await Promise.all([
  deduplicate(dedupeEvent, { requestId: "same-request" }),
  deduplicate(dedupeEvent, { requestId: "same-request" }),
]);
assert.deepEqual(firstResult, secondResult);
assert.equal(deduplicatedExecutions, 1, "concurrent duplicate requests must execute once");
assert.deepEqual(await deduplicate(dedupeEvent, { requestId: "same-request" }), firstResult, "completed duplicate must use the idempotency window");
assert.equal(deduplicatedExecutions, 1);

let timeoutSignal: AbortSignal | undefined;
const timeoutHandle = createSecureIpcHandle({
  registrar: { handle: (channel, handler) => { handlers.set(channel, handler); } },
  getTrustedWebContents: () => owner,
  defaultTimeoutMs: 5,
});
timeoutHandle("desktop:forced-timeout", async () => {
  timeoutSignal = getCurrentDesktopIpcAbortSignal();
  await new Promise((resolve) => setTimeout(resolve, 30));
  return true;
});
await assert.rejects(
  () => Promise.resolve(handlers.get("desktop:forced-timeout")!(dedupeEvent)),
  (error) => error instanceof DesktopIpcBoundaryError && error.code === "IPC_OPERATION_TIMEOUT",
);
assert.equal(timeoutSignal?.aborted, true, "timeout must abort the operation signal");

console.log("Shared secure IPC contract passed (trust, schema, errors, timeout, abort signal, deduplication and redacted audit).")
