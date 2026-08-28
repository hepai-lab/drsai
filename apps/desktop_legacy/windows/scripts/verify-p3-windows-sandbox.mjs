import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const [launcher, bootstrap, cleanup] = await Promise.all([
  readFile(path.join(scriptsDir, "start-p3-windows-sandbox.ps1"), "utf8"),
  readFile(path.join(scriptsDir, "bootstrap-p3-windows-sandbox.ps1"), "utf8"),
  readFile(path.join(scriptsDir, "cleanup-p3-provider-stage.ps1"), "utf8"),
]);
const trustedAgent = await readFile(path.join(scriptsDir, "prepare-ci-python-agent.ps1"), "utf8");

assert.match(launcher, /Get-Content -LiteralPath \(Join-Path \$PSScriptRoot "\.\.\\\\package\.json"\) -Raw \| ConvertFrom-Json/, "launcher must derive the Runtime version from the current Desktop package");
assert.match(launcher, /\$runtimeFileName = "OpenDrSai-Windows-v\$desktopVersion-x64\.zip"/, "launcher must bind the Runtime filename to the current Desktop version");
assert.doesNotMatch(launcher, /OpenDrSai-Windows-v1\.5\.6-x64\.zip/, "launcher must not pin a stale Runtime version");
assert.match(launcher, /OpenDrSaiSetup-P3-current-source\.msi/, "launcher must stage the current-source MSI");
assert.match(launcher, /run-p3-packaged-sandbox-suite\.cmd/, "launcher must stage the packaged P3 suite runner");
assert.match(launcher, /eval\\regression/, "launcher must stage the P3 regression definitions");
assert.match(launcher, /Get-FileHash -Algorithm SHA256/, "host staging must record artifact digests");
assert.match(launcher, /git -C \$repoRoot rev-parse HEAD/, "host staging must record the source commit");
assert.match(launcher, /<SandboxFolder>C:\\OpenDrSaiPackage<\/SandboxFolder>/, "package needs a stable sandbox location");
assert.match(launcher, /<ReadOnly>true<\/ReadOnly>/, "package mapping must remain read-only");
assert.match(launcher, /<SandboxFolder>C:\\P3\\evidence<\/SandboxFolder>/, "evidence needs a stable sandbox location");
assert.match(launcher, /windows-sandbox-session\.ps1/, "launcher must use the monitorable Sandbox controller");
assert.match(launcher, /-Action Start/, "launcher must create a monitorable Sandbox session");
assert.match(launcher, /<Networking>Enable<\/Networking>/, "real model verification requires sandbox networking");
assert.match(launcher, /Join-Path \$env:TEMP "OpenDrSaiP3Provider"/, "private Provider staging must stay outside the evidence tree");
assert.match(launcher, /cleanup-p3-provider-stage\.ps1/, "private Provider staging must have a lifecycle cleanup monitor");
assert.match(launcher, /-WindowStyle Hidden/, "the cleanup monitor must not open an interactive window");
assert.match(cleanup, /StartsWith\(\$privateRoot \+ \[IO\.Path\]::DirectorySeparatorChar/, "cleanup must enforce the private temporary root");
assert.match(cleanup, /Remove-Item -LiteralPath \$resolvedStage -Recurse -Force/, "cleanup must remove only the validated Provider stage");
assert.match(trustedAgent, /\.venv\\Scripts\\python\.exe/, "trusted Agent preparation must prefer the repository-controlled Python runtime");
assert.match(bootstrap, /Get-FileHash -Algorithm SHA256/, "guest must verify staged artifacts");
assert.match(bootstrap, /Start-Process -FilePath msiexec\.exe/, "guest must install the MSI rather than use the host app");
assert.match(bootstrap, /\$installRoot = Join-Path \$env:ProgramFiles "OpenDrSai"/, "guest must use the MSI installation root");
assert.match(bootstrap, /Join-Path \$installRoot "app\\OpenDrSai\.exe"/, "guest must launch the installed Desktop executable");
assert.match(bootstrap, /C:\\P3\\profile/, "sandbox profile must be isolated");
assert.match(bootstrap, /hostSessionReused=\$false/, "evidence must assert no host session reuse");
assert.match(bootstrap, /ready_for_login/, "guest must expose the required interactive-login boundary");
assert.doesNotMatch(bootstrap, /Install-SandboxPrerequisites|python-3\.11\.9-amd64\.exe|node-v20\.19\.2-x64\.msi|robocopy\.exe/, "packaged P3 must not bootstrap a development environment in Sandbox");

console.log("P3 Windows Sandbox launcher contract verified.");
