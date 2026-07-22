import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "opendrsai-macos-recovery-"));
try {
  const require = createRequire(import.meta.url);
  const { build } = require("esbuild") as typeof import("esbuild");
  const bundle = join(temp, "recovery.mjs");
  await build({
    entryPoints: [new URL("../../macos/src/main/lifecycleRecovery.ts", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))],
    outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22",
  });
  const { MacosLifecycleRecoveryCoordinator } = await import(pathToFileURL(bundle).href);
  const recovery = new MacosLifecycleRecoveryCoordinator();
  assert.deepEqual([0, 1, 2, 3].map((index) => recovery.recordRendererFailure(10_000 + index)), ["reload", "reload", "recreate", "relaunch"]);
  assert.equal(recovery.recordRendererFailure(80_000), "reload", "renderer crash window must expire");
  assert.equal(recovery.setNetworkOnline(true), false);
  assert.equal(recovery.setNetworkOnline(false), false);
  assert.equal(recovery.setNetworkOnline(true), true);

  recovery.suspend(true);
  let starts = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const first = recovery.recover("resume", async () => { starts += 1; await wait; }, () => new Date("2026-07-22T00:00:00.000Z"));
  const duplicate = recovery.recover("network-online", async () => { starts += 1; });
  assert.equal(first, duplicate, "overlapping recovery must coalesce");
  release();
  assert.deepEqual(await first, { reason: "resume", recoveredGateway: true, at: "2026-07-22T00:00:00.000Z" });
  assert.equal(starts, 1);
  recovery.suspend(true);
  recovery.beginShutdown();
  assert.equal((await recovery.recover("resume", async () => { starts += 1; })).recoveredGateway, false);
  assert.equal(starts, 1, "shutdown must suppress service recovery");
} finally {
  await rm(temp, { recursive: true, force: true });
}

console.log("macOS recovery coordinator passed (crash budget, expiry, network transition, coalescing and shutdown suppression).")
