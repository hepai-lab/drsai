import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { SaveApiKeyResult } from "../shared/desktopApi";
import { DRSAI_ENV_FILE } from "./paths";

const API_KEY_NAME = "HEPAI_API_KEY";
const MAX_API_KEY_CHARS = 4096;

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
    : "# DrSai environment\n";
  const next = upsertEnvValue(existing, API_KEY_NAME, apiKey);
  writeFileSync(DRSAI_ENV_FILE, next, "utf8");
  process.env.HEPAI_API_KEY = apiKey;
  return { ok: true, message: "API key saved." };
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
