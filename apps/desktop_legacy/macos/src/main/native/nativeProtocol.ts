export const NATIVE_PROTOCOL_VERSION = 1;
export const NATIVE_PROTOCOL_MAX_LINE_BYTES = 64 * 1024;
export const NATIVE_HELPER_OPERATIONS = ["handshake", "capabilities", "ping", "shutdown", "keychain.put", "keychain.get", "keychain.delete", "permission.status", "permission.request", "permission.open-settings"] as const;
export type NativeHelperOperation = (typeof NATIVE_HELPER_OPERATIONS)[number];

export interface NativeHelperRequest { protocolVersion: 1; requestId: string; operation: NativeHelperOperation; parameters: Record<string, string>; }
export interface NativeHelperResponse { protocolVersion: 1; requestId: string; status: "ok" | "error"; result?: Record<string, unknown>; error?: { code: string; message: string }; }

export function encodeNativeHelperRequest(requestId: string, operation: NativeHelperOperation, parameters: Record<string, string> = {}): string {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)) throw new Error("Native Helper request id is invalid.");
  if (Object.entries(parameters).some(([key, value]) => !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(key) || typeof value !== "string")) throw new Error("Native Helper parameters are invalid.");
  return `${JSON.stringify({ protocolVersion: NATIVE_PROTOCOL_VERSION, requestId, operation, parameters } satisfies NativeHelperRequest)}\n`;
}

export function parseNativeHelperResponse(line: string): NativeHelperResponse {
  if (Buffer.byteLength(line, "utf8") > NATIVE_PROTOCOL_MAX_LINE_BYTES) throw new Error("Native Helper response exceeds the maximum encoded size.");
  let value: unknown; try { value = JSON.parse(line); } catch { throw new Error("Native Helper returned malformed JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Native Helper response must be an object.");
  const response = value as Record<string, unknown>;
  const allowed = new Set(["protocolVersion", "requestId", "status", "result", "error"]);
  if (Object.keys(response).some((key) => !allowed.has(key))) throw new Error("Native Helper response contains an unknown field.");
  if (response.protocolVersion !== NATIVE_PROTOCOL_VERSION) throw new Error("Native Helper protocol version is incompatible.");
  if (typeof response.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(response.requestId)) throw new Error("Native Helper response id is invalid.");
  if (response.status !== "ok" && response.status !== "error") throw new Error("Native Helper response status is invalid.");
  if (response.status === "ok" && (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) || response.status === "error" && (!response.error || typeof response.error !== "object" || Array.isArray(response.error))) throw new Error("Native Helper response payload is invalid.");
  return response as unknown as NativeHelperResponse;
}
