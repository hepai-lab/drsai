import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { DesktopCredentialService } from "../../../../shared/api";
import { encodeNativeHelperRequest, parseNativeHelperResponse, type NativeHelperOperation } from "./nativeProtocol";

const SERVICE = "ai.drsai.desktop";
type NativeFailure = { code: string; message: string };
export type NativeCredentialInvocation = { kind: "ok"; result: Record<string, unknown> } | { kind: "unavailable" } | { kind: "error"; error: NativeFailure };
export interface NativeMacosCredentialService extends DesktopCredentialService { lastFailure(): NativeFailure | null; }

export function createNativeMacosCredentialService(options: { helperPath(): string; fallback: DesktopCredentialService; platform?: string; invokeNative?(operation: NativeHelperOperation, parameters: Record<string, string>): NativeCredentialInvocation }): NativeMacosCredentialService {
  let failure: NativeFailure | null = null;
  const invoke = (operation: NativeHelperOperation, parameters: Record<string, string>): NativeCredentialInvocation => {
    if (options.invokeNative) return options.invokeNative(operation, parameters);
    const helper = options.helperPath(); if (!existsSync(helper)) return { kind: "unavailable" };
    const requestId = randomUUID();
    const process = spawnSync(helper, [], { input: `${encodeNativeHelperRequest(requestId, operation, parameters)}${encodeNativeHelperRequest(randomUUID(), "shutdown")}`, encoding: "utf8", timeout: 5_000, maxBuffer: 256 * 1024, shell: false, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } });
    if (process.error || process.status !== 0 || !process.stdout) return { kind: "unavailable" };
    try {
      const response = parseNativeHelperResponse(process.stdout.split("\n").find(Boolean) || "");
      if (response.requestId !== requestId) return { kind: "unavailable" };
      if (response.status === "error") return { kind: "error", error: response.error || { code: "keychain_unavailable", message: "Native Keychain failed." } };
      return { kind: "ok", result: response.result || {} };
    } catch { return { kind: "unavailable" }; }
  };
  const service: NativeMacosCredentialService = {
    available: () => (options.platform ?? process.platform) === "darwin" && (existsSync(options.helperPath()) || options.fallback.available()),
    protect(secret) {
      failure = null; if (typeof secret !== "string" || !secret || Buffer.byteLength(secret, "utf8") > 64 * 1024) return undefined;
      const account = randomUUID(); const result = invoke("keychain.put", { account, service: SERVICE, value: secret });
      if (result.kind === "ok") return `keychain:${account}`;
      if (result.kind === "unavailable") return options.fallback.protect(secret);
      failure = result.error; return undefined;
    },
    unprotect(reference) {
      failure = null; const account = parseReference(reference); if (!account) return undefined;
      const result = invoke("keychain.get", { account, service: SERVICE });
      if (result.kind === "ok") return typeof result.result.value === "string" ? result.result.value : undefined;
      if (result.kind === "unavailable") return options.fallback.unprotect(reference);
      failure = result.error; return undefined;
    },
    remove(reference) {
      failure = null; const account = parseReference(reference); if (!account) return false;
      const result = invoke("keychain.delete", { account, service: SERVICE });
      if (result.kind === "ok") return result.result.deleted === true || result.result.deleted === false;
      if (result.kind === "unavailable") return options.fallback.remove?.(reference) ?? false;
      failure = result.error; return false;
    },
    lastFailure: () => failure ? { ...failure } : null,
  };
  return service;
}
function parseReference(reference: string | undefined): string | null { if (!reference?.startsWith("keychain:")) return null; const account = reference.slice(9); return /^[0-9a-f-]{36}$/.test(account) ? account : null; }
