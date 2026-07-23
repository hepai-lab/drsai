import { request as httpRequest } from "http";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { SaveApiKeyResult } from "../api/desktopApi";
import { saveDefaultModelAlias } from "./modelDefaults";
import { DRSAI_ENV_FILE } from "./paths";
import { getGatewayRequestHeaders } from "./gateway";

const API_KEY_NAME = "HEPAI_API_KEY";
const MAX_API_KEY_CHARS = 4096;
const GATEWAY_BASE_URL = `http://127.0.0.1:${getGatewayPort()}`;

export function saveApiKey(rawApiKey: unknown): SaveApiKeyResult {
  if (typeof rawApiKey !== "string") {
    return { ok: false, message: "API key must be text." };
  }
  const apiKey = rawApiKey.trim();
  if (!apiKey) {
    return { ok: false, message: "API key cannot be empty." };
  }
  if (apiKey.length > MAX_API_KEY_CHARS) {
    return { ok: false, message: `API key cannot exceed ${MAX_API_KEY_CHARS} characters.` };
  }
  if (/[\r\n]/.test(apiKey)) {
    return { ok: false, message: "API key must be a single line." };
  }

  mkdirSync(dirname(DRSAI_ENV_FILE), { recursive: true });
  const existing = existsSync(DRSAI_ENV_FILE)
    ? readFileSync(DRSAI_ENV_FILE, "utf8")
    : "# OpenDrSai environment\n";
  const next = upsertEnvValue(existing, API_KEY_NAME, apiKey);
  writeFileSync(DRSAI_ENV_FILE, next, "utf8");
  process.env.HEPAI_API_KEY = apiKey;
  return { ok: true, message: "API key saved." };
}

export async function saveApiKeyAndDefaultModel(
  rawApiKey: unknown,
  rawDefaultModel?: unknown,
): Promise<SaveApiKeyResult> {
  const result = saveApiKey(rawApiKey);
  if (!result.ok) return result;
  const apiKey = typeof rawApiKey === "string" ? rawApiKey.trim() : "";
  let defaultModel: string | undefined;
  if (rawDefaultModel !== undefined) {
    defaultModel = saveDefaultModelAlias(rawDefaultModel);
  }
  await syncRunningGatewayConfig(apiKey, defaultModel);
  return result;
}

export function hasSavedApiKey(): boolean {
  return Boolean(readSavedApiKey());
}

export async function syncSavedApiKeyToGateway(): Promise<boolean> {
  const apiKey = process.env.HEPAI_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim()
    || readSavedApiKey();
  if (!apiKey) return false;
  await putGatewayConfig(`/v1/config/env/${encodeURIComponent(API_KEY_NAME)}`, { value: apiKey });
  return true;
}

function upsertEnvValue(content: string, key: string, value: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let replaced = false;
  const escaped = escapeRegExp(key);
  const active = new RegExp(`^\\s*${escaped}\\s*=`);
  const commented = new RegExp(`^\\s*#\\s*${escaped}\\s*=`);
  const nextLines = lines.map((line) => {
    if (active.test(line) || commented.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(`${key}=${value}`);
  }
  return `${nextLines.join("\n").replace(/\n*$/, "")}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function syncRunningGatewayConfig(
  apiKey: string,
  defaultModel?: string,
): Promise<void> {
  await Promise.all([
    putGatewayConfig(`/v1/config/env/${encodeURIComponent(API_KEY_NAME)}`, {
      value: apiKey,
    }),
    defaultModel
      ? putGatewayConfig("/v1/config/cli/defult_config_name", {
          value: defaultModel,
        })
      : Promise.resolve(),
  ]).catch(() => undefined);
}

function readSavedApiKey(): string {
  if (!existsSync(DRSAI_ENV_FILE)) return "";
  const line = readFileSync(DRSAI_ENV_FILE, "utf8")
    .split(/\r?\n/)
    .find((candidate) => /^\s*HEPAI_API_KEY\s*=/.test(candidate));
  return line?.replace(/^\s*HEPAI_API_KEY\s*=\s*/, "").trim() || "";
}

function putGatewayConfig(path: string, body: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    const req = httpRequest(
      `${GATEWAY_BASE_URL}${path}`,
      {
        method: "PUT",
        headers: {
          ...getGatewayRequestHeaders(),
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 1200,
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("error", () => resolve());
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.end(payload);
  });
}

function getGatewayPort(): string {
  const rawPort = process.env.OPENDRSAI_GATEWAY_PORT || process.env.DRSAI_API_PORT || "18642";
  return /^\d+$/.test(rawPort) ? rawPort : "18642";
}
