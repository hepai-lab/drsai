import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  listExternalAgentRuntimeAgents, getExternalAgentRuntimeDescriptor,
  parseExternalAgentRuntimeManifest, probeExternalAgentRuntimeRegistration,
} from "../main/externalAgentRuntimes.ts";
import { ExternalOaepRuntimeClient } from "../main/externalOaepRuntimeClient.ts";

const registryRoot = process.argv[2];
assert.ok(registryRoot, "registry root is required");

const agents = await listExternalAgentRuntimeAgents({ registryRoot });
console.error(`agents:${JSON.stringify(agents.map((item) => ({ id: item.id, mode: item.mode, available: item.available })))}`);
const agent = agents.find((item) => item.mode === "oaep-runtime" && item.name === "DeepSeek Harness");
if (!agent?.available) {
  const diagnostics: unknown[] = [];
  for (const name of readdirSync(registryRoot).filter((item) => item.endsWith(".json"))) {
    try {
      const parsed = parseExternalAgentRuntimeManifest(
        JSON.parse(readFileSync(join(registryRoot, name), "utf8")), { registryRoot },
      );
      const token = readFileSync(parsed.endpoint.bearer_token_file, "utf8").trim();
      const response = await fetch(`${parsed.endpoint.base_url}/v1/runtime/initialize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ protocols: parsed.protocols }),
      });
      diagnostics.push({
        name, parsed, probe: await probeExternalAgentRuntimeRegistration(parsed),
        direct: { status: response.status, body: await response.text() },
      });
    } catch (error) {
      diagnostics.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new Error(`DeepSeek Harness did not appear as an available local Agent: ${JSON.stringify(diagnostics)}`);
}
const descriptor = getExternalAgentRuntimeDescriptor(agent.id);
assert.ok(descriptor, "DeepSeek Harness runtime descriptor was not retained");

const client = new ExternalOaepRuntimeClient(descriptor);
const sessionId = await client.createSession(`desktop-real-${Date.now()}`);
console.error(`session:${sessionId}`);
const run = await client.startRun(
  sessionId,
  `desktop-run-${Date.now()}`,
  [{ type: "text", text: "desktop real product matrix" }],
);
console.error(`run:${JSON.stringify(run)}`);
let sequence = 0;
let terminal = "";
const deadline = Date.now() + 30_000;
while (!terminal && Date.now() < deadline) {
  const events = await client.waitEvents(sessionId, sequence);
  console.error(`events:${events.length}:after:${sequence}`);
  for (const event of events) {
    sequence = Math.max(sequence, event.sequence);
    if (event.run_id === run.run_id && ["event.run.completed", "event.run.failed", "event.run.cancelled"].includes(event.type)) {
      terminal = event.type;
    }
  }
}
assert.equal(terminal, "event.run.completed", `DeepSeek Harness Run did not complete: ${terminal || "timeout"}`);
const snapshot = await client.getSnapshot(sessionId);
assert.ok(snapshot.runs.some((item) => item.id === run.run_id && item.status === "completed"));

console.log(JSON.stringify({ accepted: true, agentId: agent.id, sessionId, runId: run.run_id, terminal, sequence }));
