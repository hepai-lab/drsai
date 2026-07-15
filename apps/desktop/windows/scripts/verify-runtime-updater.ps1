param()

$ErrorActionPreference = "Stop"

function Get-Sha256Hex([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
        $stream.Dispose()
    }
}
$root = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $root "resources\update\update-opendrsai.ps1"
$testRoot = Join-Path $root ".tmp\runtime-updater-test"
$version = "9.8.7"

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Initialize-UserData([string]$Root) {
    New-Item -ItemType Directory -Force -Path `
        (Join-Path $Root "auth"), `
        (Join-Path $Root "tasks"), `
        (Join-Path $Root "memory"), `
        (Join-Path $Root "workspace") | Out-Null
    [IO.File]::WriteAllText((Join-Path $Root "auth\auth.json"), '{"user":"m2-acceptance@ihep.ac.cn"}', (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $Root "tasks\tasks.json"), '[{"title":"Analyze CERN WLCG report","status":"complete"}]', (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $Root "memory\preferences.json"), '{"language":"zh","output":"pptx"}', (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllBytes((Join-Path $Root "workspace\WLCG-20260715-WLCG-talk-IHEP-visit.pdf"), [Text.Encoding]::ASCII.GetBytes("%PDF-1.7`nM2 preserved CERN source fixture`n%%EOF`n"))
}

function Get-UserDataSnapshot([string]$Root) {
    $items = @(Get-ChildItem -LiteralPath $Root -File -Recurse | Sort-Object FullName | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($Root.TrimEnd('\').Length + 1).Replace('\', '/')
            length = $_.Length
            sha256 = Get-Sha256Hex $_.FullName
        }
    })
    return ($items | ConvertTo-Json -Depth 4 -Compress)
}

function Build-ConsoleExe([string]$Path, [string]$Body, [string]$Name) {
    $source = @"
using System;
using System.IO;
public static class $Name {
  public static int Main(string[] args) {
    $Body
  }
}
"@
    Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $Path -OutputType ConsoleApplication
}

function Build-AppExe([string]$Path, [string]$Label, [bool]$Healthy, [string]$ClassName, [string]$HealthVersion = "") {
    $healthyLiteral = if ($Healthy) { "true" } else { "false" }
    $body = @"
    var baseDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    var installRoot = Directory.GetParent(baseDir).FullName;
    File.WriteAllText(Path.Combine(installRoot, "launched-$Label.txt"), "$Label");
    bool healthy = $healthyLiteral;
    if (!healthy) return 23;
    foreach (var arg in args) {
      const string prefix = "--opendrsai-update-token=";
      if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) {
        var token = arg.Substring(prefix.Length);
        var updater = Path.Combine(installRoot, "updater");
        Directory.CreateDirectory(updater);
        File.WriteAllText(Path.Combine(updater, "health-" + token + ".ok"), "$HealthVersion");
      }
    }
    return 0;
"@
    Build-ConsoleExe $Path $body $ClassName
}

function Build-Runtime([string]$OutputZip, [string]$TargetVersion, [bool]$Healthy, [string]$Suffix) {
    $work = Join-Path $testRoot "runtime-$Suffix"
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Join-Path $work "app"), (Join-Path $work "drsai-agent\venv\Scripts") | Out-Null
    Build-AppExe (Join-Path $work "app\OpenDrSai.exe") "new-$Suffix" $Healthy "FixtureApp$Suffix" $TargetVersion
    Build-ConsoleExe (Join-Path $work "drsai-agent\venv\Scripts\python.exe") "Console.WriteLine(`"drsai version: $TargetVersion`"); return 0;" "FixturePython$Suffix"
    [IO.File]::WriteAllText((Join-Path $work "drsai-agent\venv\Scripts\drsai.cmd"), "@echo off`r`n", (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $work "drsai-agent\venv\pyvenv.cfg"), "home = C:\hostedtoolcache\windows\Python\3.11.9\x64`r`n", (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $work "drsai-agent\new-$Suffix.txt"), $Suffix, (New-Object Text.UTF8Encoding($false)))
    $manifest = [ordered]@{
        name = "OpenDrSai Runtime"
        version = $TargetVersion
        channel = "dev"
        platform = "windows-x64"
        layoutVersion = 1
        entrypoints = @{ desktop = "app/OpenDrSai.exe"; python = "drsai-agent/venv/Scripts/python.exe" }
    }
    [IO.File]::WriteAllText((Join-Path $work "opendrsai-runtime.json"), (($manifest | ConvertTo-Json -Depth 6) + "`n"), (New-Object Text.UTF8Encoding($false)))
    Remove-Item -LiteralPath $OutputZip -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($work, $OutputZip, [IO.Compression.CompressionLevel]::Optimal, $false)
}

function Install-OldRuntime([string]$InstallRoot, [string]$AgentDir, [string]$Suffix) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $AgentDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "app"), $AgentDir | Out-Null
    Build-AppExe (Join-Path $InstallRoot "app\OpenDrSai.exe") "old-$Suffix" $true "OldFixtureApp$Suffix"
    [IO.File]::WriteAllText((Join-Path $AgentDir "old-$Suffix.txt"), $Suffix, (New-Object Text.UTF8Encoding($false)))
}

function Invoke-Prepare([string]$Archive, [string]$Staging, [string]$InstallRoot, [string]$AgentDir, [string]$State) {
    $hash = Get-Sha256Hex $Archive
    $size = (Get-Item -LiteralPath $Archive).Length
    & $helper -Mode Prepare -ArchivePath $Archive -StagingRoot $Staging -InstallRoot $InstallRoot -AgentDir $AgentDir `
        -ExpectedVersion $version -ExpectedSha256 $hash -ExpectedSizeBytes $size `
        -CurrentExecutable (Join-Path $InstallRoot "app\OpenDrSai.exe") -RequireSignature 0 -AllowUnsigned 1 -StatePath $State | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Updater prepare failed with exit code $LASTEXITCODE." }
}

Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null

try {
    # Successful prepare, atomic swap, health confirmation, and cleanup.
    $successRoot = Join-Path $testRoot "success\install"
    $successAgent = Join-Path $testRoot "success\home\drsai-agent"
    $successZip = Join-Path $testRoot "success.zip"
    $successStaging = Join-Path $testRoot "success\staging"
    $successState = Join-Path $successRoot "update-state.json"
    $successUserData = Join-Path $testRoot "success\profile\OpenDrSaiData"
    Install-OldRuntime $successRoot $successAgent "success"
    Initialize-UserData $successUserData
    $successUserDataBefore = Get-UserDataSnapshot $successUserData
    Build-Runtime $successZip $version $true "Success"
    Invoke-Prepare $successZip $successStaging $successRoot $successAgent $successState
    $preparedConfig = Get-Content -LiteralPath (Join-Path $successStaging "runtime\drsai-agent\venv\pyvenv.cfg") -Raw
    Assert-True ($preparedConfig -notmatch "hostedtoolcache") "Prepare retained the build runner Python home."
    Assert-True ($preparedConfig -match [regex]::Escape((Join-Path $successStaging "runtime\drsai-agent\venv"))) "Prepare did not bind pyvenv.cfg to the staged portable Python."
    & $helper -Mode Apply -StagingRoot $successStaging -InstallRoot $successRoot -AgentDir $successAgent `
        -ExpectedVersion $version -WaitPid 0 -HealthToken "11111111-1111-1111-1111-111111111111" `
        -HealthTimeoutSeconds 8 -CurrentExecutable (Join-Path $successRoot "app\OpenDrSai.exe") `
        -RequireSignature 0 -AllowUnsigned 1 -StatePath $successState
    Assert-True ($LASTEXITCODE -eq 0) "Successful runtime apply returned a failure code."
    Assert-True (Test-Path -LiteralPath (Join-Path $successAgent "new-Success.txt")) "New agent runtime was not installed."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $successAgent "old-success.txt"))) "Old agent runtime survived the successful swap."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $successRoot "app.previous"))) "Successful update did not clean app.previous."
    Assert-True ((Get-Content -LiteralPath $successState -Raw | ConvertFrom-Json).phase -eq "complete") "Successful update state is not complete."
    Assert-True ((Get-Content -LiteralPath (Join-Path $successRoot "install-state.json") -Raw | ConvertFrom-Json).version -eq $version) "Install state version was not updated."
    Assert-True ((Get-UserDataSnapshot $successUserData) -eq $successUserDataBefore) "Successful update changed account, task, memory, workspace, or CERN source data."

    # Broken new app must restore both old directories.
    $rollbackRoot = Join-Path $testRoot "rollback\install"
    $rollbackAgent = Join-Path $testRoot "rollback\home\drsai-agent"
    $rollbackZip = Join-Path $testRoot "rollback.zip"
    $rollbackStaging = Join-Path $testRoot "rollback\staging"
    $rollbackState = Join-Path $rollbackRoot "update-state.json"
    $rollbackUserData = Join-Path $testRoot "rollback\profile\OpenDrSaiData"
    Install-OldRuntime $rollbackRoot $rollbackAgent "rollback"
    Initialize-UserData $rollbackUserData
    $rollbackUserDataBefore = Get-UserDataSnapshot $rollbackUserData
    [IO.File]::WriteAllText((Join-Path $rollbackRoot "install-state.json"), '{"version":"1.0.0"}', (New-Object Text.UTF8Encoding($false)))
    Build-Runtime $rollbackZip $version $false "Rollback"
    Invoke-Prepare $rollbackZip $rollbackStaging $rollbackRoot $rollbackAgent $rollbackState
    & $helper -Mode Apply -StagingRoot $rollbackStaging -InstallRoot $rollbackRoot -AgentDir $rollbackAgent `
        -ExpectedVersion $version -WaitPid 0 -HealthToken "22222222-2222-2222-2222-222222222222" `
        -HealthTimeoutSeconds 2 -CurrentExecutable (Join-Path $rollbackRoot "app\OpenDrSai.exe") `
        -RequireSignature 0 -AllowUnsigned 1 -StatePath $rollbackState 2>$null
    Assert-True ($LASTEXITCODE -ne 0) "Broken runtime unexpectedly reported success."
    Assert-True (Test-Path -LiteralPath (Join-Path $rollbackAgent "old-rollback.txt")) "Rollback did not restore the old agent runtime."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $rollbackAgent "new-Rollback.txt"))) "Rollback left the broken agent runtime installed."
    Assert-True ((Get-Content -LiteralPath $rollbackState -Raw | ConvertFrom-Json).phase -eq "rolled-back") "Rollback result was not persisted."
    Assert-True ((Get-Content -LiteralPath (Join-Path $rollbackRoot "install-state.json") -Raw | ConvertFrom-Json).version -eq "1.0.0") "Rollback did not restore the previous install state."
    Assert-True ((Get-UserDataSnapshot $rollbackUserData) -eq $rollbackUserDataBefore) "Failed update or rollback changed account, task, memory, workspace, or CERN source data."

    # ZIP traversal must be rejected before any installed directory changes.
    $badZip = Join-Path $testRoot "traversal.zip"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::Open($badZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $entry = $zip.CreateEntry("../escape.txt")
        $writer = New-Object IO.StreamWriter($entry.Open())
        try { $writer.Write("escape") } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
    $badHash = Get-Sha256Hex $badZip
    & $helper -Mode Prepare -ArchivePath $badZip -StagingRoot (Join-Path $testRoot "bad-staging") `
        -InstallRoot $successRoot -AgentDir $successAgent -ExpectedVersion $version -ExpectedSha256 $badHash `
        -ExpectedSizeBytes (Get-Item $badZip).Length -CurrentExecutable (Join-Path $successRoot "app\OpenDrSai.exe") `
        -RequireSignature 0 -AllowUnsigned 1 -StatePath (Join-Path $testRoot "bad-state.json") 2>$null
    Assert-True ($LASTEXITCODE -ne 0) "ZIP traversal archive was not rejected."
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $testRoot "escape.txt"))) "ZIP traversal wrote outside staging."

    $evidenceDir = Join-Path $root "release\product-evidence\m2-update-rollback"
    New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
    $evidence = [ordered]@{
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        ok = $true
        targetVersion = $version
        checks = [ordered]@{
            successfulApply = $true
            successfulUpdateUserDataPreserved = $true
            brokenStartupRejected = $true
            oldAppAndAgentRestored = $true
            previousInstallVersionRestored = $true
            rollbackUserDataPreserved = $true
            cernSourceFilePreserved = $true
            zipTraversalRejected = $true
        }
        preservedUserData = @("account", "tasks", "memory", "workspace", "WLCG-20260715-WLCG-talk-IHEP-visit.pdf")
    }
    [IO.File]::WriteAllText((Join-Path $evidenceDir "runtime-updater-result.json"), (($evidence | ConvertTo-Json -Depth 6) + "`n"), (New-Object Text.UTF8Encoding($false)))
    Write-Host "Runtime updater prepare/apply/rollback/traversal and user-data preservation verification passed."
} finally {
    Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($testRoot, [StringComparison]::OrdinalIgnoreCase) } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}
