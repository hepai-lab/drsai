import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const helper = resolve(root, "release/mac-arm64/OpenDrSai.app/Contents/Resources/native/OpenDrSaiNativeHelper");
const library = resolve(root, "release/mac-arm64/OpenDrSai.app/Contents/Resources/native/libOpenDrSaiNativeProtocol.dylib");
for (const path of [helper, library]) { const stat = statSync(path); assert.ok(stat.isFile() && (stat.mode & 0o111), `${path} must be an executable packaged resource`); }
for (const path of [helper, library]) assert.match(execFileSync("/usr/bin/file", [path], { encoding: "utf8" }), /Mach-O 64-bit.*arm64/, `${path} must be arm64 Mach-O`);
assert.match(execFileSync("/usr/bin/otool", ["-L", helper], { encoding: "utf8" }), /@rpath\/libOpenDrSaiNativeProtocol\.dylib/, "Packaged Helper must resolve its protocol library relative to the executable");
assert.match(execFileSync("/usr/bin/otool", ["-D", library], { encoding: "utf8" }), /@rpath\/libOpenDrSaiNativeProtocol\.dylib/, "Packaged protocol library must have a relocatable install name");
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const response = await new Promise((resolveResponse, reject) => {
  const child = spawn(helper, [], { stdio: ["pipe", "pipe", "pipe"], shell: false }); let output = "";
  child.stdout.setEncoding("utf8"); child.stdout.on("data", (chunk) => { output += chunk; }); child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolveResponse(output) : reject(new Error(`Packaged Native Helper exited ${code}: ${output}`)));
  child.stdin.end('{"protocolVersion":1,"requestId":"packaged-1","operation":"handshake"}\n{"protocolVersion":1,"requestId":"packaged-2","operation":"shutdown"}\n');
});
const lines = String(response).trim().split("\n").map((line) => JSON.parse(line));
assert.equal(lines[0].status, "ok"); assert.deepEqual(lines[0].result.capabilities, ["lifecycle.handshake", "lifecycle.ping", "keychain.generic-password.v1", "permissions.tcc.v1"]); assert.equal(lines[1].status, "ok");
console.log(`Packaged Native Helper arm64 resource handshake passed (helperSha256=${hash(helper)}, librarySha256=${hash(library)}).`);
