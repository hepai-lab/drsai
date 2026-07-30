import assert from "node:assert/strict";
import { createNativeMacosCredentialService } from "../../macos/src/main/native/nativeCredentialService.ts";

let fallbackReads = 0;
const fallback = { available: () => true, protect: () => "keychain:00000000-0000-0000-0000-000000000001", unprotect: () => { fallbackReads += 1; return "legacy-secret"; }, remove: () => true };
const missingNative = createNativeMacosCredentialService({ helperPath: () => "/missing/helper", fallback, platform: "darwin" });
assert.equal(missingNative.unprotect("keychain:00000000-0000-0000-0000-000000000001"), "legacy-secret"); assert.equal(fallbackReads, 1);
const calls: Array<{ operation: string; parameters: Record<string, string> }> = [];
const native = createNativeMacosCredentialService({ helperPath: () => "/injected/helper", fallback, platform: "darwin", invokeNative: (operation, parameters) => { calls.push({ operation, parameters }); return operation === "keychain.put" ? { kind: "ok", result: { stored: true } } : operation === "keychain.get" ? { kind: "ok", result: { value: "native-secret" } } : { kind: "ok", result: { deleted: false } }; } });
const reference = native.protect("native-secret"); assert.match(reference || "", /^keychain:[0-9a-f-]{36}$/); assert.equal(native.unprotect(reference), "native-secret"); assert.equal(native.remove?.(reference), true); assert.deepEqual(calls.map(({ operation }) => operation), ["keychain.put", "keychain.get", "keychain.delete"]); assert.ok(calls.every(({ parameters }) => parameters.service === "ai.drsai.desktop"));
fallbackReads = 0;
const locked = createNativeMacosCredentialService({ helperPath: () => "/injected/helper", fallback, platform: "darwin", invokeNative: () => ({ kind: "error", error: { code: "interaction_not_allowed", message: "locked" } }) });
assert.equal(locked.unprotect("keychain:00000000-0000-0000-0000-000000000001"), undefined); assert.equal(fallbackReads, 0); assert.equal(locked.lastFailure()?.code, "interaction_not_allowed");
console.log("Native Keychain hybrid adapter, legacy-reference fallback, idempotent delete and locked-session fail-closed behavior passed.");
