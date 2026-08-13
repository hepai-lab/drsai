import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const scripts = [
  "scripts/collect-windows-sandbox-diagnostics.ps1",
  "scripts/capture-windows-sandbox-prelogout.ps1",
  "scripts/complete-windows-sandbox-acceptance.ps1",
  "scripts/guest/Invoke-OpenDrSaiAcceptance.ps1",
  "scripts/invoke-windows-sandbox-oidc-acceptance.ps1",
  "scripts/invoke-online-sandbox-acceptance.ps1",
  "scripts/invoke-candidate-sandbox-acceptance.ps1",
  "scripts/invoke-upgrade-sandbox-acceptance.ps1",
  "scripts/invoke-network-candidate-sandbox-acceptance.ps1",
  "scripts/seal-windows-sandbox-oidc-evidence.ps1",
];
for (const relative of scripts) verifyPowerShell(join(root, relative));

const host = read("scripts/invoke-windows-sandbox-oidc-acceptance.ps1");
assert(host.includes("windows-sandbox-session.ps1"), "acceptance launcher bypasses the standard Sandbox controller");
assert(host.includes("-Action Diagnose") && host.includes("-Action List"), "acceptance launcher omits Sandbox preflight");
assert(host.includes("<ReadOnly>true</ReadOnly>") && host.includes("<ReadOnly>false</ReadOnly>"), "Sandbox mappings do not separate immutable inputs from writable evidence");
assert(host.includes("acceptance-result.json"), "host launcher does not wait for structured acceptance evidence");
assert(host.includes("device-login-handoff.json") && host.includes('Host -ne "ai-dev.ihep.ac.cn"') && host.includes("Start-Process $verificationUrl"), "host launcher does not safely open the Sandbox device verification handoff");
assert(host.includes("host-sandbox-launch-failure.json") && host.includes("SANDBOX_SESSION_START_TIMEOUT"), "host launcher does not preserve Sandbox startup failure evidence");
assert(host.includes("Session $sessionId remains open"), "failure path does not preserve the Sandbox for inspection");
assert(host.includes("channels/beta/latest-windows.json"), "host launcher has no immutable channel-manifest input");
assert(host.includes("Complete the MSI wizard"), "host launcher does not tell the tester that the MSI UI requires confirmation");
assert(host.includes("[switch]$AutomateInstaller") && host.includes("automateInstaller = [bool]$AutomateInstaller"), "host launcher has no explicit unattended candidate-install mode");
assert(host.includes('ValidateSet("Online", "Candidate", "Upgrade", "NetworkCandidate")'), "host launcher does not expose every required Sandbox scenario");
assert(host.includes("releaseBaseUrl = $ReleaseBaseUrl.TrimEnd('/')"), "host launcher does not record the selected release CDN base URL");
assert(host.includes("watch-windows-sandbox-acceptance.ps1") && host.includes("$watcher"), "host launcher does not package the automatic acceptance observer");

const guest = read("scripts/guest/Invoke-OpenDrSaiAcceptance.ps1");
assert(guest.includes("OPENDRSAI_ACCEPTANCE_AUTO_DEVICE_LOGIN") && guest.includes("OPENDRSAI_OIDC_DEVICE_HANDOFF_PATH"), "guest does not enable the bounded device-login handoff");
for (const expected of [
  "Get-AuthenticodeSignature", "msi-install.log",
  "SANDBOX-E2E-$runId", "Start-AcceptanceObserver", "Wait-ForCompletedChat",
]) assert(guest.includes(expected), `guest acceptance omits ${expected}`);
assert(guest.includes("Finish the MSI wizard if visible"), "guest acceptance does not explain interactive installation");
for (const expected of ["Configure Tavily", "Log out in OpenDrSai", "collected automatically", "do not click any CMD files"]) {
  assert(guest.toLowerCase().includes(expected.toLowerCase()), `guest acceptance omits two-stage gate: ${expected}`);
}
assert(!/Write-OutcomeShortcuts|Write-FailShortcut|Acceptance-PASS\.cmd|FAIL-Collect\.cmd|Capture-Before-Logout\.cmd/.test(guest), "guest acceptance still requires CMD shortcut interaction");
assert(guest.includes("$args += '/qn'"), "guest acceptance does not implement unattended MSI installation");
assert(guest.includes('$Role-manifest.json'), "online acceptance does not retain role-specific channel manifests");
for (const expected of ["msi-baseline-install.log", "msi-candidate-upgrade.log", "Wait-ForCompletedChat"]) {
  assert(guest.includes(expected), `upgrade acceptance omits ${expected}`);
}
assert(!/developerBypass|OPENDRSAI_DEV_AUTH_BYPASS|fake.gateway/i.test(guest), "real Sandbox acceptance contains a fake authentication or Gateway bypass");

const collector = read("scripts/collect-windows-sandbox-diagnostics.ps1");
assert(collector.includes("https://ai-dev.ihep.ac.cn/api/.well-known/openid-configuration"), "collector does not probe the beta2 ai-dev OIDC discovery endpoint");
assert(collector.includes("https://ai-dev.ihep.ac.cn/apiv2/v1/models"), "collector does not probe the beta2 ai-dev model endpoint");
assert(!collector.includes("https://login.ihep.ac.cn/.well-known/openid-configuration"), "collector still probes the obsolete login.ihep OIDC endpoint");
assert(!collector.includes("https://aiapi.ihep.ac.cn/apiv2/models"), "collector still probes the obsolete aiapi model endpoint");
assert(collector.includes('method = "Get"') && collector.includes("Invoke-WebRequest -Uri $uri -Method $method"), "collector does not use GET for ai-dev contract probes");

const controller = read("scripts/windows-sandbox-session.ps1");
assert(controller.includes("$helper.WaitForExit(30000)"), "packaged wsb CLI invocation has no hard process timeout");
assert(controller.includes("Stop-Process -Id $helper.Id -Force"), "timed-out packaged wsb CLI helper is not terminated");
assert(controller.includes("launcherExitedBeforeCleanup") && controller.includes("Stop-Process -Id $launcher.Id -Force"), "timed-out Sandbox launchers are not cleaned without touching service hosts");

const finalizer = read("scripts/complete-windows-sandbox-acceptance.ps1");
const preLogout = read("scripts/capture-windows-sandbox-prelogout.ps1");
const watcher = read("scripts/watch-windows-sandbox-acceptance.ps1");
for (const expected of ["Get-CompletedChats", "Test-Tavily", "InitialProcessId", "preRestartChats", "postRestartChats", "complete-windows-sandbox-acceptance.ps1", "automatic-timeout"]) {
  assert(watcher.includes(expected), `automatic Sandbox observer omits ${expected}`);
}
assert(guest.includes("WindowStyle Hidden"), "automatic Sandbox observer is not started hidden");
for (const expected of ["encryptedOidcSession", "restartPersistence", "twoAcceptanceChats", "postRestartChat", "tavilySearchAvailable", "/v1/config/perceptors", "perceptor_id", "capability=search", "Local Gateway request failed:"]) {
  assert(preLogout.includes(expected), `pre-logout validator omits gate: ${expected}`);
}
assert(preLogout.includes('$_.acceptanceRunId -eq $RunId') && preLogout.includes('-lt $processStarted') && preLogout.includes('-gt $processStarted'), "pre-logout validator does not prove correlated chats across the app restart boundary");
assert(!preLogout.includes('-ge $authCreated'), "pre-logout validator incorrectly treats the refreshable auth record timestamp as the original login time");
for (const code of [
  "Default Agent bound", "HepAI Provider selected", "API Key not required",
  "Encrypted OIDC session before logout", "Restart persistence verified", "Two acceptance chats completed",
  "Post-restart chat verified", "Tavily search available", "OIDC logout cleared local session",
  "Gateway ready", "Runtime model catalog non-empty",
  "Real OpenDrSai execution completed", "Chat evidence correlated", "Diagnostic evidence redaction",
  "Installer support files colocated", "Start menu shortcut", "Bundled Runtime Python",
]) assert(finalizer.includes(code), `acceptance finalizer omits gate: ${code}`);
assert(finalizer.includes("manualChatAttestation") && finalizer.includes("observedChatCount -ge 2") && finalizer.includes("pre-logout-validation.json + manual"), "acceptance finalizer cannot record a bounded tester attestation backed by successful chat telemetry");
for (const field of ["checkedAt", "diagnosticCode", "summary.md", "run-manifest.json"]) {
  assert(finalizer.includes(field), `acceptance finalizer omits required evidence field/artifact: ${field}`);
}

for (const path of ["gateway.log", "agent-telemetry.jsonl", "install-state.json", "auth-metadata.json", "windows-events", "checksums.txt", "run-manifest.json", "summary.md", "screenshots"]) {
  assert(collector.includes(path), `diagnostic collector omits ${path}`);
}
for (const eventLog of ["CodeIntegrity/Operational", "Windows Defender/Operational", "application"]) {
  assert(collector.includes(eventLog), `diagnostic collector omits Windows event source ${eventLog}`);
}
for (const hashedField of ["issuerHash", "clientIdHash", "subjectHash"]) {
  assert(collector.includes(hashedField), `diagnostic collector omits hashed OIDC metadata ${hashedField}`);
}
assert(!/Copy-(?:Item|Redacted)[^\r\n]*auth\\auth\.json/i.test(collector), "diagnostic collector exports raw auth.json");
assert(collector.includes("secretFindingCount") && collector.includes("[REDACTED]"), "diagnostic collector lacks a fail-closed secret scan");
assert(guest.includes('Collect-Diagnostics $(if ($input.mode -eq "upgrade") { "baseline-pre-oidc" } else { "pre-oidc" })'), "guest acceptance omits the pre-OIDC snapshot");

const telemetry = read("../shared/main/agentTelemetry.ts");
assert(telemetry.includes("OPENDRSAI_ACCEPTANCE_RUN_ID") && telemetry.includes("acceptanceRunId"), "Agent telemetry cannot correlate a real Sandbox acceptance run");

const buildWorkflow = read("../../../.github/workflows/windows-desktop.yml");
assert(buildWorkflow.includes("draft: true") && buildWorkflow.includes("make_latest: false"), "Windows build workflow can publish stable assets before real Sandbox evidence promotion");
const promoteWorkflow = read("../../../.github/workflows/windows-release-promote.yml");
assert(promoteWorkflow.includes("windows-sandbox-oidc-evidence-v*.zip") && promoteWorkflow.includes("verify:sandbox-oidc-evidence"), "Windows promotion workflow does not require sealed real Sandbox OIDC evidence");

verifyCollectorRuntime();

console.log("Windows Sandbox real OIDC acceptance and evidence contract verified.");

function verifyCollectorRuntime() {
  const fixture = mkdtempSync(join(tmpdir(), "opendrsai-sandbox-collector-"));
  const home = join(fixture, "home");
  const install = join(fixture, "install");
  const machineLogs = join(fixture, "machine-logs");
  const evidence = join(fixture, "evidence");
  try {
    for (const path of [join(home, "auth"), join(home, "logs"), join(home, "configs", "agents"), install, machineLogs, evidence]) mkdirSync(path, { recursive: true });
    writeFileSync(join(home, "config.toml"), 'current_agent = "opendrsai"\nmodel_provider = "hepai"\nrequires_api_key = false\n');
    writeFileSync(join(home, "configs", "agents", "agent_opendrsai.toml"), 'provider_id = "hepai"\nmode = "explicit"\n');
    writeFileSync(join(home, "auth", "auth.json"), JSON.stringify({ authenticated: true, authMode: "oidc", issuer: "https://issuer.example", clientId: "private-client-id", subject: "private-subject", encryptedAccessToken: "secret-access-token", encryptedRefreshToken: "secret-refresh-token", scopes: ["openid", "profile"] }));
    writeFileSync(join(home, "logs", "gateway.log"), "Authorization: Bearer secret-bearer-value\n");
    writeFileSync(join(home, "logs", "agent-telemetry.jsonl"), `${JSON.stringify({ event: "execution_completed", agentId: "opendrsai", acceptanceRunId: "collector-contract-test", requestId: "request-1", runId: "run-1" })}\n`);
    writeFileSync(join(home, "logs", "model-catalog-status.json"), JSON.stringify({ authMode: "oidc", state: "ready", modelCount: 1 }));
    writeFileSync(join(install, "install-state.json"), JSON.stringify({ version: "1.5.5", desktopPath: join(install, "app", "OpenDrSai.exe") }));
    writeFileSync(join(evidence, "resolved-input.json"), JSON.stringify({ runId: "collector-contract-test", mode: "candidate", createdAt: new Date().toISOString(), expectedVersion: "1.5.5", gitCommit: "fixture", gitDirty: false }));
    const collectorPath = join(root, "scripts", "collect-windows-sandbox-diagnostics.ps1");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", collectorPath, "-EvidenceDir", evidence, "-RunId", "collector-contract-test", "-Phase", "contract", "-DrsaiHomeOverride", home, "-InstallRootOverride", install, "-MachineLogsOverride", machineLogs, "-SkipScreenshot", "-SkipNetworkProbes", "-SkipWindowsEvents"], { encoding: "utf8", windowsHide: true, timeout: 45_000 });
    assert(!result.error, `diagnostic collector fixture timed out or failed to start: ${result.error?.message || "unknown error"}`);
    assert(result.status === 0, `diagnostic collector fixture failed: ${(result.stdout || "") + (result.stderr || "")}`);
    for (const relative of ["collection-result.json", "run-manifest.json", "summary.md", "checksums.txt", "app/auth-metadata.json", "gateway/gateway.log", "windows-events/code-integrity.json"]) {
      assert(existsSync(join(evidence, relative)), `diagnostic collector fixture omitted ${relative}`);
    }
    const collection = JSON.parse(readFileSync(join(evidence, "collection-result.json"), "utf8"));
    assert(collection.passed === true && collection.secretFindingCount === 0, "diagnostic collector fixture failed the secret scan");
    const gateway = readFileSync(join(evidence, "gateway", "gateway.log"), "utf8");
    assert(gateway.includes("[REDACTED]") && !gateway.includes("secret-bearer-value"), "diagnostic collector did not redact a Bearer token");
    const auth = JSON.parse(readFileSync(join(evidence, "app", "auth-metadata.json"), "utf8"));
    assert(auth.issuerHash && auth.clientIdHash && auth.subjectHash && !JSON.stringify(auth).includes("private-"), "diagnostic collector leaked reversible OIDC identity metadata");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function read(relative) {
  return readFileSync(join(root, relative), "utf8");
}

function verifyPowerShell(path) {
  const quoted = path.replaceAll("'", "''");
  const command = `$errors=$null;[Management.Automation.Language.Parser]::ParseFile('${quoted}',[ref]$null,[ref]$errors)|Out-Null;if($errors){$errors|ForEach-Object{$_.ToString()};exit 1}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", windowsHide: true, timeout: 15_000,
  });
  if (result.status !== 0) throw new Error(`PowerShell syntax failed for ${path}: ${(result.stdout || result.stderr).trim()}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
