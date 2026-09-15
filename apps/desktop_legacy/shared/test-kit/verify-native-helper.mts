import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NativeHelperSupervisor } from "../../macos/src/main/native/nativeHelperSupervisor.ts";
import { encodeNativeHelperRequest, parseNativeHelperResponse } from "../../macos/src/main/native/nativeProtocol.ts";

assert.match(encodeNativeHelperRequest("fixture-1", "ping"), /"protocolVersion":1/);
assert.throws(() => parseNativeHelperResponse('{"protocolVersion":2,"requestId":"x","status":"ok","result":{}}'), /incompatible/);
assert.throws(() => parseNativeHelperResponse('{"protocolVersion":1,"requestId":"x","status":"ok","result":{},"extra":true}'), /unknown field/);

const helperCandidates = [resolve(process.cwd(), "native/OpenDrSaiNativeHelper/.build/debug/OpenDrSaiNativeHelper"), resolve(process.cwd(), "macos/native/OpenDrSaiNativeHelper/.build/debug/OpenDrSaiNativeHelper")];
const helper = helperCandidates.find(existsSync) || helperCandidates[0];
const fixtureCandidates = [resolve(process.cwd(), "../shared/test-kit/fixtures/native-helper/protocol-v1.json"), resolve(process.cwd(), "shared/test-kit/fixtures/native-helper/protocol-v1.json")];
const fixturePath = fixtureCandidates.find(existsSync) || fixtureCandidates[0];
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { cases: Array<{ name: string; request: unknown; status: string; errorCode?: string }> };
const rawOutput = await new Promise<string>((resolveOutput, reject) => {
  const child = spawn(helper, [], { stdio: ["pipe", "pipe", "pipe"], shell: false }); let output = "";
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; }); child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolveOutput(output) : reject(new Error(`Native Helper golden fixture exited ${code}.`)));
  child.stdin.end(`${fixture.cases.map(({ request }) => JSON.stringify(request)).join("\n")}\n`);
});
const rawResponses = rawOutput.trim().split("\n").map((line) => JSON.parse(line));
assert.equal(rawResponses.length, fixture.cases.length);
fixture.cases.forEach((item, index) => { assert.equal(rawResponses[index].status, item.status, item.name); if (item.errorCode) assert.equal(rawResponses[index].error?.code, item.errorCode, item.name); });
const keychainAccount = randomUUID(); const keychainSecret = `native-secret-${randomUUID()}`;
const keychainRequests = [
  { protocolVersion: 1, requestId: "keychain-put", operation: "keychain.put", parameters: { account: keychainAccount, service: "ai.drsai.desktop", value: keychainSecret } },
  { protocolVersion: 1, requestId: "keychain-get", operation: "keychain.get", parameters: { account: keychainAccount, service: "ai.drsai.desktop" } },
  { protocolVersion: 1, requestId: "keychain-delete", operation: "keychain.delete", parameters: { account: keychainAccount, service: "ai.drsai.desktop" } },
  { protocolVersion: 1, requestId: "keychain-delete-again", operation: "keychain.delete", parameters: { account: keychainAccount, service: "ai.drsai.desktop" } },
  { protocolVersion: 1, requestId: "keychain-stop", operation: "shutdown", parameters: {} },
];
const keychainOutput = await new Promise<string>((resolveOutput, reject) => {
  const child = spawn(helper, [], { stdio: ["pipe", "pipe", "pipe"], shell: false }); let output = ""; child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolveOutput(output) : reject(new Error(`Native Keychain fixture exited ${code}.`))); child.stdin.end(`${keychainRequests.map((request) => JSON.stringify(request)).join("\n")}\n`);
});
const keychainResponses = keychainOutput.trim().split("\n").map((line) => JSON.parse(line));
assert.equal(keychainResponses[0].result.stored, true); assert.equal(keychainResponses[1].result.value, keychainSecret); assert.equal(keychainResponses[2].result.deleted, true); assert.equal(keychainResponses[3].result.deleted, false);
const real = new NativeHelperSupervisor(helper, { timeoutMs: 1_000, maxRestarts: 1 });
const ready = await real.start();
assert.equal(ready.status, "ready", ready.reason);
assert.deepEqual(ready.capabilities, ["lifecycle.handshake", "lifecycle.ping", "keychain.generic-password.v1", "permissions.tcc.v1"]);
assert.equal((await real.request("ping")).result?.pong, true);
await real.stop();
assert.equal(real.state().status, "stopped");

const missing = new NativeHelperSupervisor(`${helper}.missing`);
assert.equal((await missing.start()).status, "unavailable");
assert.match(missing.state().reason || "", /missing/);

const temporary = await mkdtemp(join(tmpdir(), "opendrsai-native-helper-"));
try {
  const hanging = join(temporary, "hanging.sh");
  await writeFile(hanging, "#!/bin/sh\nwhile IFS= read -r line; do sleep 5; done\n", { mode: 0o700 }); await chmod(hanging, 0o700);
  const timeoutClient = new NativeHelperSupervisor(hanging, { timeoutMs: 60, maxRestarts: 0 });
  const timeoutState = await timeoutClient.start();
  assert.equal(timeoutState.status, "unavailable"); assert.match(timeoutState.reason || "", /timed out/); await timeoutClient.stop();

  const malformed = join(temporary, "malformed.sh");
  await writeFile(malformed, "#!/bin/sh\nwhile IFS= read -r line; do printf 'not-json\\n'; done\n", { mode: 0o700 }); await chmod(malformed, 0o700);
  const malformedClient = new NativeHelperSupervisor(malformed, { timeoutMs: 200, maxRestarts: 0 });
  const malformedState = await malformedClient.start();
  assert.equal(malformedState.status, "unavailable"); assert.match(malformedState.reason || "", /malformed JSON|timed out/); await malformedClient.stop();

  const aborting = new NativeHelperSupervisor(hanging, { timeoutMs: 500, maxRestarts: 0 });
  void aborting.start(); await new Promise((resolve) => setTimeout(resolve, 20));
  const controller = new AbortController(); const request = aborting.request("ping", controller.signal); controller.abort(); await assert.rejects(request, /cancelled/); await aborting.stop();

} finally { await rm(temporary, { recursive: true, force: true }); }

const recoveringClient = new NativeHelperSupervisor(helper, { timeoutMs: 1_000, maxRestarts: 1 });
assert.equal((await recoveringClient.start()).status, "ready");
const crashedPid = recoveringClient.processId(); assert.ok(crashedPid); process.kill(crashedPid, "SIGKILL");
await new Promise((resolve) => setTimeout(resolve, 350));
assert.equal(recoveringClient.state().status, "ready", `Native Helper must recover after one bounded real SIGKILL: ${recoveringClient.state().reason}`);
assert.notEqual(recoveringClient.processId(), crashedPid, "Native Helper restart must create a new process.");
assert.equal((await recoveringClient.request("ping")).result?.pong, true);
await recoveringClient.stop();

console.log("Native Helper real handshake, protocol, timeout, cancellation, malformed output and unavailable degradation passed.");
