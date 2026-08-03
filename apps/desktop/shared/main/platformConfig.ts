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

function defaultActivePlatform(): string {
  return isDesktopDevelopment() ? "development" : "production";
}

function platformConfigPath(): string {
  return join(DRSAI_HOME, getPlatformConfigFileName(isDesktopDevelopment()));
}

function defaultConfig(): string {
  return `active_platform = "${defaultActivePlatform()}"

[platforms.production]
portal_url = "https://ai.ihep.ac.cn"
base_url = "https://aiapi.ihep.ac.cn/apiv2"

[platforms.development]
portal_url = "https://ai-dev.ihep.ac.cn"
base_url = "https://ai-dev.ihep.ac.cn/apiv2"
`;
}

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
  return platformConfigPath();
}

export function getPlatformConfigFileName(development = isDesktopDevelopment()): string {
  return development ? "config-dev.toml" : "config.toml";
}

export function ensurePlatformConfig(): string {
  const configPath = platformConfigPath();
  if (existsSync(configPath)) return configPath;
  mkdirSync(DRSAI_HOME, { recursive: true });
  try {
    writeFileSync(configPath, defaultConfig(), { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!existsSync(configPath)) throw error;
  }
  return configPath;
}

export function getActivePlatformConfig(): DesktopPlatformConfig {
  const configPath = ensurePlatformConfig();
  const parsed = parsePlatformConfig(readFileSync(configPath, "utf8"));
  const builtIn = BUILT_INS[parsed.activePlatform];
  const configured = parsed.platforms[parsed.activePlatform];
  if (!builtIn && !configured) {
    throw new Error(`Unknown active_platform ${JSON.stringify(parsed.activePlatform)} in ${configPath}.`);
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
  const configPath = platformConfigPath();
  let activePlatform = defaultActivePlatform();
  let section: string | null = null;
  const platforms: Record<string, { portalUrl?: string; baseUrl?: string }> = {};
  for (const [lineIndex, original] of raw.split(/\r?\n/).entries()) {
    const line = stripTomlComment(original).trim();
    if (!line) continue;
    const header = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (header) {
      section = header[1];
      const platformName = platformSectionName(section);
      if (platformName) platforms[platformName] ||= {};
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!assignment) {
      throw new Error(`Unsupported TOML syntax at ${configPath}:${lineIndex + 1}.`);
    }
    const [, key, rawValue] = assignment;
    const value = parseTomlString(rawValue);
    if (!section && key === "active_platform") {
      if (value !== null && value.trim()) activePlatform = value.trim();
      continue;
    }
    const platformName = section ? platformSectionName(section) : null;
    if (platformName && key === "portal_url") {
      if (value === null) throw new Error(`portal_url must be a string in ${configPath}:${lineIndex + 1}.`);
      platforms[platformName] ||= {};
      platforms[platformName].portalUrl = value;
      continue;
    }
    if (platformName && key === "base_url") {
      if (value === null) throw new Error(`base_url must be a string in ${configPath}:${lineIndex + 1}.`);
      platforms[platformName] ||= {};
      platforms[platformName].baseUrl = value;
      continue;
    }
  }
  if (!activePlatform) activePlatform = defaultActivePlatform();
  return { activePlatform, platforms };
}

function platformSectionName(section: string): string | null {
  const match = section.match(/^platforms\.([A-Za-z0-9_-]+)$/);
  return match ? match[1] : null;
}

function parseTomlString(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (!match) return null;
  return match[1]
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
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
  if (quoted) throw new Error(`Unterminated string in ${platformConfigPath()}.`);
  return line;
}

function normalizeUrl(value: string | undefined, field: string): string {
  if (!value) throw new Error(`${field} is required for the active platform in ${platformConfigPath()}.`);
  const normalized = value.trim().replace(/\/+$/, "");
  const parsed = new URL(normalized);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${field} must be an HTTP(S) URL in ${platformConfigPath()}.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${field} must not contain URL credentials in ${platformConfigPath()}.`);
  }
  return normalized;
}
