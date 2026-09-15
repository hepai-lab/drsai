import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const appSource = readFileSync(join(root, "apps/desktop/shared/renderer/src/App.tsx"), "utf8");
const configSource = readFileSync(join(root, "apps/desktop/shared/main/myDrSaiConfig.ts"), "utf8");
const gatewaySource = readFileSync(join(root, "cores/python/packages/drsai/src/drsai/backend/gateway.py"), "utf8");
const migrationSource = readFileSync(join(root, "cores/python/packages/drsai/src/drsai/config/migration.py"), "utf8");
const imageSource = readFileSync(join(root, "cores/python/packages/drsai/src/drsai/backend/runtime/image_operations.py"), "utf8");
const sensitiveSource = readFileSync(join(root, "apps/desktop/shared/api/sensitiveData.ts"), "utf8");

assert.doesNotMatch(configSource, /\/v1\/models\/config/, "production Desktop must not read or write legacy model CRUD");
assert.doesNotMatch(configSource, /getGatewayModels/, "production Desktop must not merge the compatibility model list");
assert.match(appSource, /AGENT_MODEL_POLICY_MIGRATION_BACKUP_KEY/, "Renderer migration must retain a rollback backup");
assert.match(appSource, /selectedChatAgentId === "my-drsai"[\s\S]{0,100}removeItem\(DEFAULT_MODEL_STORAGE_KEY\)/, "local OpenDrSai must stop writing a naked default model");
assert.match(appSource, /model: _model, imageModel: _imageModel/, "migrated local model and image-model fields must be removed from compatibility storage");
assert.match(appSource, /localModelCompatibilityEnabled[\s\S]{0,120}AGENT_MODEL_POLICY_MIGRATION_KEY/, "legacy localStorage reads must be independently disabled by the completed migration marker");
assert.match(gatewaySource, /DRSAI_LEGACY_MODEL_CONFIG_READ/, "legacy catalog reads must have an independent retirement switch");
assert.match(gatewaySource, /legacy_model_catalog_disabled/, "disabled compatibility reads must expose a stable recovery code");
for (const route of ["get", "post", "put", "delete"]) assert.match(gatewaySource, new RegExp(`@app\\.${route}\\(\"/v1/models/config`), `legacy ${route.toUpperCase()} compatibility route must remain explicit during rollback window`);
assert.match(gatewaySource, /\/v1\/models\/config[^\n]+deprecated=True/g, "legacy routes must be declared deprecated in OpenAPI");
assert.match(migrationSource, /target\.with_suffix\(target\.suffix \+ "\.bak"\)/, "TOML migration must retain an old-version rollback backup");
assert.match(migrationSource, /for path in \(yaml_path, cli_path, catalog_path\)[\s\S]{0,100}sources\.append/, "legacy YAML/JSON/catalog sources must remain available to old versions");
assert.match(sensitiveSource, /b64_json\|content_base64\|data_url\|image_base64/, "structured diagnostics must redact inline image bodies");
assert.doesNotMatch(imageSource, /return \{[\s\S]{0,500}"b64_json"/, "image tools must never return Provider base64 bodies");
assert.match(imageSource, /publish_content\([\s\S]{0,300}"artifact\.created"/, "validated image bytes must cross the UI boundary only as an Artifact");

const secretNames = [
  "HEPAI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY",
  "OPENDRSAI_GATEWAY_INSTANCE_TOKEN", "OPENDRSAI_OIDC_ACCESS_TOKEN", "OPENDRSAI_OIDC_REFRESH_TOKEN",
];
const liveSecrets = secretNames.map((name) => process.env[name]).filter((value): value is string => Boolean(value && value.length >= 8));
const artifactRoots = [
  join(root, "apps/desktop/windows/out/main"),
  join(root, "apps/desktop/windows/out/preload"),
  join(root, "apps/desktop/windows/out/renderer"),
  join(root, "apps/desktop/windows/release/win-unpacked/resources/app.asar"),
  join(root, "docs/desktop/evidence/opendrsai-windows-phase3-model-convergence-mc07.json"),
];
for (const target of artifactRoots) {
  if (!existsSync(target)) continue;
  for (const file of filesUnder(target)) {
    const content = readFileSync(file);
    for (const secret of liveSecrets) assert.equal(content.includes(Buffer.from(secret)), false, `live credential found in release artifact ${basename(file)}`);
  }
}

console.log(`OpenDrSai model release gates verified: legacy writes retired, rollback compatibility bounded, binary diagnostics redacted, and ${artifactRoots.filter(existsSync).length} artifact roots scanned for ${liveSecrets.length} live credential canaries.`);

function filesUnder(target: string): string[] {
  if (statSync(target).isFile()) return [target];
  const result: string[] = [];
  const pending = [target];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile() && statSync(path).size <= 64 * 1024 * 1024) result.push(path);
    }
  }
  return result;
}
