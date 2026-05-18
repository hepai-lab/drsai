/**
 * Skills management via DrSai API Gateway.
 *
 * Calls /v1/skills endpoints instead of reading the filesystem directly.
 */

import { DRSAI_HOME } from "./installer";
import { getUserName } from "./config";
import http from "http";

// ── API helpers ─────────────────────────────────────

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

function apiGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = `${DRSAI_API_URL}${path}`;
    http
      .request(url, { method: "GET", timeout: 10000 }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Invalid JSON from API: ${body.slice(0, 200)}`));
          }
        });
      })
      .on("error", reject)
      .on("timeout", function (this: http.ClientRequest) {
        this.destroy();
        reject(new Error("API request timed out"));
      })
      .end();
  });
}

// ── Types ───────────────────────────────────────────

export interface InstalledSkill {
  name: string;
  category: string;
  description: string;
  path: string;
}

export interface SkillSearchResult {
  name: string;
  description: string;
  category: string;
  source: string;
  installed: boolean;
}

// ── List installed skills ───────────────────────────

export function listInstalledSkills(_profile?: string): InstalledSkill[] {
  return []; // Sync fallback
}

export async function listInstalledSkillsAsync(
  _profile?: string,
): Promise<InstalledSkill[]> {
  try {
    const user = getUserName();
    const resp = (await apiGet<{ data: InstalledSkill[] }>(
      `/v1/skills?user_id=${encodeURIComponent(user)}`,
    )) as { data: InstalledSkill[] };
    return resp.data || [];
  } catch (err) {
    console.error("[skills] listInstalledSkillsAsync failed:", err);
    return [];
  }
}

// ── Get skill content ───────────────────────────────

export function getSkillContent(skillPath: string): string {
  return ""; // Sync fallback
}

export async function getSkillContentAsync(skillPath: string): Promise<string> {
  try {
    const resp = (await apiGet<{ content: string }>(
      `/v1/skills/${encodeURIComponent(skillPath)}`,
    )) as { content: string };
    return resp.content || "";
  } catch (err) {
    console.error("[skills] getSkillContentAsync failed:", err);
    return "";
  }
}

// ── Bundled skills (not supported via API yet) ─────

export function listBundledSkills(): SkillSearchResult[] {
  return [];
}

// ── Install / Uninstall ────────────────────────────

function apiPost(path: string, body: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      `${DRSAI_API_URL}${path}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, timeout: 10000 },
      (res) => { res.resume(); resolve(); },
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

function apiDelete(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${DRSAI_API_URL}${path}`,
      { method: "DELETE", timeout: 10000 },
      (res) => { res.resume(); resolve(); },
    );
    req.on("error", reject);
    req.on("timeout", function (this: http.ClientRequest) {
      this.destroy();
      reject(new Error("Request timed out"));
    });
    req.end();
  });
}

export async function installSkillAsync(
  name: string,
  content: string,
): Promise<boolean> {
  try {
    await apiPost(`/v1/skills/install?user_id=${encodeURIComponent(getUserName())}`, {
      name,
      content,
    });
    return true;
  } catch (err) {
    console.error("[skills] installSkillAsync failed:", err);
    return false;
  }
}

export async function uninstallSkillAsync(name: string): Promise<boolean> {
  try {
    await apiDelete(
      `/v1/skills/${encodeURIComponent(name)}?user_id=${encodeURIComponent(getUserName())}`,
    );
    return true;
  } catch (err) {
    console.error("[skills] uninstallSkillAsync failed:", err);
    return false;
  }
}

// ── Search skills (not supported via API yet) ───────

export function searchSkills(_query: string): SkillSearchResult[] {
  return [];
}
