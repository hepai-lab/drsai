import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Script } from "node:vm";
import ts from "typescript";

const root = process.cwd();

function loadTypeScriptModule(path) {
  const source = readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: true },
  }).outputText;
  const module = { exports: {} };
  new Script(compiled, { filename: path }).runInNewContext({
    exports: module.exports,
    module,
    require: () => { throw new Error(`${path} must not require runtime dependencies in this verification`); },
  });
  return module.exports;
}

const protocol = loadTypeScriptModule(join(root, "../shared/api/structuredConversation.ts"));
const parser = loadTypeScriptModule(join(root, "../shared/main/sseParser.ts"));
const fixture = JSON.parse(readFileSync(join(root, "scripts/fixtures/structured-conversation.json"), "utf8"));
const routeFixture = JSON.parse(readFileSync(join(root, "scripts/fixtures/structured-sidebar-routes.json"), "utf8"));
const failureFixture = JSON.parse(readFileSync(join(root, "scripts/fixtures/structured-failure-events.json"), "utf8"));

let state = protocol.createStructuredTurnState(fixture.turnId);
for (const event of fixture.events) {
  const frame = `event: drsai.event\ndata: ${JSON.stringify(event)}\n\n`;
  const parsed = parser.parseStructuredConversationSseFrame(frame);
  assert.ok(parsed, `SSE parser rejected sequence ${event.sequence}`);
  state = protocol.applyStructuredConversationEvent(state, parsed);
}
assert.equal(state.status, "completed");
assert.equal(state.parts.length, 8);
assert.equal(state.parts.filter((part) => part.kind === "reasoning").length, 1);
assert.equal(state.parts.find((part) => part.kind === "citation").markdownPartId, "answer");
assert.equal(state.parts.find((part) => part.kind === "markdown").citationIds[0], "source-1");

assert.deepEqual([...new Set(routeFixture.routes.map((route) => route.target))].sort(), ["browser", "debug", "files", "terminal"]);
assert.ok(routeFixture.routes.every((route) => route.automatic === false), "Right panels must open only after an explicit user action.");
assert.deepEqual(failureFixture.cases.map((item) => item.name), ["model-unavailable", "tool-failure", "interrupted-recovery", "network-recovery"]);
assert.equal(JSON.stringify(failureFixture).includes("invalid_token"), false, "Failure fixtures must not contain credentials.");
const networkRecovery = failureFixture.cases.find((item) => item.name === "network-recovery");
assert.deepEqual(networkRecovery.events.map((event) => event.connection?.status), ["retrying", "restored"]);
assert.ok(networkRecovery.events.every((event) => event.type === "connection"));

const appSource = readFileSync(join(root, "../shared/renderer/src/App.tsx"), "utf8");
const rendererSource = readFileSync(join(root, "../shared/renderer/src/components/StructuredMessageParts.tsx"), "utf8");
const adapterSource = readFileSync(join(root, "../shared/renderer/src/adapters/useDesktopChatAdapter.ts"), "utf8");
assert.ok(appSource.includes('setActiveRightTab("files")'));
assert.ok(appSource.includes('setActiveRightTab("browser")'));
assert.ok(appSource.includes('<DebugPanel'));
assert.ok(appSource.includes('<TerminalPanel'));
assert.equal(rendererSource.includes('part.kind === "tool"'), false, "Tool activity must not auto-open Terminal or render as a chat part.");
assert.ok(adapterSource.includes("appendStructuredActivityLog(structuredEvent.activity)"));
assert.ok(adapterSource.includes('event.type === "connection" && event.connection'));

console.log("Structured integration verification passed (Gateway SSE -> Desktop parser -> reducer, 4 right-panel routes)." );
