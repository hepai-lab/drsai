import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMacosCredentialService } from "../../macos/src/main/platformCredentials.ts";

const calls: string[][] = [];
const service = createMacosCredentialService((_command, args) => {
  calls.push(args);
  if (args[0] === "find-generic-password") return { status: 0, stdout: "secret-value\n" };
  return { status: 0, stdout: "" };
}, "darwin");
const reference = service.protect("secret-value");
assert.match(reference ?? "", /^keychain:[0-9a-f-]{36}$/);
assert.equal(service.unprotect(reference), "secret-value");
assert.equal(service.remove?.(reference), true);
assert.deepEqual(calls.map((args) => args[0]), ["add-generic-password", "find-generic-password", "delete-generic-password"]);
assert.equal(service.unprotect("keychain:../../invalid"), undefined);
assert.equal(service.remove?.("plaintext"), false);
assert.equal(createMacosCredentialService(() => ({ status: 1 }), "darwin").protect("secret"), undefined);
assert.equal(createMacosCredentialService(() => ({ status: 0 }), "win32").available(), false);

const auth = await readFile(new URL("../main/auth.ts", import.meta.url), "utf8");
assert.match(auth, /credentialService\?\.available\(\) && !reference[\s\S]{0,100}throw new Error/, "Locked Keychain must not fall back to plaintext.");
assert.match(auth, /for \(const reference of created\) credentialService\?\.remove/, "Partial Keychain writes must roll back.");
assert.match(auth, /previousReferences[\s\S]{0,700}credentialService\?\.remove/, "Credential rotation must delete superseded items.");
assert.match(auth, /readCredentialReferences\(AUTH_SESSION_FILE\)[\s\S]{0,350}credentialService\?\.remove/, "Logout must delete Keychain items.");

console.log("macOS Keychain lifecycle verification passed.");
