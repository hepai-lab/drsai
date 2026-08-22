import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "opendrsai-platform-config-"));
try {
  process.env.DRSAI_HOME = root;
  process.env.OPENDRSAI_DESKTOP_DEV = "1";
  const {
    getActivePlatformConfig,
    getPlatformConfigFileName,
    getPlatformConfigPath,
  } = await import("../../shared/main/platformConfig.ts");

  assert.equal(getPlatformConfigFileName(true), "config-dev.toml");
  assert.equal(getPlatformConfigFileName(false), "config.toml");
  assert.equal(getPlatformConfigPath(), join(root, "config-dev.toml"));
  assert.equal(getActivePlatformConfig().name, "development");
  assert.match(readFileSync(getPlatformConfigPath(), "utf8"), /active_platform = "development"/);

  writeFileSync(getPlatformConfigPath(), `active_platform = "production"

config_version = 2
model = "hepai/deepseek-v4-pro"
model_provider = "hepai"

[platforms.production]
portal_url = "https://ai.ihep.ac.cn"
base_url = "https://ai.ihep.ac.cn/apiv2/v1"

[model_providers.hepai]
base_url = "https://aiapi.ihep.ac.cn/apiv2"
wire_api = "openai"
requires_api_key = true
`, "utf8");
  const production = getActivePlatformConfig();
  assert.equal(production.name, "production");
  assert.equal(production.portalUrl, "https://ai-dev.ihep.ac.cn");
  assert.equal(production.baseUrl, "https://ai-dev.ihep.ac.cn/apiv2/v1");
  assert.equal(production.oidcIssuer, "https://ai-dev.ihep.ac.cn/api");

  process.env.OPENDRSAI_ACTIVE_PLATFORM = "production";
  process.env.OPENDRSAI_PLATFORM_BASE_URL = "https://hai.example.test";
  process.env.OPENDRSAI_PLATFORM_API_BASE_URL = "https://hai-api.example.test/apiv2";
  process.env.OPENDRSAI_OIDC_ISSUER = "https://hai.example.test/api";
  writeFileSync(getPlatformConfigPath(), 'active_platform = "development"\n', "utf8");
  const environmentSelected = getActivePlatformConfig();
  assert.equal(environmentSelected.name, "production");
  assert.equal(environmentSelected.portalUrl, "https://hai.example.test");
  assert.equal(environmentSelected.baseUrl, "https://hai-api.example.test/apiv2");
  assert.equal(environmentSelected.oidcIssuer, "https://hai.example.test/api");
  delete process.env.OPENDRSAI_ACTIVE_PLATFORM;
  delete process.env.OPENDRSAI_PLATFORM_BASE_URL;
  delete process.env.OPENDRSAI_PLATFORM_API_BASE_URL;
  delete process.env.OPENDRSAI_OIDC_ISSUER;

  writeFileSync(getPlatformConfigPath(), 'active_platform = 2\n', "utf8");
  assert.equal(getActivePlatformConfig().name, "development");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("Platform config isolation verification passed.");
