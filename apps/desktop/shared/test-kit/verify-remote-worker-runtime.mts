import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "../..");
const read = (relativePath: string): string => readFileSync(resolve(desktopRoot, relativePath), "utf8");

const runtimeClient = read("shared/main/runtimeClient.ts");
const agents = read("shared/main/agents.ts");
const chat = read("shared/main/chat.ts");
const app = read("shared/renderer/src/App.tsx");

assert.match(runtimeClient, /\/v1\/remote-workers\?refresh=/, "catalog must use the local Runtime route");
assert.match(runtimeClient, /\/v1\/remote-workers\/select/, "selection must use the local Runtime route");
assert.match(runtimeClient, /JSON\.stringify\(\{ agent_definition: agentDefinition \}\)/, "Run creation must send agent_definition");

assert.match(agents, /client\.listRemoteWorkers\(refresh\)/, "Agent Square catalog must come from Runtime");
assert.match(agents, /client\.selectRemoteWorker\(descriptor\.platformId/, "Use-agent action must bind the worker");
assert.doesNotMatch(agents, /fetchPlatformAgents|fetchHostedAgentCatalog|HEPAI_API_KEY|OPENAI_API_KEY|readSavedApiKey/, "Agent catalog must not access DDF or credentials directly");

assert.match(runtimeClient, /createRemoteWorkerSession\(worker:[\s\S]*remote_worker_id: worker/, "remote Session creation must send stable worker ownership");
assert.match(runtimeClient, /listRemoteWorkerSessions\(worker:[\s\S]*remote_worker_id=/, "remote Session listing must be worker scoped");
assert.match(chat, /client\.createRemoteWorkerSession\(remoteWorker![\s\S]*session\.agent_definition/, "chat must create a worker-owned Session and use its scoped definition");
assert.match(chat, /client\.getSession\(runtimeSessionId![\s\S]*session\.remote_worker_id !== remoteWorker[\s\S]*agentDefinition = session\.agent_definition/, "continuation must verify worker ownership and use the Session definition");
assert.doesNotMatch(chat, /client\.selectRemoteWorker\(/, "chat Run startup must not select global remote-worker state");
assert.doesNotMatch(app, /desktopApi\.recordAgentUsage\(agent\.id\)/, "conversation creation must not depend on compatibility selection");
assert.doesNotMatch(chat, /"remote-worker@1"/, "chat must not assume a global remote-worker Agent Definition literal");
assert.doesNotMatch(chat, /chat\/completions|readRemoteSse|remotePresentationProjector|resolvePlatformBearerToken/, "chat must not retain a remote direct/SSE path");

process.stdout.write("remote worker Runtime contract: ok\n");
