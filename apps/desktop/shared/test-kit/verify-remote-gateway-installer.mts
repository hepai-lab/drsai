import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteGatewayInstaller, type RemoteGatewayTransport } from "../main/remoteGatewayInstaller.ts";

const root = await mkdtemp(join(tmpdir(), "drsai-remote-gateway-"));
try {
  const artifact = join(root, "drsai-2.0.0-py3-none-any.whl"); const bytes = Buffer.from("trusted-runtime-artifact"); await writeFile(artifact, bytes);
  const scripts: string[] = []; const uploads: Array<{ local: string; remote: string }> = []; let blockInstall = false;
  const preflight = JSON.stringify({ operatingSystem: "Linux", architecture: "aarch64", pythonVersion: "3.11.9", compatible: true, issues: [], gatewayInstalled: true, gatewayVersion: "2.0.0", currentRelease: "2.0.0", previousRelease: "1.9.0" });
  const transport: RemoteGatewayTransport = {
    async executePython(_alias, script, _timeout, signal) {
      scripts.push(script);
      if (script.includes("platform.python_version")) return preflight;
      if (blockInstall && script.includes("cfg=json.loads")) return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      return "ok";
    },
    async upload(_alias, local, remote) { uploads.push({ local, remote }); },
  };
  const events: Array<{ state: string; phase: string }> = [];
  const installer = new RemoteGatewayInstaller(transport, async (request, payload) => {
    assert.equal(request.artifactSha256, createHash("sha256").update(payload).digest("hex"));
    return createHash("sha256").update(payload).digest("hex");
  });
  installer.setPublisher((event) => events.push({ state: event.state, phase: event.phase }));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const result = await installer.install({ hostAlias: "alpha", action: "install", version: "2.0.0", artifactPath: artifact, artifactSha256: digest, artifactPublisher: "fixture", artifactSignature: "fixture" });
  assert.equal(result.changed, true); assert.equal(result.action, "install"); assert.equal(uploads.length, 1);
  const transaction = scripts.find((script) => script.includes("cfg=json.loads"))!;
  for (const token of ["fcntl.LOCK_EX|fcntl.LOCK_NB", ".staging-", "Artifact SHA-256 mismatch", "Candidate Gateway exited", "os.replace(staging,target)", "swap(previous,current.resolve())", "swap(current,target)"]) assert(transaction.includes(token), `transaction script missing ${token}`);
  assert(events.some((event) => event.phase === "health-check") && events.at(-1)?.state === "completed");
  const uploadCount = uploads.length; const rollback = await installer.install({ hostAlias: "alpha", action: "rollback" }); assert.equal(rollback.action, "rollback"); assert.equal(uploads.length, uploadCount);
  await assert.rejects(() => installer.install({ hostAlias: "../bad", action: "rollback" }), /alias is invalid/i);
  await assert.rejects(() => installer.install({ hostAlias: "alpha", action: "upgrade", version: "bad version", artifactPath: artifact }), /valid Gateway version/i);

  blockInstall = true;
  const pending = installer.install({ hostAlias: "alpha", action: "upgrade", version: "2.1.0", artifactPath: artifact, artifactSha256: digest });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(installer.cancel("alpha"), true);
  await assert.rejects(() => pending, /cancelled/i);
  assert(events.some((event) => event.state === "cancelled")); assert.equal(installer.cancel("alpha"), false);
  blockInstall = false; await installer.install({ hostAlias: "alpha", action: "rollback" });
  installer.shutdown();
  console.log("Remote Gateway preflight, trust, upload, atomic switch, rollback, cancellation and recovery passed.");
} finally { await rm(root, { recursive: true, force: true }); }
