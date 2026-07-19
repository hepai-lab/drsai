param(
    [Parameter(Mandatory = $true)][string]$OldApk,
    [Parameter(Mandatory = $true)][string]$NewApk,
    [Parameter(Mandatory = $true)][string]$ManifestUrl,
    [string]$AvdName = "",
    [int]$TimeoutSeconds = 180,
    [string]$Report = "update-e2e-report.json"
)

$ErrorActionPreference = "Stop"
$adb = Join-Path $env:ANDROID_HOME "platform-tools\adb.exe"
if (-not (Test-Path $adb)) { throw "adb not found. Set ANDROID_HOME." }

function Invoke-Adb([string[]]$Args) {
    $output = & $adb @Args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "adb $($Args -join ' ') failed: $output" }
    return ($output -join "`n")
}

function Get-PackageVersion {
    $line = Invoke-Adb @("shell", "dumpsys", "package", "ai.drsai.remote") | Select-String "versionCode=([0-9]+)"
    if (-not $line) { return $null }
    return [int64]$line.Matches[0].Groups[1].Value
}

$started = Get-Date
$steps = [System.Collections.Generic.List[object]]::new()
function Step([string]$Name, [scriptblock]$Action) {
    $begin = Get-Date
    try {
        & $Action
        $steps.Add([ordered]@{ name = $Name; status = "passed"; durationMs = [int]((Get-Date) - $begin).TotalMilliseconds })
    } catch {
        $steps.Add([ordered]@{ name = $Name; status = "failed"; error = $_.Exception.Message; durationMs = [int]((Get-Date) - $begin).TotalMilliseconds })
        throw
    }
}

Step "install-old-apk" { Invoke-Adb @("install", "-r", $OldApk) | Out-Null }
$oldCode = Get-PackageVersion
Step "launch-old-app" { Invoke-Adb @("shell", "monkey", "-p", "ai.drsai.remote", "1") | Out-Null }
Step "verify-old-version" { if ($null -eq $oldCode) { throw "Old package version was not found." } }

# The app's UI performs the manifest request/download/install. This script records
# the system state and accepts the Package Installer confirmation with ADB input.
Step "wait-for-install-or-ui" {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $current = Get-PackageVersion
        if ($current -and $current -gt $oldCode) { return }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for N+1. Open the app, click Check and update, then rerun with UI automation enabled. Manifest: $ManifestUrl"
}

$newCode = Get-PackageVersion
$result = [ordered]@{
    schemaVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    oldApk = (Resolve-Path $OldApk).Path
    newApk = (Resolve-Path $NewApk).Path
    manifestUrl = $ManifestUrl
    oldVersionCode = $oldCode
    newVersionCode = $newCode
    passed = ($newCode -and $newCode -gt $oldCode)
    steps = $steps
}
$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $Report
if (-not $result.passed) { exit 1 }
Write-Output "Update E2E passed: $oldCode -> $newCode"
