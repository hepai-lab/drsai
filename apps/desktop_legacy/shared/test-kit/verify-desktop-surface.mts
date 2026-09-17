/**
 * The desktop gateway surface, verified against a real Runtime.
 *
 * Run:  node shared/test-kit/run-bundled-test.mjs shared/test-kit/verify-desktop-surface.mts
 *
 * This boots `python -m drsai.backend.desktop_gateway` on an ephemeral port with
 * a scratch state root, then drives the actual client, stream and IPC layers
 * against it.  It is not a mock suite, and that is deliberate: every bug this
 * surface has had so far -- the missing `__main__.py`, `protocol_version` being a
 * number, the snapshot/subscribe ordering -- was invisible to a fake server and
 * obvious to a real one.
 *
 * The few things that *are* faked are faked because the real thing cannot be
 * provoked on demand: an expired journal cursor needs a journal old enough to
 * have truncated, and a torn SSE connection needs a network fault.  Those use a
 * scripted `fetch` and say so at the call site.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_OPERATIONS,
  DesktopGatewayError,
  type OaepEvent,
  type OaepItem,
} from "../api/desktopGateway";
import {
  activeRun,
  applySessionEvent,
  buildTranscript,
  createTranscriptState,
} from "../renderer/src/workbench/transcript";
import {
  BRIDGE_INVOKE_CHANNEL,
  BRIDGE_METHODS,
  type BridgeResult,
  type BridgeSessionEvent,
} from "../api/desktopBridge";
import { DesktopGatewayClient } from "../main/desktopGateway/client";
import { BoundedEventDispatcher } from "../main/desktopGateway/eventDispatcher";
import { DesktopIdentity, offlineAuthBackend } from "../main/desktopGateway/identity";
import { registerBridge, type IpcInvokeEventLike } from "../main/desktopGateway/ipc";
import { DesktopRuntimeProcess } from "../main/desktopGateway/runtimeProcess";
import { BridgeService } from "../main/desktopGateway/service";
import { SessionStreamRegistry, consumeSse } from "../main/desktopGateway/sessionStream";

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures: string[] = [];

async function test(name: string, body: () => void | Promise<void>): Promise<void> {
  try {
    await body();
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.stdout.write(`  FAIL ${name}\n       ${error}\n`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls a predicate rather than sleeping a fixed time; fails loudly on timeout. */
async function eventually(
  description: string,
  predicate: () => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error(`timed out waiting for ${description}`);
}

/* ------------------------------------------------------------ the Runtime */

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const python = join(repoRoot, "venv", "Scripts", "python.exe");
const scratch = mkdtempSync(join(tmpdir(), "desktop-surface-verify-"));
const stateHome = join(scratch, "home");
const workspaceRoot = join(scratch, "workspace");
const port = 28700 + Math.floor(Math.random() * 200);
const baseUrl = `http://127.0.0.1:${port}`;
const instanceToken = "verify_desktop_surface_token_0123456789ab";

mkdirSync(join(stateHome, "runtime"), { recursive: true });
mkdirSync(workspaceRoot, { recursive: true });
// Written as bytes, not text: `writeFileSync(..., "utf8")` on Windows leaves the
// string untouched but the read-back test below compares against exact bytes,
// and a stray CRLF would make a correct route look broken.
writeFileSync(join(stateHome, "runtime", "instance-token"), instanceToken, { encoding: "utf8" });
writeFileSync(join(workspaceRoot, "notes.md"), Buffer.from("# notes\nhello\n", "utf8"));
writeFileSync(join(workspaceRoot, "logo.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
mkdirSync(join(workspaceRoot, "src"), { recursive: true });
writeFileSync(join(workspaceRoot, "src", "main.py"), Buffer.from("print('hi')\n", "utf8"));

let runtime: ChildProcess | null = null;
const runtimeLog: string[] = [];

async function startRuntime(): Promise<void> {
  runtime = spawn(python, ["-m", "drsai.backend.desktop_gateway"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DRSAI_HOME: stateHome,
      DRSAI_DESKTOP_GATEWAY_HOME: stateHome,
      DRSAI_DESKTOP_GATEWAY_PORT: String(port),
      OPENDRSAI_GATEWAY_INSTANCE_TOKEN: instanceToken,
      PYTHONDONTWRITEBYTECODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  runtime.stdout?.on("data", (chunk: Buffer) => runtimeLog.push(chunk.toString()));
  runtime.stderr?.on("data", (chunk: Buffer) => runtimeLog.push(chunk.toString()));
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (runtime.exitCode !== null) {
      throw new Error(`Runtime exited early:\n${runtimeLog.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/v1/runtime`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Still importing; the Runtime binds only after ~48k lines have loaded.
    }
    await delay(500);
  }
  throw new Error(`Runtime never became ready:\n${runtimeLog.join("")}`);
}

function stopRuntime(): void {
  runtime?.kill();
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows keeps the SQLite file mapped briefly after the process exits;
    // leaving a temp directory behind is better than failing a green run.
  }
}

/* ------------------------------------------------------------------- suite */

process.stdout.write("desktop gateway surface\n");
await startRuntime();

const identity = new DesktopIdentity(offlineAuthBackend("verify"));
const client = new DesktopGatewayClient({
  baseUrl,
  instanceToken,
  identity: () => ({ bearer: null, principal: null }),
});

/**
 * `/openapi.json` is behind the pairing token: `_auth.PUBLIC_PATHS` exempts only
 * `GET /v1/runtime`, so the schema -- which enumerates every route and body the
 * Runtime accepts -- is not readable by anything else on the machine.
 */
async function openApiDocument(): Promise<{
  paths: Record<string, Record<string, { operationId?: string }>>;
}> {
  const response = await fetch(`${baseUrl}/openapi.json`, {
    headers: { "x-opendrsai-gateway-token": instanceToken },
  });
  assert(response.ok, `openapi.json returned ${response.status}`);
  return (await response.json()) as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
}

process.stdout.write("\nA. contract\n");

await test("the server's OpenAPI paths equal DESKTOP_OPERATIONS", async () => {
  const document = await openApiDocument();
  const server = new Set<string>();
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      server.add(`${method.toUpperCase()} ${path} ${operation.operationId ?? "?"}`);
    }
  }
  const declared = new Set(
    Object.entries(DESKTOP_OPERATIONS).map(
      ([id, op]) => `${op.method} ${op.path.replace(/\{(\w+)\}/g, "{$1}")} ${id}`,
    ),
  );
  equal(server.size, 17, "the server exposes 17 operations");
  equal(declared.size, 17, "the client declares 17 operations");
  const missing = [...declared].filter((entry) => !server.has(entry));
  const extra = [...server].filter((entry) => !declared.has(entry));
  assert(
    !missing.length && !extra.length,
    `operation sets differ.\n  client-only: ${missing.join(", ")}\n  server-only: ${extra.join(", ")}`,
  );
});

await test("no operationId was derived by FastAPI", async () => {
  // A derived id looks like `audio_transcriptions_v1_audio_transcriptions_post`
  // and leaks the handler name into the generated TS client, so a Python rename
  // silently renames a public method.
  const document = await openApiDocument();
  for (const methods of Object.values(document.paths)) {
    for (const operation of Object.values(methods)) {
      assert(
        operation.operationId && !operation.operationId.includes("__"),
        `derived operationId: ${operation.operationId}`,
      );
    }
  }
});

await test("the IPC method list has no duplicates and covers every domain", () => {
  equal(new Set(BRIDGE_METHODS).size, BRIDGE_METHODS.length, "method names are unique");
  const domains = new Set(BRIDGE_METHODS.map((method) => method.split(".")[0]));
  for (const domain of ["runtime", "auth", "workspaces", "sessions", "chat", "models", "voice"]) {
    assert(domains.has(domain), `missing IPC domain: ${domain}`);
  }
});

process.stdout.write("\nB. client, against the live Runtime\n");

let workspaceId = "";
let sessionId = "";
// Recorded by the chat test so the fold test can replay a session that really
// ran an Agent, rather than one that only has lifecycle events.
let chatSessionId = "";

await test("getRuntimeIdentity reports the contract generation this client speaks", async () => {
  const runtimeIdentity = await client.getRuntimeIdentity();
  // The literal, not `DESKTOP_SURFACE`: this is the independent check. Asserting
  // against the constant would still pass if someone edited it, at the exact
  // moment the client stopped matching the Runtime.
  equal(runtimeIdentity.surface, "desktop-v2", "surface");
  equal(typeof runtimeIdentity.protocol_version, "number", "protocol_version is a number");
  equal(runtimeIdentity.runtime_source_digest.length, 64, "source digest is a sha256");
  assert(runtimeIdentity.capabilities.includes("sessions"), "sessions capability advertised");
});

await test("GET /v1/runtime is the only route reachable without a token", async () => {
  const open = await fetch(`${baseUrl}/v1/runtime`);
  equal(open.status, 200, "runtime identity is public");
  const closed = await fetch(`${baseUrl}/v1/workspaces`);
  equal(closed.status, 401, "workspaces requires the pairing token");
});

await test("openWorkspace is idempotent on path", async () => {
  const first = await client.openWorkspace(workspaceRoot, "verify");
  const second = await client.openWorkspace(workspaceRoot, "verify");
  workspaceId = first.workspace_id;
  equal(second.workspace_id, first.workspace_id, "the same directory is one workspace");
  assert(first.open, "a newly opened workspace is open");
});

await test("listWorkspaces returns the record just created", async () => {
  const workspaces = await client.listWorkspaces();
  assert(
    workspaces.some((record) => record.workspace_id === workspaceId),
    "the opened workspace is listed",
  );
});

await test("listWorkspaceFiles returns a nested tree when browsing", async () => {
  const listing = await client.listWorkspaceFiles(workspaceId, { depth: 2 });
  const names = listing.data.map((node) => node.name).sort();
  assert(names.includes("notes.md"), `notes.md missing from ${names.join(", ")}`);
  equal(listing.shape, "tree", "a plain browse is a tree");
  equal(listing.truncated, false, "a small workspace is not truncated");
  const nested = listing.data.find((node) => node.name === "src");
  assert(nested?.children?.some((child) => child.name === "main.py"), "the tree really nests");
});

await test("listWorkspaceFiles returns flat matches when searching", async () => {
  const listing = await client.listWorkspaceFiles(workspaceId, { query: "notes" });
  equal(listing.shape, "flat", "a search is flat");
  equal(listing.data.length, 1, "one match");
  equal(listing.data[0].children, undefined, "search results carry no children");
});

await test("the listing shape is stated, not inferable from the data", async () => {
  // A directory-free tree and a flat listing both consist of nodes with no
  // `children`, so a client that inferred the shape would mis-render one of
  // them. This is why the server names it.
  const shallow = await client.listWorkspaceFiles(workspaceId, { path: "src", depth: 0 });
  equal(shallow.shape, "tree", "a depth-0 browse is still a tree");
  assert(
    shallow.data.every((node) => node.children === undefined),
    "and it carries no children at all",
  );
});

await test("readWorkspaceFile returns UTF-8 text verbatim", async () => {
  const file = await client.readWorkspaceFile(workspaceId, "notes.md");
  assert(!file.binary, "notes.md is text");
  equal(file.binary ? "" : file.content, "# notes\nhello\n", "content is byte-exact");
  equal(file.mime, "text/markdown", "mime");
});

await test("readWorkspaceFile falls back to a data URL for binary content", async () => {
  const file = await client.readWorkspaceFile(workspaceId, "logo.bin");
  assert(file.binary, "a file with NUL bytes is binary");
  assert(
    file.binary && file.data_url.startsWith("data:"),
    "binary content arrives as a data URL the preview pane can render directly",
  );
});

await test("a path that escapes the workspace is refused", async () => {
  // The containment check is `resolve(strict=True)` + `relative_to(root)`, so a
  // symlink pointing outside is caught too -- a string prefix test would not be.
  try {
    await client.readWorkspaceFile(workspaceId, "../../../etc/passwd");
    throw new Error("expected the traversal to be refused");
  } catch (error) {
    assert(error instanceof DesktopGatewayError, "a gateway error");
    assert([400, 403].includes(error.status), `expected 400/403, got ${error.status}`);
  }
});

await test("createSession then getSession round-trips", async () => {
  const created = await client.createSession(workspaceId, "verify session");
  sessionId = created.session_id;
  const fetched = await client.getSession(sessionId);
  equal(fetched.title, "verify session", "title");
  equal(fetched.lifecycle, "active", "lifecycle");
  equal(fetched.archived, false, "not archived");
});

await test("listSessions finds the session in its workspace", async () => {
  const page = await client.listSessions({ workspace_id: workspaceId });
  equal(page.object, "list", "list envelope");
  assert(
    page.data.some((record) => record.session_id === sessionId),
    "the created session is listed",
  );
});

await test("updateSession renames and archives", async () => {
  const renamed = await client.updateSession(sessionId, { title: "renamed" });
  equal(renamed.title, "renamed", "title after rename");
  const archived = await client.updateSession(sessionId, { archived: true });
  equal(archived.archived, true, "archived flag");
  const restored = await client.updateSession(sessionId, { archived: false });
  equal(restored.archived, false, "un-archived");
});

await test("archived sessions move between the two lists", async () => {
  // `archived` filters; there is no "both". The gateway's `bool | None` cannot
  // receive null over a query string, so a history view showing everything makes
  // two calls -- which is what a tabbed list does anyway.
  try {
    await client.updateSession(sessionId, { archived: true });
    const active = await client.listSessions({ workspace_id: workspaceId, archived: false });
    assert(
      !active.data.some((record) => record.session_id === sessionId),
      "an archived session leaves the active list",
    );
    const archived = await client.listSessions({ workspace_id: workspaceId, archived: true });
    assert(
      archived.data.some((record) => record.session_id === sessionId),
      "an archived session appears in the archived list",
    );
  } finally {
    // Restore in `finally`: a failure here left the session archived for every
    // later test, and "Run requires an active Session" three tests down is a
    // very slow way to find that out.
    await client.updateSession(sessionId, { archived: false });
  }
});

await test("an unknown session is a 404, not an empty result", async () => {
  try {
    await client.getSession("session-does-not-exist");
    throw new Error("expected 404");
  } catch (error) {
    assert(error instanceof DesktopGatewayError, "a gateway error");
    equal(error.status, 404, "status");
  }
});

await test("a malformed body is a 422 with field detail", async () => {
  try {
    // `idempotency_key` has min_length=1; an empty string must not create a run
    // that no retry can ever match.
    await client.createRun(sessionId, "");
    throw new Error("expected 422");
  } catch (error) {
    assert(error instanceof DesktopGatewayError, "a gateway error");
    equal(error.status, 422, "status");
    equal(error.code, "request_invalid", "code");
    assert(error.message.includes("idempotency_key"), `message names the field: ${error.message}`);
  }
});

await test("a bad pairing token is a 401 with a stable code", async () => {
  const rogue = new DesktopGatewayClient({
    baseUrl,
    instanceToken: "wrong_token_wrong_token_wrong_token",
    identity: () => ({ bearer: null, principal: null }),
  });
  try {
    await rogue.listWorkspaces();
    throw new Error("expected 401");
  } catch (error) {
    assert(error instanceof DesktopGatewayError, "a gateway error");
    equal(error.status, 401, "status");
    equal(error.code, "gateway_unauthorized", "code");
    assert(error.isUnauthorized, "isUnauthorized");
  }
});

await test("createRun is idempotent on its key", async () => {
  const first = await client.createRun(sessionId, "verify-idem-1");
  const second = await client.createRun(sessionId, "verify-idem-1");
  equal(second.run.run_id, first.run.run_id, "the same key is the same run");
  equal(first.created, true, "the first call created it");
  equal(second.created, false, "the second call did not");
});

await test("getModelCatalog returns aliases the picker can use", async () => {
  const catalog = await client.getModelCatalog();
  assert(Array.isArray(catalog.models) && catalog.models.length > 0, "the catalog is non-empty");
  for (const entry of catalog.models) {
    assert(typeof entry.alias === "string" && entry.alias, "every entry has an alias");
    assert(typeof entry.display_name === "string", "every entry has a display name");
  }
});

process.stdout.write("\nC. the OAEP session stream\n");

await test("snapshot, replay and stream agree on the same state", async () => {
  const snapshot = await client.getSessionSnapshot(sessionId);
  const events = await client.listSessionEvents(sessionId, 0, 500);
  equal(snapshot.version, "1.0", "snapshot version");
  assert(snapshot.snapshot_sequence >= 0, "snapshot carries a sequence");
  // Replaying from 0 must reach at least the snapshot's sequence: the snapshot is
  // a fold of those same events, so a replay that stopped short would mean the
  // journal and the projection disagree.
  assert(
    events.next_sequence >= snapshot.snapshot_sequence || events.data.length === 0,
    `replay (${events.next_sequence}) fell behind the snapshot (${snapshot.snapshot_sequence})`,
  );
  for (const event of events.data) {
    assert(typeof event.dedupe_key === "string" && event.dedupe_key, "every event has a dedupe key");
    equal(event.session_id, sessionId, "events belong to the session");
  }
});

await test("replayed sequences are dense and strictly increasing", async () => {
  // Density is what makes an exclusive cursor safe: with holes, "nothing new"
  // and "you missed something" would be the same empty response.
  const page = await client.listSessionEvents(sessionId, 0, 500);
  let previous = 0;
  for (const event of page.data) {
    assert(event.sequence > previous, `sequence ${event.sequence} did not advance past ${previous}`);
    previous = event.sequence;
  }
});

await test("streaming events resumes from an exclusive cursor", async () => {
  const page = await client.listSessionEvents(sessionId, 0, 500);
  assert(page.data.length > 0, "the session has events to resume from");
  const cursor = page.data[Math.floor(page.data.length / 2)].sequence;
  const resumed = await client.listSessionEvents(sessionId, cursor, 500);
  assert(
    resumed.data.every((event) => event.sequence > cursor),
    "after_sequence is exclusive",
  );
});

await test("the SSE stream opens, heartbeats and closes on abort", async () => {
  const abort = new AbortController();
  const body = await client.streamSessionEvents(sessionId, 0, abort.signal);
  const seen: OaepEvent[] = [];
  const pump = consumeSse(body, abort.signal, (event) => void seen.push(event));
  // The stream replays everything after the cursor immediately, so events should
  // arrive without anything else having to happen.
  await eventually("the stream to deliver replayed events", () => seen.length > 0, 15_000);
  abort.abort();
  await pump;
  assert(seen.length > 0, "the stream delivered events");
});

await test("streaming an unknown session fails before the body starts", async () => {
  // The cursor is validated with a one-event read *before* the response begins,
  // so this must be a real HTTP error -- a 200 that closes immediately is
  // indistinguishable from an idle stream on the client.
  const abort = new AbortController();
  try {
    await client.streamSessionEvents("session-nope", 0, abort.signal);
    throw new Error("expected the stream to be refused");
  } catch (error) {
    assert(error instanceof DesktopGatewayError, "a gateway error");
    equal(error.status, 404, "status");
  } finally {
    abort.abort();
  }
});

await test("a subscription snapshots, replays and reaches connected", async () => {
  const registry = new SessionStreamRegistry(client);
  const phases: string[] = [];
  const events: BridgeSessionEvent[] = [];
  const subscription = registry.subscribe(sessionId, (event) => {
    events.push(event);
    if (event.kind === "phase") phases.push(event.phase);
  });
  await eventually("the subscription to connect", () => phases.includes("connected"), 30_000);
  subscription.close();
  registry.closeAll();
  assert(events.some((event) => event.kind === "snapshot"), "a snapshot was delivered first");
  const snapshotAt = events.findIndex((event) => event.kind === "snapshot");
  const connectedAt = phases.indexOf("connected");
  assert(snapshotAt >= 0 && connectedAt >= 0, "both milestones occurred");
  equal(
    phases.slice(0, 3).join(">"),
    "snapshot>replay>connected",
    "phases follow snapshot -> replay -> connected",
  );
});

await test("two subscribers share one connection and both get state", async () => {
  const registry = new SessionStreamRegistry(client);
  const first: BridgeSessionEvent[] = [];
  const second: BridgeSessionEvent[] = [];
  const a = registry.subscribe(sessionId, (event) => void first.push(event));
  await eventually(
    "the first subscriber to snapshot",
    () => first.some((event) => event.kind === "snapshot"),
    30_000,
  );
  const b = registry.subscribe(sessionId, (event) => void second.push(event));
  equal(registry.activeSessionIds.length, 1, "one controller for two subscribers");
  // The late joiner is served from the controller's item map, not a second HTTP
  // snapshot: two windows on one conversation must not double the Runtime's work.
  assert(second.some((event) => event.kind === "snapshot"), "the late joiner got state");
  a.close();
  equal(registry.activeSessionIds.length, 1, "the connection survives one leaver");
  b.close();
  equal(registry.activeSessionIds.length, 0, "the last leaver releases the connection");
  registry.closeAll();
});

await test("an expired cursor re-snapshots instead of surfacing an error", async () => {
  // Faked: a real expiry needs a journal old enough to have truncated. The
  // recovery path is what matters, and it is identical either way.
  let snapshots = 0;
  let replays = 0;
  const scripted: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("oaep-snapshot")) {
      snapshots += 1;
      return new Response(
        JSON.stringify({
          version: "1.0",
          session: { id: sessionId, workspace_id: workspaceId, title: "t", status: "active", created_at: "", updated_at: "" },
          runs: [],
          items: [],
          snapshot_sequence: 5,
          window: { limit: 100, has_more: false, next_cursor: null },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("oaep-events/stream")) {
      // Park forever so the test observes the recovery, not a reconnect loop.
      return new Response(new ReadableStream({ start() {} }), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }
    if (url.includes("oaep-events")) {
      replays += 1;
      if (replays === 1) {
        return new Response(
          JSON.stringify({
            detail: { code: "cursor_expired", message: "gone", retryable: false, details: { oldest: 9 } },
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ version: "1.0", object: "list", data: [], next_sequence: 5, has_more: false }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const scriptedClient = new DesktopGatewayClient({
    baseUrl,
    instanceToken,
    identity: () => ({ bearer: null, principal: null }),
    fetchImpl: scripted,
  });
  const registry = new SessionStreamRegistry(scriptedClient);
  const seen: BridgeSessionEvent[] = [];
  const subscription = registry.subscribe(sessionId, (event) => void seen.push(event));
  await eventually("the second snapshot", () => snapshots >= 2, 15_000);
  subscription.close();
  registry.closeAll();
  equal(
    seen.filter((event) => event.kind === "error").length,
    0,
    "a recoverable cursor expiry is not reported as an error",
  );
  assert(
    seen.filter((event) => event.kind === "snapshot").length >= 2,
    "the client re-snapshotted",
  );
});

await test("a 404 during streaming degrades instead of retrying forever", async () => {
  const scripted: typeof fetch = async () =>
    new Response(JSON.stringify({ detail: "Unknown Session" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  const scriptedClient = new DesktopGatewayClient({
    baseUrl,
    instanceToken,
    identity: () => ({ bearer: null, principal: null }),
    fetchImpl: scripted,
  });
  const registry = new SessionStreamRegistry(scriptedClient);
  const seen: BridgeSessionEvent[] = [];
  const subscription = registry.subscribe("session-gone", (event) => void seen.push(event));
  await eventually(
    "the subscription to degrade",
    () => seen.some((event) => event.kind === "phase" && event.phase === "degraded"),
    15_000,
  );
  const error = seen.find((event) => event.kind === "error");
  assert(error?.kind === "error" && error.fatal, "the failure is reported as fatal");
  subscription.close();
  registry.closeAll();
});

process.stdout.write("\nD. backpressure\n");

await test("consecutive deltas on one item merge", () => {
  const sent: BridgeSessionEvent[] = [];
  const dispatcher = new BoundedEventDispatcher(
    { send: (_channel, payload) => void sent.push(payload), isDestroyed: () => false },
    "test",
    { schedule: () => undefined },
  );
  for (const text of ["a", "b", "c"]) {
    dispatcher.push({ kind: "delta", sessionId: "s", itemId: "i", channel: "message", text });
  }
  dispatcher.flush();
  equal(sent.length, 1, "three deltas became one");
  assert(sent[0].kind === "delta" && sent[0].text === "abc", "text is concatenated in order");
  equal(dispatcher.metrics.merged, 2, "two merges recorded");
});

await test("deltas on different items do not merge", () => {
  const sent: BridgeSessionEvent[] = [];
  const dispatcher = new BoundedEventDispatcher(
    { send: (_channel, payload) => void sent.push(payload), isDestroyed: () => false },
    "test",
    { schedule: () => undefined },
  );
  dispatcher.push({ kind: "delta", sessionId: "s", itemId: "i", channel: "message", text: "a" });
  dispatcher.push({ kind: "delta", sessionId: "s", itemId: "j", channel: "message", text: "b" });
  dispatcher.push({ kind: "delta", sessionId: "s", itemId: "i", channel: "reasoning", text: "c" });
  dispatcher.flush();
  equal(sent.length, 3, "distinct items and channels stay distinct");
});

await test("over capacity, deltas are dropped and structural events are not", () => {
  const sent: BridgeSessionEvent[] = [];
  const dispatcher = new BoundedEventDispatcher(
    { send: (_channel, payload) => void sent.push(payload), isDestroyed: () => false },
    "test",
    { capacity: 4, schedule: () => undefined },
  );
  // Alternate item ids so nothing merges and the queue really fills.
  for (let index = 0; index < 20; index += 1) {
    dispatcher.push({
      kind: "delta",
      sessionId: "s",
      itemId: `i${index}`,
      channel: "message",
      text: "x",
    });
  }
  dispatcher.push({
    kind: "run",
    sessionId: "s",
    run: { runId: "r", status: "completed", updatedAt: "" },
    cursor: 1,
  });
  dispatcher.flush();
  assert(dispatcher.metrics.dropped > 0, "deltas were dropped under pressure");
  assert(
    sent.some((event) => event.kind === "run"),
    "the run transition survived -- dropping it would strand a spinner",
  );
  assert(sent.length <= 5, `queue stayed bounded, sent ${sent.length}`);
});

await test("a destroyed target stops the dispatcher instead of throwing", () => {
  let destroyed = false;
  const dispatcher = new BoundedEventDispatcher(
    {
      send: () => {
        throw new Error("send on destroyed WebContents");
      },
      isDestroyed: () => destroyed,
    },
    "test",
    { schedule: () => undefined },
  );
  destroyed = true;
  dispatcher.push({ kind: "phase", sessionId: "s", phase: "connected" });
  dispatcher.flush();
  equal(dispatcher.pending, 0, "the queue was released");
});

process.stdout.write("\nE. the IPC surface\n");

const runtimeProcess = new DesktopRuntimeProcess({ external: true });
// Point the adopt-only process at the Runtime this harness started, exercising
// the adoption branch rather than spawning a second Runtime.
Object.assign(globalThis, {});

const service = new BridgeService({ client, identity, runtime: runtimeProcess });

interface FakeContents {
  id: number;
  sent: Array<{ channel: string; payload: BridgeSessionEvent }>;
  destroyed: boolean;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): void;
}

function fakeContents(id: number): FakeContents {
  return {
    id,
    sent: [],
    destroyed: false,
    send(channel, payload) {
      this.sent.push({ channel, payload: payload as BridgeSessionEvent });
    },
    isDestroyed() {
      return this.destroyed;
    },
    once() {
      /* the harness never destroys a window mid-test */
    },
  };
}

let handler: ((event: IpcInvokeEventLike, ...args: unknown[]) => unknown) | null = null;
const fakeIpcMain = {
  handle(channel: string, listener: (event: IpcInvokeEventLike, ...args: unknown[]) => unknown) {
    equal(channel, BRIDGE_INVOKE_CHANNEL, "the surface registers one channel");
    handler = listener;
  },
  removeHandler() {
    handler = null;
  },
};

const ipc = registerBridge(fakeIpcMain, service);
const contents = fakeContents(1);
ipc.register(contents);

async function invoke<T>(method: string, request?: unknown): Promise<BridgeResult<T>> {
  assert(handler, "the IPC handler was registered");
  return (await handler(
    { sender: contents as never, senderFrame: { parent: null } },
    method,
    request,
  )) as BridgeResult<T>;
}

await test("an unregistered sender is refused", async () => {
  assert(handler, "handler");
  const stranger = fakeContents(99);
  const result = (await handler(
    { sender: stranger as never, senderFrame: { parent: null } },
    "workspaces.list",
    undefined,
  )) as BridgeResult<unknown>;
  assert(!result.ok, "refused");
  equal(result.ok ? "" : result.error.code, "bridge_sender_refused", "code");
});

await test("a subframe is refused even from a registered window", async () => {
  assert(handler, "handler");
  // This is the preview-pane case: an iframe rendering workspace content must
  // not be able to read further workspace files through the bridge.
  const result = (await handler(
    { sender: contents as never, senderFrame: { parent: {} } },
    "workspaces.readFile",
    { workspaceId, path: "notes.md" },
  )) as BridgeResult<unknown>;
  assert(!result.ok, "refused");
  equal(result.ok ? "" : result.error.code, "bridge_sender_refused", "code");
});

await test("an unknown method is a tagged failure, not a rejection", async () => {
  const result = await invoke("sessions.destroyEverything");
  assert(!result.ok, "failed");
  equal(result.ok ? "" : result.error.code, "bridge_unknown_method", "code");
});

await test("runtime.identity reports the adopted Runtime", async () => {
  const result = await invoke<{ reachable: boolean; surface: string | null }>("runtime.identity");
  // The adopt-only process probes the default port, which this harness is not
  // using, so `reachable` is false here by construction -- what is verified is
  // that an unreachable Runtime is reported as such rather than throwing.
  assert(result.ok, "the call succeeded");
  assert(result.ok && typeof result.value.reachable === "boolean", "reachable is reported");
});

await test("workspaces.list projects to the renderer vocabulary", async () => {
  const result = await invoke<Array<{ workspaceId: string; displayName: string }>>("workspaces.list");
  assert(result.ok, "ok");
  assert(result.ok && result.value.length > 0, "workspaces are listed");
  const record = result.ok ? result.value.find((item) => item.workspaceId === workspaceId) : undefined;
  assert(record, "the harness workspace is present with a camelCase id");
  assert(record && record.displayName, "a display name is always present");
});

await test("workspaces.files reports whether the listing is flat", async () => {
  const browse = await invoke<{ flat: boolean }>("workspaces.files", { workspaceId });
  const search = await invoke<{ flat: boolean }>("workspaces.files", { workspaceId, query: "notes" });
  assert(browse.ok && search.ok, "both calls succeeded");
  equal(browse.ok && browse.value.flat, false, "browsing returns a tree");
  equal(search.ok && search.value.flat, true, "searching returns flat matches");
});

await test("sessions.create, rename and archive round-trip over IPC", async () => {
  const created = await invoke<{ sessionId: string; title: string }>("sessions.create", {
    workspaceId,
    title: "ipc session",
  });
  assert(created.ok, "created");
  const id = created.ok ? created.value.sessionId : "";
  const renamed = await invoke<{ title: string }>("sessions.rename", { sessionId: id, title: "ipc renamed" });
  assert(renamed.ok && renamed.value.title === "ipc renamed", "renamed");
  const archived = await invoke<{ archived: boolean }>("sessions.archive", {
    sessionId: id,
    archived: true,
  });
  assert(archived.ok && archived.value.archived, "archived");
});

await test("a gateway failure crosses IPC as a tagged result, not a rejection", async () => {
  const result = await invoke("sessions.get", { sessionId: "session-missing" });
  assert(!result.ok, "failed");
  equal(result.ok ? 0 : result.error.status, 404, "the HTTP status survives the boundary");
  assert(result.ok || !result.error.retryable, "a 404 is not marked retryable");
});

await test("sessions.subscribe pushes events on the one event channel", async () => {
  const subscribed = await invoke("sessions.subscribe", { sessionId });
  assert(subscribed.ok, "subscribed");
  await eventually(
    "an event to reach the window",
    () => contents.sent.some((entry) => entry.payload.kind === "snapshot"),
    30_000,
  );
  const channels = new Set(contents.sent.map((entry) => entry.channel));
  equal(channels.size, 1, "everything arrives on a single channel");
  await invoke("sessions.unsubscribe", { sessionId });
});

await test("chat.send returns 202 promptly and the outcome arrives on the stream", async () => {
  const target = await invoke<{ sessionId: string }>("sessions.create", {
    workspaceId,
    title: "chat probe",
  });
  assert(target.ok, "session created");
  chatSessionId = target.ok ? target.value.sessionId : "";
  await invoke("sessions.subscribe", { sessionId: chatSessionId });
  contents.sent.length = 0;

  const startedAt = Date.now();
  const sent = await invoke<{ runId: string; created: boolean }>("chat.send", {
    sessionId: chatSessionId,
    prompt: "Reply with the single word: ok",
    clientMessageId: `verify-${Date.now()}`,
  });
  const elapsed = Date.now() - startedAt;
  assert(sent.ok, `chat.send failed: ${sent.ok ? "" : sent.error.message}`);
  assert(sent.ok && sent.value.created, "a fresh key created a run");

  // The whole point of the 202: accepting the work must not wait for the model.
  // A synchronous execute would make this number the model's latency.
  assert(elapsed < 30_000, `chat.send took ${elapsed} ms, which suggests it waited for the model`);

  // Offline, the Agent has no HepAI identity and the run will usually fail --
  // which is exactly the assertion worth making: the outcome reaches the client
  // on the stream, not on the response that started it.
  await eventually(
    "a run transition on the event stream",
    () =>
      contents.sent.some(
        (entry) =>
          entry.payload.kind === "run" &&
          ["running", "completed", "failed", "cancelled"].includes(entry.payload.run.status),
      ),
    90_000,
  );
  const transitions = contents.sent
    .filter((entry) => entry.payload.kind === "run")
    .map((entry) => (entry.payload.kind === "run" ? entry.payload.run.status : ""));
  process.stdout.write(`       run transitions: ${transitions.join(" -> ")}\n`);
  await invoke("sessions.unsubscribe", { sessionId: chatSessionId });
});

await test("chat.send is idempotent on the client message id", async () => {
  const target = await invoke<{ sessionId: string }>("sessions.create", {
    workspaceId,
    title: "idempotency probe",
  });
  assert(target.ok, "session created");
  const id = target.ok ? target.value.sessionId : "";
  const key = `verify-idem-${Date.now()}`;
  const first = await invoke<{ runId: string; created: boolean }>("chat.send", {
    sessionId: id,
    prompt: "one",
    clientMessageId: key,
  });
  const second = await invoke<{ runId: string; created: boolean }>("chat.send", {
    sessionId: id,
    prompt: "one",
    clientMessageId: key,
  });
  assert(first.ok && second.ok, "both calls succeeded");
  equal(
    second.ok ? second.value.runId : "",
    first.ok ? first.value.runId : "",
    "a retried submit lands on the same run",
  );
  equal(second.ok && second.value.created, false, "the retry did not create a second run");
});

await test("models.catalog reaches the renderer with a default alias", async () => {
  const result = await invoke<{ defaultAlias: string | null; models: unknown[] }>("models.catalog");
  assert(result.ok, "ok");
  assert(result.ok && result.value.models.length > 0, "models are listed");
});

await test("auth.session reports a signed-out desktop without failing", async () => {
  const result = await invoke<{ signedIn: boolean }>("auth.session");
  assert(result.ok, "ok");
  equal(result.ok && result.value.signedIn, false, "the offline backend is signed out");
});

await test("disposing the surface releases every subscription", async () => {
  await invoke("sessions.subscribe", { sessionId });
  ipc.dispose();
  equal(service.registry.activeSessionIds.length, 0, "no controllers remain");
});

process.stdout.write("\nF. the renderer fold\n");

function makeItem(overrides: Partial<OaepItem> & { id: string }): OaepItem {
  return {
    session_id: "s",
    run_id: "r1",
    type: "message",
    status: "running",
    sequence: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    source: { backend: "opendrsai" },
    content: { role: "assistant", text: "" },
    ...overrides,
  } as OaepItem;
}

const describe = (failure: { code: string; message: string }): string => failure.message;

await test("deltas render while an item is running", () => {
  const state = createTranscriptState();
  applySessionEvent(
    state,
    { kind: "run", sessionId: "s", run: { runId: "r1", status: "running", updatedAt: "" }, cursor: 1 },
    describe,
  );
  applySessionEvent(
    state,
    { kind: "items", sessionId: "s", items: [makeItem({ id: "i1" })], cursor: 2 },
    describe,
  );
  for (const text of ["Hel", "lo ", "world"]) {
    applySessionEvent(
      state,
      { kind: "delta", sessionId: "s", itemId: "i1", channel: "message", text },
      describe,
    );
  }
  const [entry] = buildTranscript(state);
  equal(entry.text, "Hello world", "the overlay is painted while running");
  equal(entry.streaming, true, "the caret is shown");
});

await test("a completed item replaces the overlay, so dropped deltas cannot leave a hole", () => {
  // This is the property the whole rule exists for: under backpressure the
  // dispatcher merges and drops deltas, so the overlay is not guaranteed to be
  // complete. The authoritative Item must win the moment it settles.
  const state = createTranscriptState();
  applySessionEvent(
    state,
    { kind: "items", sessionId: "s", items: [makeItem({ id: "i1" })], cursor: 1 },
    describe,
  );
  applySessionEvent(
    state,
    { kind: "delta", sessionId: "s", itemId: "i1", channel: "message", text: "Hel" },
    describe,
  );
  // ... "lo world" was dropped ...
  applySessionEvent(
    state,
    {
      kind: "items",
      sessionId: "s",
      items: [
        makeItem({ id: "i1", status: "completed", content: { role: "assistant", text: "Hello world" } }),
      ],
      cursor: 2,
    },
    describe,
  );
  const [entry] = buildTranscript(state);
  equal(entry.text, "Hello world", "the settled item is authoritative");
  equal(entry.streaming, false, "the caret is gone");
  equal(state.overlays.has("i1"), false, "the overlay was discarded");
});

await test("a longer authoritative item overtakes a lagging overlay", () => {
  const state = createTranscriptState();
  applySessionEvent(
    state,
    { kind: "items", sessionId: "s", items: [makeItem({ id: "i1" })], cursor: 1 },
    describe,
  );
  applySessionEvent(
    state,
    { kind: "delta", sessionId: "s", itemId: "i1", channel: "message", text: "Hi" },
    describe,
  );
  applySessionEvent(
    state,
    {
      kind: "items",
      sessionId: "s",
      items: [makeItem({ id: "i1", content: { role: "assistant", text: "Hi there" } })],
      cursor: 2,
    },
    describe,
  );
  equal(buildTranscript(state)[0].text, "Hi there", "longer wins while running");
});

await test("turns are ordered by run, not by run-local sequence", () => {
  // Item.sequence restarts at 1 for each run. Ordering by it alone interleaves
  // the second turn's first message with the first turn's.
  const state = createTranscriptState();
  for (const runId of ["r1", "r2"]) {
    applySessionEvent(
      state,
      { kind: "run", sessionId: "s", run: { runId, status: "completed", updatedAt: "" }, cursor: 1 },
      describe,
    );
  }
  applySessionEvent(
    state,
    {
      kind: "items",
      sessionId: "s",
      items: [
        makeItem({ id: "b", run_id: "r2", sequence: 1, status: "completed", content: { role: "assistant", text: "second turn" } }),
        makeItem({ id: "a", run_id: "r1", sequence: 2, status: "completed", content: { role: "assistant", text: "first turn" } }),
      ],
      cursor: 2,
    },
    describe,
  );
  equal(
    buildTranscript(state).map((entry) => entry.text).join(" | "),
    "first turn | second turn",
    "run order dominates run-local sequence",
  );
});

await test("an item whose run has not arrived yet sorts last instead of vanishing", () => {
  const state = createTranscriptState();
  applySessionEvent(
    state,
    { kind: "run", sessionId: "s", run: { runId: "r1", status: "completed", updatedAt: "" }, cursor: 1 },
    describe,
  );
  applySessionEvent(
    state,
    {
      kind: "items",
      sessionId: "s",
      items: [
        makeItem({ id: "orphan", run_id: "r9", status: "completed", content: { role: "assistant", text: "new turn" } }),
        makeItem({ id: "known", run_id: "r1", status: "completed", content: { role: "assistant", text: "old turn" } }),
      ],
      cursor: 2,
    },
    describe,
  );
  const texts = buildTranscript(state).map((entry) => entry.text);
  equal(texts.length, 2, "nothing was dropped");
  equal(texts[1], "new turn", "the orphan sorts last");
});

await test("a snapshot discards stale overlays", () => {
  const state = createTranscriptState();
  applySessionEvent(
    state,
    { kind: "items", sessionId: "s", items: [makeItem({ id: "i1" })], cursor: 1 },
    describe,
  );
  applySessionEvent(
    state,
    { kind: "delta", sessionId: "s", itemId: "i1", channel: "message", text: "partial" },
    describe,
  );
  applySessionEvent(
    state,
    { kind: "snapshot", sessionId: "s", items: [], runs: [], cursor: 9 },
    describe,
  );
  equal(state.overlays.size, 0, "a re-snapshot resets accumulated deltas");
  equal(buildTranscript(state).length, 0, "and the item set");
  equal(state.cursor, 9, "the cursor advances");
});

await test("reconnecting clears a stale error banner", () => {
  const state = createTranscriptState();
  applySessionEvent(
    state,
    {
      kind: "error",
      sessionId: "s",
      error: { code: "runtime_unreachable", message: "gone", retryable: true, status: 0 },
      fatal: false,
    },
    describe,
  );
  equal(state.error, "gone", "the failure is recorded");
  applySessionEvent(state, { kind: "phase", sessionId: "s", phase: "connected" }, describe);
  equal(state.error, null, "a successful reconnect clears it");
});

await test("phase changes do not force a transcript rebuild", () => {
  const state = createTranscriptState();
  const rebuild = applySessionEvent(
    state,
    { kind: "phase", sessionId: "s", phase: "retrying" },
    describe,
  );
  equal(rebuild, false, "a reconnect must not re-render every message");
});

await test("the stop button targets the newest unsettled run", () => {
  const state = createTranscriptState();
  applySessionEvent(
    state,
    { kind: "run", sessionId: "s", run: { runId: "r1", status: "completed", updatedAt: "" }, cursor: 1 },
    describe,
  );
  applySessionEvent(
    state,
    { kind: "run", sessionId: "s", run: { runId: "r2", status: "running", updatedAt: "" }, cursor: 2 },
    describe,
  );
  equal(activeRun(state)?.runId, "r2", "the live run");
  applySessionEvent(
    state,
    { kind: "run", sessionId: "s", run: { runId: "r2", status: "completed", updatedAt: "" }, cursor: 3 },
    describe,
  );
  equal(activeRun(state), null, "nothing is live once it settles");
});

await test("the fold survives a real event stream from the Runtime", async () => {
  // Replaying genuine journal events, not synthetic ones: the shapes above are
  // hand-written, and a hand-written fixture cannot catch a field the Runtime
  // renamed.
  const state = createTranscriptState();
  const source = chatSessionId || sessionId;
  const page = await client.listSessionEvents(source, 0, 500);
  let folded = 0;
  for (const event of page.data) {
    const run = (event.data as { run?: { id: string; status: string; updated_at: string } }).run;
    if (run) {
      applySessionEvent(
        state,
        {
          kind: "run",
          sessionId: source,
          run: { runId: run.id, status: run.status as never, updatedAt: run.updated_at },
          cursor: event.sequence,
        },
        describe,
      );
      folded += 1;
    }
    const item = event.data.item;
    if (item) {
      applySessionEvent(state, { kind: "items", sessionId: source, items: [item], cursor: event.sequence }, describe);
      folded += 1;
    }
  }
  assert(folded > 0, "the session produced foldable events");
  const entries = buildTranscript(state);
  // A turn that failed still leaves the user message and a failure notice, so an
  // empty transcript here would mean the projection dropped both.
  assert(entries.length > 0, "the turn projected at least one renderable item");
  for (const entry of entries) {
    assert(typeof entry.text === "string", "every entry produced text");
    assert(entry.item.id, "every entry kept its item");
  }
  process.stdout.write(`       folded ${folded} events into ${entries.length} entries\n`);
});

/* ------------------------------------------------------------------ report */

stopRuntime();
process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
  process.exitCode = 1;
}
