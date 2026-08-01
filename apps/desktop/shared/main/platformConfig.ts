import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { isDesktopDevelopment } from "./desktopRuntimeMode";
import { DRSAI_HOME } from "./paths";

export interface DesktopPlatformConfig {
  name: string;
  portalUrl: string;
  baseUrl: string;
  oidcIssuer: string;
}

const DESKTOP_DEVELOPMENT = isDesktopDevelopment();
const CONFIG_PATH = join(DRSAI_HOME, getPlatformConfigFileName(DESKTOP_DEVELOPMENT));
const DEFAULT_ACTIVE_PLATFORM = DESKTOP_DEVELOPMENT ? "development" : "production";
const DEFAULT_CONFIG = `active_platform = "${DEFAULT_ACTIVE_PLATFORM}"

[platforms.production]
portal_url = "https://ai.ihep.ac.cn"
base_url = "https://aiapi.ihep.ac.cn/apiv2"

[platforms.development]
portal_url = "https://ai-dev.ihep.ac.cn"
base_url = "https://ai-dev.ihep.ac.cn/apiv2"
`;

const BUILT_INS: Record<string, { portalUrl: string; baseUrl: string }> = {
  production: {
    portalUrl: "https://ai.ihep.ac.cn",
    baseUrl: "https://aiapi.ihep.ac.cn/apiv2",
  },
  development: {
    portalUrl: "https://ai-dev.ihep.ac.cn",
    baseUrl: "https://ai-dev.ihep.ac.cn/apiv2",
  },
};

export function getPlatformConfigPath(): string {
  return CONFIG_PATH;
}

export function getPlatformConfigFileName(development = isDesktopDevelopment()): string {
  return development ? "config-dev.toml" : "config.toml";
}

export function ensurePlatformConfig(): string {
  if (existsSync(CONFIG_PATH)) return CONFIG_PATH;
  mkdirSync(DRSAI_HOME, { recursive: true });
  try {
    writeFileSync(CONFIG_PATH, DEFAULT_CONFIG, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!existsSync(CONFIG_PATH)) throw error;
  }
  return CONFIG_PATH;
}

export function getActivePlatformConfig(): DesktopPlatformConfig {
  ensurePlatformConfig();
  const parsed = parsePlatformConfig(readFileSync(CONFIG_PATH, "utf8"));
  const builtIn = BUILT_INS[parsed.activePlatform];
  const configured = parsed.platforms[parsed.activePlatform];
  if (!builtIn && !configured) {
    throw new Error(`Unknown active_platform ${JSON.stringify(parsed.activePlatform)} in ${CONFIG_PATH}.`);
  }
  const portalUrl = normalizeUrl(
    process.env.OPENDRSAI_PLATFORM_BASE_URL || configured?.portalUrl || builtIn?.portalUrl,
    "portal_url",
  );
  const baseUrl = normalizeUrl(configured?.baseUrl || builtIn?.baseUrl, "base_url");
  const configuredIssuer =
    process.env.OPENDRSAI_OIDC_ISSUER?.trim() ||
    process.env.HAI_OIDC_ISSUER?.trim();
  return {
    name: parsed.activePlatform,
    portalUrl,
    baseUrl,
    oidcIssuer: normalizeUrl(configuredIssuer || `${portalUrl}/api`, "oidc_issuer"),
  };
}

function parsePlatformConfig(raw: string): {
  activePlatform: string;
  platforms: Record<string, { portalUrl?: string; baseUrl?: string }>;
} {
  let activePlatform = DEFAULT_ACTIVE_PLATFORM;
  let section: string | null = null;
  const platforms: Record<string, { portalUrl?: string; baseUrl?: string }> = {};
  for (const [lineIndex, original] of raw.split(/\r?\n/).entries()) {
    const line = stripTomlComment(original).trim();
    if (!line) continue;
    const header = line.match(/^\[platforms\.([A-Za-z0-9_-]+)\]$/);
    if (header) {
      section = header[1];
      platforms[section] ||= {};
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"\s*$/);
    if (!assignment) {
      throw new Error(`Unsupported TOML syntax at ${CONFIG_PATH}:${lineIndex + 1}.`);
    }
    const [, key, value] = assignment;
    if (!section && key === "active_platform") {
      activePlatform = value.trim();
      continue;
    }
    if (section && key === "portal_url") {
      platforms[section].portalUrl = value;
      continue;
    }
    if (section && key === "base_url") {
      platforms[section].baseUrl = value;
      continue;
    }
    throw new Error(`Unknown platform configuration key ${JSON.stringify(key)} at ${CONFIG_PATH}:${lineIndex + 1}.`);
  }
  if (!activePlatform) throw new Error(`active_platform must not be empty in ${CONFIG_PATH}.`);
  return { activePlatform, platforms };
}

function stripTomlComment(line: string): string {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "\"") quoted = !quoted;
    if (character === "#" && !quoted) return line.slice(0, index);
  }
  if (quoted) throw new Error(`Unterminated string in ${CONFIG_PATH}.`);
  return line;
}

function normalizeUrl(value: string | undefined, field: string): string {
  if (!value) throw new Error(`${field} is required for the active platform in ${CONFIG_PATH}.`);
  const normalized = value.trim().replace(/\/+$/, "");
  const parsed = new URL(normalized);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${field} must be an HTTP(S) URL in ${CONFIG_PATH}.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${field} must not contain URL credentials in ${CONFIG_PATH}.`);
  }
  return normalized;
}
