import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "opendrsai-macos-lifecycle-"));
try {
  const require = createRequire(import.meta.url);
  const { build } = require("esbuild") as typeof import("esbuild");
  const bundle = join(temp, "lifecycle.mjs");
  await build({
    entryPoints: [new URL("../../macos/src/main/lifecycleRouting.ts", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  const { DesktopOpenRequestQueue, parseMacosOpenFile, parseMacosOpenUrl, parseMacosSecondInstanceArgv } = await import(pathToFileURL(bundle).href);

  assert.deepEqual(parseMacosOpenUrl("opendrsai://auth-complete?token=must-not-propagate"), {
    kind: "auth-complete", source: "protocol", url: "opendrsai://auth-complete",
  });
  assert.deepEqual(parseMacosOpenUrl("opendrsai://thread/thread-123"), {
    kind: "thread", source: "protocol", url: "opendrsai://thread/thread-123", threadId: "thread-123",
  });
  for (const invalid of ["https://thread/1", "opendrsai://unknown/1", "opendrsai://thread/../escape", "not a url"]) {
    assert.equal(parseMacosOpenUrl(invalid), null);
  }
  assert.equal(parseMacosOpenFile("relative.txt"), null);
  assert.equal(parseMacosOpenFile("/Users/test/project/file.txt")?.kind, "file");
  assert.equal(parseMacosSecondInstanceArgv(["electron", "opendrsai://thread/abc", "/Users/test/file.txt"]).length, 2);
  const filteredArgv = parseMacosSecondInstanceArgv(["/Applications/OpenDrSai.app", "/Users/test/file.txt"], ["/Applications/OpenDrSai.app"]);
  assert.equal(filteredArgv.length, 1);
  assert.equal(filteredArgv[0]?.kind, "file");

  const queue = new DesktopOpenRequestQueue();
  const thread = parseMacosOpenUrl("opendrsai://thread/queued");
  assert.ok(thread);
  queue.enqueue(thread);
  queue.enqueue(thread);
  assert.equal(queue.pendingCount, 1, "startup requests must be deduplicated");
  const delivered: unknown[] = [];
  queue.attach((request: unknown) => delivered.push(request));
  assert.equal(queue.pendingCount, 0);
  assert.equal(delivered.length, 1);
  queue.enqueue({ kind: "settings", source: "menu" });
  assert.equal(delivered.length, 2, "ready renderer must receive requests immediately");
  queue.detach();
  queue.enqueue(thread);
  assert.equal(queue.pendingCount, 1, "closed renderer must return to queueing mode");
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("macOS lifecycle routing passed (protocol, Finder file, second instance, sanitization, queue and deduplication).")
