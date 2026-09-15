import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const renderer = join(repo, "apps", "desktop", "shared", "renderer");
const mapper = await readFile(join(repo, "cores", "python", "packages", "drsai", "src", "drsai", "backend", "codex_adapter", "event_mapper.py"), "utf8");
const agents = await readFile(join(repo, "apps", "desktop", "shared", "main", "agents.ts"), "utf8");
const subscription = await readFile(join(repo, "apps", "desktop", "shared", "main", "threadRuntimeSubscription.ts"), "utf8");
assert.equal(mapper.includes('item/agentMessage/delta'), false, "Mapper must not bypass the Native Decoder");
assert.equal(mapper.includes('event.session.updated'), false, "unknown diagnostics must not become Session updates");
assert.equal(agents.includes('gpt-5.4'), false, "Desktop must not hardcode a Codex model");
assert.equal(subscription.includes('setTimeout(resolve, 100)'), false, "subscription must not own a fixed 100ms retry loop");
assert(subscription.includes("new LegacyConversationAdapter(thread)"), "legacy projection must remain isolated");
assert(subscription.includes("OPENDRSAI_DESKTOP_PROTOCOL_ROLLBACK"), "an explicit compatibility rollback switch is required");
for (const file of await files(renderer)) {
  if (![".ts", ".tsx"].includes(extname(file))) continue;
  const source = await readFile(file, "utf8");
  assert.equal(/item\/agentMessage|thread\/start|turn\/start|codex_adapter/.test(source), false,
    `Renderer must remain backend-neutral: ${file}`);
}
const manifest = JSON.parse(await readFile(join(repo, "cores", "protocol", "codex-app-server-stable-contract.json"), "utf8"));
assert.equal(manifest.contractVersion, 2);
console.log("P8 removal, legacy compatibility and architecture governance verified.");

async function files(root) {
  const rows = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) rows.push(...await files(path));
    else rows.push(path);
  }
  return rows;
}
