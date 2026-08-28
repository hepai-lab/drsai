import assert from "node:assert/strict";
import { bootstrapRuntimeSessionCatalog } from "../main/runtimeSessionCatalogBootstrap.ts";
import type { RuntimeSession } from "../main/runtimeClient.ts";

const sessions = Array.from({ length: 405 }, (_, index): RuntimeSession => ({
  session_id: `session-${index}`,
  workspace_id: "workspace-one",
  title: index === 49 ? "WeChat session 1" : `Session ${index}`,
  archived: false,
  lifecycle: "active",
  created_at: "2026-08-15T00:00:00Z",
  updated_at: "2026-08-15T00:00:00Z",
  ...(index === 49 ? {
    origin: { kind: "channel" as const, provider: "wechat", binding_id: "binding-opaque" },
  } : {}),
}));
const calls: Array<{ offset: number; limit: number }> = [];
const applied: RuntimeSession[] = [];
const client = {
  async listSessions(_workspaceId: string, offset = 0, limit = 100) {
    calls.push({ offset, limit });
    return { object: "list" as const, data: sessions.slice(offset, offset + limit), total: sessions.length, offset };
  },
};

const count = await bootstrapRuntimeSessionCatalog(
  client,
  "workspace-one",
  async (session) => { applied.push(session); },
);

assert.equal(count, 50);
assert.deepEqual(calls, [{ offset: 0, limit: 50 }]);
assert.equal(applied.at(-1)?.title, "WeChat session 1");
assert.equal(applied.at(-1)?.origin?.provider, "wechat");
console.log("Bounded Runtime Session catalog bootstrap passed.");
