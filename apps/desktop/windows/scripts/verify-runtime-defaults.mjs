// v2 Runtime-defaults contract.
//
// The installer ships exactly one default home file: `config.toml`. Everything
// else under `~/.drsai/configs/**` (Agent, Provider, model catalog) is generated
// on first launch by `drsai.config.ensure_desktop_runtime_config`, which the
// desktop gateway runs from its lifespan. This verifier therefore checks:
//
//   1. `installer/defaults/drsai-home` still holds that one file, and it still
//      agrees with the Python constants that own the contract
//      (`drsai/config/defaults.py`, `drsai/config/model_defaults.py`).
//   2. The Runtime still owns first-launch `configs/**` generation, so nobody
//      "fixes" a missing Agent file by copying one into the installer defaults
//      (an existing Agent file is authoritative user configuration and would
//      then never be repaired by the bootstrap again).
//   3. Nothing re-introduces the V1 layout: `.env`, `config.yaml`, a
//      version-controlled `configs/` tree, or the retired `ai-dev`/`ai.ihep`
//      hosts.
//
//   node scripts/verify-runtime-defaults.mjs [--require-archive]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const defaultsRoot = join(root, "installer", "defaults", "drsai-home");
const configPath = join(defaultsRoot, "config.toml");
const runtimePath = join(root, "release", "bootstrapper", `OpenDrSai-Windows-v${packageJson.version}-x64.zip`);
const requireArchive = process.argv.includes("--require-archive");

// `drsai` source tree: <repo>/cores/python/packages/drsai/src/drsai
const pythonPackageRoot = resolve(root, "..", "..", "..", "cores", "python", "packages", "drsai", "src", "drsai");

const EXPECTED_SPECIALIZED_MODELS = ["gpt-5.6-luna", "gemini-3.1-flash-lite-image", "tts-1", "whisper-1"];

assert(existsSync(configPath), "version-controlled Runtime defaults are missing config.toml");
assert(existsSync(defaultsRoot), "version-controlled Runtime defaults directory is missing");
assert(
  !existsSync(join(defaultsRoot, "configs")),
  "Runtime defaults must not ship a configs/ tree; drsai.config.ensure_desktop_runtime_config owns it",
);
assert(!existsSync(join(defaultsRoot, ".env")), "Runtime defaults must not contain .env");
assert(!existsSync(join(defaultsRoot, "config.yaml")), "Runtime defaults must not contain legacy config.yaml");

const configToml = readFileSync(configPath, "utf8");
verifyConfig(configToml, "source defaults/config.toml");
verifyRuntimeOwnership(configToml);
verifyBuilder();
verifyFirstLaunchSeeding();
verifyGatewayLauncher();

if (existsSync(runtimePath)) {
  const archive = inspectArchive(runtimePath);
  const names = new Set(archive.entries.map(normalizeEntry));
  const configEntry = "drsai-home/config.toml";
  const pythonwEntry = "drsai-agent/venv/Scripts/pythonw.exe";
  assert(names.has(configEntry), `Runtime archive is missing ${configEntry}`);
  assert(names.has(pythonwEntry), `Runtime archive is missing ${pythonwEntry}`);
  assert(
    ![...names].some((name) => name.startsWith("drsai-home/configs/")),
    "Runtime archive must not ship a generated drsai-home/configs/ tree",
  );
  assert(!names.has("drsai-home/.env"), "Runtime archive contains forbidden drsai-home/.env");
  assert(!names.has("drsai-home/config.yaml"), "Runtime archive contains forbidden legacy drsai-home/config.yaml");
  verifyConfig(archive.files[configEntry], "Runtime archive config.toml");
} else if (requireArchive) {
  throw new Error(`Runtime archive is required but missing: ${runtimePath}`);
}

console.log(
  `OpenDrSai Runtime defaults verified (${existsSync(runtimePath) ? "source and archive" : "source"}).`,
);

function verifyConfig(content, label) {
  assert(typeof content === "string" && content.length > 0, `${label} is empty`);
  assert(/^config_version\s*=\s*3\s*$/m.test(content), `${label} does not declare config_version 3`);
  assert(/^current_agent\s*=\s*"opendrsai"\s*$/m.test(content), `${label} does not bind the opendrsai Agent`);
  assert(
    /^agent_config_file\s*=\s*"configs\/agents\/agent_opendrsai\.toml"\s*$/m.test(content),
    `${label} has the wrong Agent file`,
  );
  assert(/^model_provider\s*=\s*"hepai"\s*$/m.test(content), `${label} does not select HepAI`);
  assert(/^model\s*=\s*"[^"\r\n]+"\s*$/m.test(content), `${label} has no deterministic default model`);
  assert(/^\[model_providers\.hepai\]\s*$/m.test(content), `${label} has no HepAI Provider table`);
  assert(/^requires_api_key\s*=\s*false\s*$/m.test(content), `${label} requires an API Key`);
  assert(/^models_file\s*=\s*"configs\/models\/provider_hepai\.toml"\s*$/m.test(content), `${label} has the wrong model catalog path`);

  // DDF is the single upstream for model, DDF and Anthropic traffic; the
  // resolved values live in drsai.platform_upstream (verified by
  // verifyRuntimeOwnership for the Python side).
  assert(
    /^base_url\s*=\s*"https:\/\/ddf\.ihep\.ac\.cn\/apiv2"\s*$/m.test(content),
    `${label} does not use the DDF OpenAI endpoint`,
  );
  assert(
    /^anthropic_base_url\s*=\s*"https:\/\/ddf\.ihep\.ac\.cn\/apiv2\/anthropic"\s*$/m.test(content),
    `${label} does not use the DDF Anthropic endpoint`,
  );
  assert(
    /^google_base_url\s*=\s*"https:\/\/ddf\.ihep\.ac\.cn\/apiv2"\s*$/m.test(content),
    `${label} does not use the DDF Google endpoint`,
  );

  assert(!/https:\/\/ai\.ihep\.ac\.cn/i.test(content), `${label} still targets the retired HAI host`);
  assert(!/ai-dev\.ihep\.ac\.cn/i.test(content), `${label} still targets the retired ai-dev host`);
  assert(
    !/legacy-anthropic|ANTHROPIC_API_KEY|HEPAI_API_KEY|^\s*(?:api_key|api_key_env)\s*=/im.test(content),
    `${label} contains a legacy or static credential dependency`,
  );
  assert(!/[A-Za-z]:\\Users\\|\/home\/[^/]+\//i.test(content), `${label} contains a build-machine path`);
}

// The shipped `config.toml` is a projection of the Python constants. Checking
// agreement (rather than re-hard-coding the values here) is what keeps a future
// CURRENT_CONFIG_VERSION bump from shipping a stale installer default.
function verifyRuntimeOwnership(configToml) {
  const defaultsPy = readFileSync(join(pythonPackageRoot, "config", "defaults.py"), "utf8");
  const modelDefaultsPy = readFileSync(join(pythonPackageRoot, "config", "model_defaults.py"), "utf8");

  assert(
    pythonConstant(defaultsPy, "CURRENT_CONFIG_VERSION") === tomlScalar(configToml, "config_version"),
    "shipped config.toml config_version disagrees with drsai.config.defaults.CURRENT_CONFIG_VERSION",
  );
  assert(
    pythonConstant(defaultsPy, "DEFAULT_AGENT") === tomlScalar(configToml, "current_agent"),
    "shipped config.toml current_agent disagrees with drsai.config.defaults.DEFAULT_AGENT",
  );
  assert(
    pythonConstant(defaultsPy, "DEFAULT_AGENT_CONFIG_FILE") === tomlScalar(configToml, "agent_config_file"),
    "shipped config.toml agent_config_file disagrees with drsai.config.defaults.DEFAULT_AGENT_CONFIG_FILE",
  );

  const defaultProvider = pythonConstant(defaultsPy, "DEFAULT_PROVIDER");
  assert(
    defaultProvider === tomlScalar(configToml, "model_provider"),
    "shipped config.toml model_provider disagrees with drsai.config.defaults.DEFAULT_PROVIDER",
  );
  assert(
    pythonConstant(modelDefaultsPy, "DEFAULT_CONFIG_NAME") === `${defaultProvider}/${tomlScalar(configToml, "model")}`,
    "shipped config.toml model disagrees with drsai.config.model_defaults.DEFAULT_CONFIG_NAME",
  );

  const bootstrap = readFileSync(join(pythonPackageRoot, "config", "desktop_bootstrap.py"), "utf8");
  assert(
    /^def ensure_desktop_runtime_config\(/m.test(bootstrap),
    "drsai.config.ensure_desktop_runtime_config is gone; the Runtime no longer owns first-launch config generation",
  );
  assert(
    /_SPECIALIZED_PRODUCT_MODELS/.test(bootstrap),
    "Runtime product model catalog is gone; the desktop model picker would lose its non-chat models",
  );
  for (const model of EXPECTED_SPECIALIZED_MODELS) {
    assert(bootstrap.includes(`"${model}": {`), `Runtime product model catalog is missing ${model}`);
  }
  assert(
    !bootstrap.includes("gemini-3.6-flash"),
    "Runtime product model catalog contains the excluded unstable model gemini-3.6-flash",
  );

  const gatewayApp = readFileSync(join(pythonPackageRoot, "backend", "desktop_gateway", "app.py"), "utf8");
  assert(
    gatewayApp.includes("ensure_desktop_runtime_config"),
    "desktop gateway lifespan no longer runs the Runtime config bootstrap",
  );
}

function verifyBuilder() {
  const builder = readFileSync(join(root, "installer", "create-opendrsai-runtime.ps1"), "utf8");
  assert(
    builder.includes('"$PSScriptRoot\\defaults\\drsai-home"'),
    "Runtime builder default source is not version-controlled",
  );
  assert(
    builder.includes('foreach ($requiredDefault in @("config.toml"))'),
    "Runtime builder must require exactly the shipped config.toml",
  );
  assert(
    builder.includes('foreach ($forbiddenDefault in @(".env", "config.yaml"))'),
    "Runtime builder does not reject legacy or secret-bearing defaults",
  );
  assert(
    !builder.includes("$agentParent = Split-Path -Parent $drsaiAgentDir"),
    "Runtime builder still falls back to the build user's .drsai directory",
  );
  assert(
    builder.includes("venv\\Scripts\\pythonw.exe required for background Runtime launch"),
    "Runtime builder does not require the no-console Python launcher",
  );
  assert(
    builder.includes("Runtime payload is missing the background Python launcher"),
    "Runtime builder does not verify packaged pythonw.exe",
  );
  assert(
    builder.includes("DrsaiHomeDefaultsDir"),
    "Runtime builder no longer accepts/validates the version-controlled defaults directory",
  );
}

function verifyFirstLaunchSeeding() {
  const desktopPaths = readFileSync(join(root, "..", "shared", "main", "paths.ts"), "utf8");
  assert(
    desktopPaths.includes('for (const name of ["config.toml"])'),
    "packaged first launch must seed only config.toml",
  );
  assert(
    !desktopPaths.includes('join(defaultsDir, "configs")'),
    "packaged first launch must not copy a configs/ tree; the Runtime bootstrap owns it",
  );
  assert(!desktopPaths.includes("config.yaml"), "packaged first launch still knows about legacy config.yaml");
}

function verifyGatewayLauncher() {
  const gateway = readFileSync(join(root, "..", "shared", "main", "gateway.ts"), "utf8");
  assert(
    gateway.includes('join(dirname(pythonExecutable), "pythonw.exe")'),
    "Windows Gateway launch does not resolve pythonw.exe",
  );
  assert(gateway.includes("spawn(GATEWAY_PYTHON, args"), "Gateway still launches the console Python executable");
  assert(gateway.includes("windowsHide: true"), "Gateway spawn does not retain the Windows hidden-window safeguard");
  assert(
    gateway.includes("drsai.backend.desktop_gateway"),
    "Gateway no longer launches the v2 desktop Runtime module",
  );
}

function tomlScalar(content, key) {
  const match = new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, "m").exec(content);
  assert(match, `config.toml has no ${key}`);
  return match[1].replace(/^"|"$/g, "");
}

function pythonConstant(source, name) {
  const match = new RegExp(`^${name}\\s*=\\s*(.+?)\\s*$`, "m").exec(source);
  assert(match, `drsai Python defaults no longer declare ${name}`);
  return match[1].replace(/^"|"$/g, "");
}

function inspectArchive(path) {
  const quoted = path.replaceAll("'", "''");
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$zip=[IO.Compression.ZipFile]::OpenRead('${quoted}')`,
    "try {",
    "$entries=@($zip.Entries | ForEach-Object { $_.FullName })",
    "$files=@{}",
    "foreach($entry in $zip.Entries){$name=$entry.FullName.Replace('\\','/');if($name -in @('drsai-home/config.toml')){$reader=[IO.StreamReader]::new($entry.Open(),[Text.Encoding]::UTF8,$true);try{$files[$name]=$reader.ReadToEnd()}finally{$reader.Dispose()}}}",
    "[pscustomobject]@{entries=$entries;files=$files}|ConvertTo-Json -Depth 4 -Compress",
    "} finally { $zip.Dispose() }",
  ].join(";");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Cannot inspect Runtime archive: ${(result.stderr || result.stdout).trim()}`);
  return JSON.parse(result.stdout);
}

function normalizeEntry(value) {
  return String(value).replaceAll("\\", "/").replace(/^\.\//, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
