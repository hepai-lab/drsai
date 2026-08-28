import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const specPath = resolve(root, "resources/remote-gateway-openapi.json");
const outputPath = resolve(root, "src/main/remoteGatewayClient.generated.ts");
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const allowed = (path) =>
  path.startsWith("/v1/workspaces/") ||
  path.startsWith("/v1/sessions") ||
  path.startsWith("/v1/runs/") ||
  path.startsWith("/v1/approvals/") ||
  path === "/v1/workspaces" ||
  path === "/v1/runtime" ||
  path === "/v1/capabilities" ||
  path === "/v1/remote/handshake" ||
  path === "/v1/pty";
const operations = [];
for (const [path, methods] of Object.entries(spec.paths || {})) {
  if (!allowed(path)) continue;
  for (const [method, operation] of Object.entries(methods)) {
    if (!["get", "post", "put", "patch", "delete"].includes(method) || !operation.operationId) continue;
    operations.push({ id: operation.operationId, method: method.toUpperCase(), path });
  }
}
operations.sort((a, b) => a.id.localeCompare(b.id));
if (!operations.length) throw new Error("OpenAPI document has no Remote Gateway operations.");

const table = operations.map(({ id, method, path }) => `  ${JSON.stringify(id)}: { method: ${JSON.stringify(method)}, path: ${JSON.stringify(path)} },`).join("\n");
const source = `// Generated from resources/remote-gateway-openapi.json. Do not edit manually.\n` +
`import { randomUUID } from "crypto";\n` +
`import { parseRemoteProtocolError, type RemoteProtocolErrorBody } from "../../../shared/api/remoteSshProtocol";\n\n` +
`export const REMOTE_GATEWAY_OPERATIONS = {\n${table}\n} as const;\n` +
`export type RemoteGatewayOperationId = keyof typeof REMOTE_GATEWAY_OPERATIONS;\n\n` +
`export class RemoteGatewayClient {\n` +
`  constructor(readonly baseUrl: string, readonly token: string, readonly workspaceId: string) {}\n\n` +
`  async workspaceRequest<T>(endpoint: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<T> {\n` +
`    const response = await fetch(\`\${this.baseUrl}/v1/workspaces/\${encodeURIComponent(this.workspaceId)}\${endpoint}\`, {\n` +
`      ...init,\n` +
`      headers: { "X-OpenDrSai-Gateway-Token": this.token, "X-Correlation-ID": randomUUID(), ...init.headers },\n` +
`      signal: init.signal ?? AbortSignal.timeout(timeoutMs),\n` +
`    });\n` +
`    if (!response.ok) {\n` +
`      let body: RemoteProtocolErrorBody | null = null;\n` +
`      try { body = await response.json() as RemoteProtocolErrorBody; } catch { /* non-JSON failure */ }\n` +
`      throw parseRemoteProtocolError(response.status, body, response.headers.get("x-correlation-id"));\n` +
`    }\n` +
`    return response.json() as Promise<T>;\n` +
`  }\n\n` +
`  get<T>(endpoint: string, timeoutMs = 10_000): Promise<T> { return this.workspaceRequest(endpoint, {}, timeoutMs); }\n` +
`  post<T>(endpoint: string, body: unknown, timeoutMs = 30_000): Promise<T> {\n` +
`    return this.workspaceRequest(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);\n` +
`  }\n` +
`}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(outputPath, "utf8") !== source) throw new Error("Remote Gateway generated client is stale; run npm run generate:remote-gateway-client.");
  console.log(`Remote Gateway generated client matches ${operations.length} OpenAPI operations.`);
} else {
  writeFileSync(outputPath, source);
  console.log(`Remote Gateway client generated from ${operations.length} OpenAPI operations.`);
}
