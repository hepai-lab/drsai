import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const root = await mkdtemp(join(tmpdir(), "drsai-customization-"));
const gatewayWrites: Array<{ path: string; body: string }> = [];
const server = createServer((request, response) => {
  let body = ""; request.on("data", (chunk) => { body += String(chunk); }); request.on("end", () => {
    gatewayWrites.push({ path: request.url || "", body }); response.setHeader("Content-Type", "application/json");
    if (request.url === "/health") response.end(JSON.stringify({ status: "ok" }));
    else if (request.url === "/v1/models") response.end(JSON.stringify({ object: "list", data: [{ id: "available-model", name: "Available Model" }] }));
    else if (request.url === "/v1/config/cli") response.end(JSON.stringify({ path: "/tmp/config.json", config: { user_id: "anonymous", plan_mode: true } }));
    else if (request.url === "/v1/models/config") response.end(JSON.stringify({ default_alias: "configured", models: [{ alias: "configured", model: "configured-model", token_limit: 1000 }] }));
    else if (request.method === "PUT" && request.url?.startsWith("/v1/config/cli/")) response.end("{}");
    else { response.statusCode = 404; response.end(JSON.stringify({ detail: "missing" })); }
  });
});
try {
  process.env.DRSAI_HOME = root;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address === "object"); process.env.OPENDRSAI_GATEWAY_PORT = String(address.port); process.env.OPENDRSAI_GATEWAY_STARTUP = "external";
  const [{ UserPreferenceStore }, { CustomCommandStore }, { getMyDrSaiConfig, updateMyDrSaiConfig, validateMyDrSaiConfigUpdate }] = await Promise.all([
    import("../main/userPreferences.ts"), import("../main/customCommands.ts"), import("../main/myDrSaiConfig.ts"),
  ]);
  const preferencesPath = join(root, "preferences.json");
  await writeFile(preferencesPath, JSON.stringify({ preferences: [{ category: "output_language", value: "zh", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", source: "explicit_user_request" }, { category: "unknown", value: "bad" }] }));
  const preferences = new UserPreferenceStore(preferencesPath);
  assert.equal((await preferences.list()).length, 1);
  await Promise.all([
    preferences.upsert({ category: "chart_gridlines", value: "hidden", source: "explicit_user_request" }),
    preferences.upsert({ category: "report_format", value: "report", source: "explicit_user_request" }),
    preferences.upsert({ category: "audience", value: "expert", source: "explicit_user_request" }),
  ]);
  assert.equal((await preferences.list()).length, 4);
  assert.equal(JSON.parse(await readFile(preferencesPath, "utf8")).schemaVersion, 2);
  assert.equal((await preferences.delete({ category: "audience" })).removed, true);
  assert.equal((await preferences.delete({ category: "audience" })).removed, false);
  await assert.rejects(() => preferences.delete(null), /not supported/i);
  await assert.rejects(() => preferences.delete({ category: "unknown" }), /not supported/i);
  await assert.rejects(() => preferences.upsert(null), /required/i);
  await assert.rejects(() => preferences.upsert({ category: "output_language", value: "fr", source: "explicit_user_request" }), /not supported/i);
  await assert.rejects(() => preferences.upsert({ category: "output_language", value: "en", source: "inferred" }), /explicit user request/i);

  const commandsPath = join(root, "commands.json");
  const workspacePath = "/workspace/demo";
  const workspaceKey = (await import("node:crypto")).createHash("sha256").update(workspacePath.toLowerCase()).digest("hex");
  const legacyId = "command-00000000-0000-4000-8000-000000000001";
  await writeFile(commandsPath, JSON.stringify({ workspaces: { [workspaceKey]: [{ id: legacyId, workspacePath, name: "legacy", title: "Legacy", prompt: "Do legacy work", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", source: "manual" }] } }));
  const commands = new CustomCommandStore(commandsPath);
  assert.equal((await commands.list({ workspacePath }))[0]?.name, "legacy");
  const [first, second] = await Promise.all([
    commands.upsert({ workspacePath, name: "build_docs", title: "Build docs", prompt: "Build the documentation", source: "manual" }),
    commands.upsert({ workspacePath, name: "check_api", prompt: "Check the API", source: "chat_command" }),
  ]);
  assert.equal(first.name, "build_docs"); assert.equal(second.source, "chat_command"); assert.equal((await commands.list({ workspacePath, limit: 100 })).length, 3);
  assert.equal(JSON.parse(await readFile(commandsPath, "utf8")).schemaVersion, 2);
  assert.equal((await commands.delete({ workspacePath, commandIdOrName: first.id })).removedCount, 1);
  assert.equal((await commands.delete({ workspacePath, commandIdOrName: "missing" })).removedCount, 0);
  await assert.rejects(() => commands.upsert({ workspacePath, name: "commit", prompt: "override" }), /reserved/i);
  await assert.rejects(() => commands.upsert({ workspacePath, name: "ok_name", prompt: "x".repeat(8001) }), /too long/i);
  await assert.rejects(() => commands.list({ workspacePath: "bad\npath" }), /path is invalid/i);

  assert.deepEqual(validateMyDrSaiConfigUpdate({ plan_mode: true, workspace_enabled: false }), { plan_mode: true, workspace_enabled: false });
  assert.throws(() => validateMyDrSaiConfigUpdate({}), /empty/i);
  assert.throws(() => validateMyDrSaiConfigUpdate({ unknown: true }), /non-writable/i);
  assert.throws(() => validateMyDrSaiConfigUpdate({ user_id: "forged-user" }), /non-writable/i);
  assert.throws(() => validateMyDrSaiConfigUpdate({ dangerous_allowed: "yes" }), /dangerous_allowed is invalid/i);
  const config = await getMyDrSaiConfig(); assert.equal(config.ready, true); assert.equal(config.config.plan_mode, true); assert.equal(config.models[0].alias, "configured"); assert.equal("user_id" in config.config, false);
  const updated = await updateMyDrSaiConfig({ plan_mode: false, dangerous_allowed: true }); assert.equal(updated.ready, true);
  assert(gatewayWrites.some((item) => item.path === "/v1/config/cli/plan_mode" && item.body === JSON.stringify({ value: false })));
  assert(gatewayWrites.some((item) => item.path === "/v1/config/cli/dangerous_allowed" && item.body === JSON.stringify({ value: true })));
  console.log("Desktop preferences, custom commands, legacy migration, concurrency and real fake-Gateway OpenDrSai config passed.");
} finally {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
  delete process.env.OPENDRSAI_GATEWAY_PORT;
  delete process.env.OPENDRSAI_GATEWAY_STARTUP;
  await rm(root, { recursive: true, force: true });
}
