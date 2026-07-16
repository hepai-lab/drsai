import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const invoke = read("scripts/invoke-remote-workspace-sandbox-probe.ps1");
const guest = read("scripts/run-remote-workspace-sandbox-probe.ps1");
const controller = read("scripts/windows-sandbox-session.ps1");

assert(invoke.includes("<Networking>Enable</Networking>"), "Sandbox networking mode is not explicit");
assert(count(invoke, "<MappedFolder>") === 3, "Sandbox contract must define exactly package, credential and evidence mappings");
assert(invoke.includes("<SandboxFolder>C:\\OpenDrSaiPackage</SandboxFolder><ReadOnly>true</ReadOnly>"), "Package mapping is not read-only");
assert(invoke.includes("<SandboxFolder>C:\\OpenDrSaiTemporarySecrets</SandboxFolder><ReadOnly>true</ReadOnly>"), "Temporary credential mapping is not read-only");
assert(invoke.includes("<SandboxFolder>C:\\OpenDrSaiEvidence</SandboxFolder><ReadOnly>false</ReadOnly>"), "Evidence mapping is not writable");
assert(count(invoke, "<LogonCommand>") === 1 && invoke.includes("run-remote-workspace-sandbox-probe.ps1"), "LogonCommand must invoke the single guest probe script");
assert(guest.includes('Add-Check "Package mapping is read-only"'), "Guest does not prove the package mapping is read-only");
assert(guest.includes('Add-Check "Temporary credential mapping is read-only"'), "Guest does not prove the credential mapping is read-only");
assert(guest.includes('Add-Check "Evidence mapping is writable"'), "Guest does not prove the evidence mapping is writable");
assert(guest.includes("temporaryCredential = $true"), "Sandbox evidence does not label temporary credentials");
assert(guest.includes("shutdown.exe") && invoke.includes("-ShutdownOnComplete"), "Guest shutdown is not part of the acceptance lifecycle");
assert(controller.includes('Invoke-PackagedWsbCli @("list", "--raw")') && controller.includes('Invoke-PackagedWsbCli @("stop", "--id", $SessionId)'), "Sandbox controller is not based on official session IDs");
assert(!controller.includes("WindowsSandboxServer") || controller.includes("not an active-session signal"), "Sandbox Server process is incorrectly used as session truth");

for (const script of ["invoke-remote-workspace-sandbox-probe.ps1", "run-remote-workspace-sandbox-probe.ps1", "windows-sandbox-session.ps1", "repair-windows-sandbox-registration-elevated.ps1", "sign-windows-release.ps1"]) {
  const path = join(root, "scripts", script);
  const command = `$tokens=$null;$errors=$null;[Management.Automation.Language.Parser]::ParseFile('${path.replace(/'/g, "''")}',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object Message;exit 1}`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(`${script} has PowerShell syntax errors: ${result.stdout || result.stderr}`);
}

console.log("Remote Workspace Sandbox contract verification passed.");

function read(relative) { return readFileSync(join(root, relative), "utf8"); }
function count(value, needle) { return value.split(needle).length - 1; }
function assert(value, message) { if (!value) throw new Error(message); }
