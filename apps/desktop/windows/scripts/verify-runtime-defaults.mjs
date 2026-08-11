import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const defaultsRoot = join(root, "installer", "defaults", "drsai-home");
const configPath = join(defaultsRoot, "config.toml");
const agentPath = join(defaultsRoot, "configs", "agents", "agent_opendrsai.toml");
const modelsPath = join(defaultsRoot, "configs", "models", "provider_hepai.toml");
const runtimePath = join(root, "release", "bootstrapper", `OpenDrSai-Windows-v${packageJson.version}-x64.zip`);
const requireArchive = process.argv.includes("--require-archive");

assert(existsSync(configPath), "version-controlled Runtime defaults are missing config.toml");
assert(existsSync(agentPath), "version-controlled Runtime defaults are missing agent_opendrsai.toml");
assert(existsSync(modelsPath), "version-controlled Runtime defaults are missing provider_hepai.toml");
assert(!existsSync(join(defaultsRoot, ".env")), "Runtime defaults must not contain .env");
assert(!existsSync(join(defaultsRoot, "config.yaml")), "Runtime defaults must not contain legacy config.yaml");

verifyConfig(readFileSync(configPath, "utf8"), "source defaults/config.toml");
verifyAgent(readFileSync(agentPath, "utf8"), "source defaults agent_opendrsai.toml");
verifyModels(readFileSync(modelsPath, "utf8"), "source defaults provider_hepai.toml");

const builder = readFileSync(join(root, "installer", "create-opendrsai-runtime.ps1"), "utf8");
assert(builder.includes('"$PSScriptRoot\\defaults\\drsai-home"'), "Runtime builder default source is not version-controlled");
assert(!builder.includes("$agentParent = Split-Path -Parent $drsaiAgentDir"), "Runtime builder still falls back to the build user's .drsai directory");
assert(builder.includes('foreach ($forbiddenDefault in @(".env", "config.yaml"))'), "Runtime builder does not reject legacy or secret-bearing defaults");
assert(builder.includes('venv\\Scripts\\pythonw.exe required for background Runtime launch'), "Runtime builder does not require the no-console Python launcher");
assert(builder.includes('Runtime payload is missing the background Python launcher'), "Runtime builder does not verify packaged pythonw.exe");

const gateway = readFileSync(join(root, "..", "shared", "main", "gateway.ts"), "utf8");
assert(gateway.includes('join(dirname(pythonExecutable), "pythonw.exe")'), "Windows Gateway launch does not resolve pythonw.exe");
assert(gateway.includes("spawn(GATEWAY_PYTHON, args"), "Gateway still launches the console Python executable");
assert(gateway.includes("windowsHide: true"), "Gateway spawn does not retain the Windows hidden-window safeguard");

const desktopPaths = readFileSync(join(root, "..", "shared", "main", "paths.ts"), "utf8");
assert(desktopPaths.includes('["config.toml", ".env", "config.yaml"]'), "packaged first launch does not seed config.toml");
assert(desktopPaths.includes('join(defaultsDir, "configs")'), "packaged first launch does not seed the default Agent directory");

if (existsSync(runtimePath)) {
  const archive = inspectArchive(runtimePath);
  const names = new Set(archive.entries.map(normalizeEntry));
  const configEntry = "drsai-home/config.toml";
  const agentEntry = "drsai-home/configs/agents/agent_opendrsai.toml";
  const pythonwEntry = "drsai-agent/venv/Scripts/pythonw.exe";
  assert(names.has(configEntry), `Runtime archive is missing ${configEntry}`);
  assert(names.has(agentEntry), `Runtime archive is missing ${agentEntry}`);
  assert(names.has(pythonwEntry), `Runtime archive is missing ${pythonwEntry}`);
  assert(!names.has("drsai-home/.env"), "Runtime archive contains forbidden drsai-home/.env");
  assert(!names.has("drsai-home/config.yaml"), "Runtime archive contains forbidden legacy drsai-home/config.yaml");
  verifyConfig(archive.files[configEntry], "Runtime archive config.toml");
  verifyAgent(archive.files[agentEntry], "Runtime archive agent_opendrsai.toml");
} else if (requireArchive) {
  throw new Error(`Runtime archive is required but missing: ${runtimePath}`);
}

console.log(`OpenDrSai Runtime defaults verified${existsSync(runtimePath) ? " in source and archive" : " in source"}.`);

function verifyConfig(content, label) {
  assert(typeof content === "string" && content.length > 0, `${label} is empty`);
  assert(/^config_version\s*=\s*3\s*$/m.test(content), `${label} does not declare config_version 3`);
  assert(/^current_agent\s*=\s*"opendrsai"\s*$/m.test(content), `${label} does not bind the opendrsai Agent`);
  assert(/^agent_config_file\s*=\s*"configs\/agents\/agent_opendrsai\.toml"\s*$/m.test(content), `${label} has the wrong Agent file`);
  assert(/^model_provider\s*=\s*"hepai"\s*$/m.test(content), `${label} does not select HepAI`);
  assert(/^model\s*=\s*"[^"\r\n]+"\s*$/m.test(content), `${label} has no deterministic default model`);
  assert(/^\[model_providers\.hepai\]\s*$/m.test(content), `${label} has no HepAI Provider table`);
  assert(/^requires_api_key\s*=\s*false\s*$/m.test(content), `${label} requires an API Key`);
  assert(/^base_url\s*=\s*"https:\/\/ai-dev\.ihep\.ac\.cn\/apiv2\/v1"\s*$/m.test(content), `${label} does not use the ai-dev OpenAI endpoint`);
  assert(/^anthropic_base_url\s*=\s*"https:\/\/ai-dev\.ihep\.ac\.cn\/apiv2\/anthropic"\s*$/m.test(content), `${label} does not use the ai-dev Anthropic endpoint`);
  assert(/^google_base_url\s*=\s*"https:\/\/ai-dev\.ihep\.ac\.cn\/apiv2\/v1"\s*$/m.test(content), `${label} does not use the ai-dev Google endpoint`);
  assert(!/https:\/\/ai\.ihep\.ac\.cn/i.test(content), `${label} still targets the HAI production host`);
  assert(!/legacy-anthropic|ANTHROPIC_API_KEY|HEPAI_API_KEY|^\s*(?:api_key|api_key_env)\s*=/im.test(content), `${label} contains a legacy or static credential dependency`);
  assert(!/[A-Za-z]:\\Users\\|\/home\/[^/]+\//i.test(content), `${label} contains a build-machine path`);
}

function verifyAgent(content, label) {
  assert(typeof content === "string" && content.length > 0, `${label} is empty`);
  assert(/^schema_version\s*=\s*2\s*$/m.test(content), `${label} has the wrong schema`);
  assert(/^agent_name\s*=\s*"opendrsai"\s*$/m.test(content), `${label} has the wrong Agent identity`);
  assert(/^\[models\.primary\]\s*$/m.test(content), `${label} has no primary model selection`);
  assert(/^mode\s*=\s*"explicit"\s*$/m.test(content), `${label} primary model is not explicit`);
  assert(/^provider_id\s*=\s*"hepai"\s*$/m.test(content), `${label} primary model is not provided by HepAI`);
  assert(/^model_id\s*=\s*"[^"\r\n]+"\s*$/m.test(content), `${label} has no primary model ID`);
  assert(!/api[_-]?key|token\s*=|secret\s*=/i.test(content), `${label} contains secret-shaped configuration`);
}

function verifyModels(content, label) {
  const expected = ["deepseek-v4-flash", "deepseek-v4-pro", "gpt-5.6-luna", "gemini-3.1-flash-lite-image", "tts-1", "whisper-1"];
  for (const model of expected) assert(content.includes(`[models."${model}"]`), `${label} is missing ${model}`);
  assert((content.match(/^\[models\./gm) || []).length === expected.length, `${label} must contain exactly six product models`);
  assert(!content.includes("gemini-3.6-flash"), `${label} contains the excluded unstable model`);
}

function inspectArchive(path) {
  const quoted = path.replaceAll("'", "''");
  const command = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$zip=[IO.Compression.ZipFile]::OpenRead('${quoted}')`,
    "try {",
    "$entries=@($zip.Entries | ForEach-Object { $_.FullName })",
    "$files=@{}",
    "foreach($entry in $zip.Entries){$name=$entry.FullName.Replace('\\','/');if($name -in @('drsai-home/config.toml','drsai-home/configs/agents/agent_opendrsai.toml')){$reader=[IO.StreamReader]::new($entry.Open(),[Text.Encoding]::UTF8,$true);try{$files[$name]=$reader.ReadToEnd()}finally{$reader.Dispose()}}}",
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
