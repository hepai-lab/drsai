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

  writeFileSync(getPlatformConfigPath(), 'active_platform = "production"\ninvalid = "value"\n', "utf8");
  assert.throws(() => getActivePlatformConfig(), /Unknown platform configuration key/);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("Platform config isolation verification passed.");
