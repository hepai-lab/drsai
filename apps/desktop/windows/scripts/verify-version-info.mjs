import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeRuntimeVersionOutput, readBackendSourceVersion, readInstalledRuntimeVersion } from "../src/main/versionInfo.ts";

const root = mkdtempSync(join(tmpdir(), "opendrsai-version-info-"));
try {
  const agent = join(root, "drsai-agent");
  mkdirSync(agent, { recursive: true });
  writeFileSync(join(root, "install-state.json"), JSON.stringify({ version: "1.4.6", runtimeVersion: "1.4.7-rc1" }));
  assert.equal(readInstalledRuntimeVersion(agent), "version: 1.4.7-rc1");

  writeFileSync(join(root, "install-state.json"), JSON.stringify({ version: "not-a-version" }));
  assert.equal(readInstalledRuntimeVersion(agent), null);
  assert.equal(readInstalledRuntimeVersion(join(root, "missing-agent")), null);

  const sourceDir = join(agent, "venv", "Lib", "site-packages", "drsai");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "version.py"), '__version__ = "1.4.9"\n');
  assert.equal(readBackendSourceVersion(agent), "version: 1.4.9");

  const monorepo = join(root, "monorepo");
  const monorepoSource = join(monorepo, "cores", "python", "packages", "drsai", "src", "drsai");
  mkdirSync(monorepoSource, { recursive: true });
  writeFileSync(join(monorepoSource, "version.py"), '__version__ = "1.5.0"\n');
  assert.equal(readBackendSourceVersion(monorepo), "version: 1.5.0");

  assert.equal(normalizeRuntimeVersionOutput("drsai version: 1.4.6\r\n"), "version: 1.4.6");
  assert.equal(normalizeRuntimeVersionOutput("version: 1.4.7-rc1"), "version: 1.4.7-rc1");
  assert.equal(normalizeRuntimeVersionOutput("1.4.8"), "version: 1.4.8");
  assert.equal(normalizeRuntimeVersionOutput("warning: unavailable"), null);
  console.log("Installed runtime version presentation verification passed.");
} finally {
  rmSync(root, { recursive: true, force: true });
}
