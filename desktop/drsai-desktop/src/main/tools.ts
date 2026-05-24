/**
 * Tool configuration via DrSai API Gateway.
 *
 * Backed by /v1/config/tools — reads/writes TOOLS_CONFIG.json in the user's
 * workdir. Each entry is an MCP server or a free-form local-tool description.
 */

import http from "http";
import { getUserName } from "./config";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

export interface ToolEntry {
  type: string;
  config: Record<string, unknown>;
  name?: string | null;
  enabled?: boolean;
}

export interface ToolEntryWithIndex extends ToolEntry {
  index: number;
}

function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${DRSAI_API_URL}${path}`;
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        timeout: 10000,
        headers: bodyStr
          ? {
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(bodyStr)),
            }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (d: Buffer) => (data += d.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            let detail = data;
            try {
              detail = JSON.parse(data).detail || data;
            } catch {
              /* keep raw */
            }
            reject(new Error(detail));
            return;
          }
          try {
            resolve(data ? (JSON.parse(data) as T) : ({} as T));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Tool API request timed out"));
    });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function userQuery(): string {
  const u = getUserName();
  return u ? `?user_id=${encodeURIComponent(u)}` : "";
}

export async function listTools(): Promise<ToolEntryWithIndex[]> {
  const resp = await apiRequest<{ object: string; data: ToolEntry[] }>(
    "GET",
    `/v1/config/tools${userQuery()}`,
  );
  return (resp.data || []).map((entry, index) => ({ ...entry, index }));
}

export async function createTool(entry: ToolEntry): Promise<ToolEntryWithIndex> {
  return apiRequest<ToolEntryWithIndex>(
    "POST",
    `/v1/config/tools${userQuery()}`,
    entry,
  );
}

export async function updateTool(
  index: number,
  entry: ToolEntry,
): Promise<ToolEntryWithIndex> {
  return apiRequest<ToolEntryWithIndex>(
    "PUT",
    `/v1/config/tools/${index}${userQuery()}`,
    entry,
  );
}

export async function deleteTool(index: number): Promise<boolean> {
  await apiRequest<{ status: string }>(
    "DELETE",
    `/v1/config/tools/${index}${userQuery()}`,
  );
  return true;
}
