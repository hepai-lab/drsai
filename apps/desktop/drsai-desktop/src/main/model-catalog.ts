import * as http from "http";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

// ── Types ───────────────────────────────────────────────

export interface ReasoningConfig {
  supported: boolean;
  effort_levels: string[];
  param_type: string;
}

export interface ModelCatalogEntry {
  alias: string;
  display_name: string;
  client_type: string;
  model: string;
  token_limit: number;
  max_tokens: number;
  reasoning?: ReasoningConfig;
}

export interface ModelCatalogResponse {
  default_alias: string;
  models: ModelCatalogEntry[];
}

// ── HTTP helpers ────────────────────────────────────────

function httpRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, DRSAI_API_URL);
    const bodyStr = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        timeout: 10000,
        headers: bodyStr
          ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(bodyStr)) }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (d: Buffer) => (data += d.toString()));
        res.on("end", () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              let msg = data;
              try { msg = JSON.parse(data).detail || data; } catch {}
              reject(new Error(msg));
              return;
            }
            resolve(JSON.parse(data) as T);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── API functions ───────────────────────────────────────

export async function getModelCatalog(): Promise<ModelCatalogResponse> {
  return httpRequest<ModelCatalogResponse>("GET", "/v1/models/config");
}

export async function getModelDetail(alias: string): Promise<ModelCatalogEntry & { alias: string }> {
  return httpRequest<ModelCatalogEntry & { alias: string }>(
    "GET",
    `/v1/models/config/${encodeURIComponent(alias)}`,
  );
}

export async function createModelConfig(body: {
  alias: string;
  model: string;
  token_limit?: number;
  max_tokens?: number;
  client_type?: string;
  reasoning?: ReasoningConfig;
}): Promise<ModelCatalogEntry & { alias: string }> {
  return httpRequest("POST", "/v1/models/config", body);
}

export async function updateModelConfig(
  alias: string,
  body: {
    model?: string;
    token_limit?: number;
    max_tokens?: number;
    client_type?: string;
    reasoning?: ReasoningConfig;
    new_alias?: string;
  },
): Promise<ModelCatalogEntry & { alias: string }> {
  return httpRequest("PUT", `/v1/models/config/${encodeURIComponent(alias)}`, body);
}

export async function deleteModelConfig(alias: string): Promise<{ ok: boolean; new_default_alias: string }> {
  return httpRequest("DELETE", `/v1/models/config/${encodeURIComponent(alias)}`);
}

export async function setDefaultModelConfig(alias: string): Promise<{ default_alias: string }> {
  return httpRequest("PUT", `/v1/models/config/default/${encodeURIComponent(alias)}`);
}