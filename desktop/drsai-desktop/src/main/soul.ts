/**
 * SOUL (agent personality) management via DrSai API Gateway.
 *
 * AGENTS.md is the SOUL file — managed through /v1/config/agents-md endpoints.
 */

import * as http from "http";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

function apiGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    http
      .request(`${DRSAI_API_URL}${path}`, { method: "GET", timeout: 10000 }, (res: http.IncomingMessage) => {
        let body = "";
        res.on("data", (d: Buffer) => (body += d.toString()));
        res.on("end", () => {
          try { resolve(JSON.parse(body)); }
          catch { reject(new Error("Invalid JSON")); }
        });
      })
      .on("error", reject)
      .on("timeout", function (this: http.ClientRequest) {
        this.destroy();
        reject(new Error("Request timed out"));
      })
      .end();
  });
}

function apiPut(path: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${DRSAI_API_URL}${path}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, timeout: 10000 },
      (res: http.IncomingMessage) => { res.resume(); resolve(); },
    );
    req.on("error", reject);
    req.on("timeout", function (this: http.ClientRequest) {
      this.destroy();
      reject(new Error("Request timed out"));
    });
    req.write(data);
    req.end();
  });
}

export async function readSoul(_profile?: string): Promise<string> {
  try {
    const resp = (await apiGet<{ content: string; exists: boolean }>(
      "/v1/config/agents-md",
    )) as { content: string; exists: boolean };
    return resp.content || "";
  } catch (err) {
    console.error("[soul] readSoul failed:", err);
    return "";
  }
}

export async function writeSoul(content: string, _profile?: string): Promise<boolean> {
  try {
    await apiPut("/v1/config/agents-md", { content });
    return true;
  } catch (err) {
    console.error("[soul] writeSoul failed:", err);
    return false;
  }
}

export async function resetSoul(_profile?: string): Promise<boolean> {
  return writeSoul("");
}