param(
    [string]$PackageDir = "C:\OpenDrSaiPackage",
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence",
    [switch]$ShutdownOnComplete
)

$ErrorActionPreference = "Stop"
$checks = [Collections.Generic.List[object]]::new()
$evidencePath = Join-Path $EvidenceDir "codex-local-packaged-sandbox.json"
function Add-Check([string]$Name, [bool]$Passed, [string]$Detail = "") {
    $checks.Add([pscustomobject]@{ name = $Name; status = $(if ($Passed) { "PASS" } else { "FAIL" }); detail = $Detail }) | Out-Null
}

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
try {
    Add-Check "Windows Sandbox identity" ($env:USERNAME -eq "WDAGUtilityAccount") $env:USERNAME
    $networked = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object IPv4DefaultGateway).Count -gt 0
    Add-Check "Networking disabled during install" (-not $networked) "defaultGateway=$networked"
    $descriptor = Get-Content -Raw -Encoding UTF8 (Join-Path $PackageDir "package.json") | ConvertFrom-Json
    $zip = Join-Path $PackageDir "OpenDrSaiRuntime-win-x64.zip"
    $actualHash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    Add-Check "Runtime digest" ($actualHash -eq [string]$descriptor.sha256) $actualHash
    Add-Check "Runtime size" ((Get-Item $zip).Length -eq [int64]$descriptor.size) ([string](Get-Item $zip).Length)

    $installRoot = "C:\OpenDrSai"
    $stateRoot = "C:\OpenDrSaiHome"
    $installScript = Join-Path $PackageDir "install-opendrsai.ps1"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installScript `
        -RuntimeUrl ([Uri]$zip).AbsoluteUri -RuntimeSha256 $actualHash -RuntimeSizeBytes ([int64]$descriptor.size) `
        -InstallRoot $installRoot -DrsaiHome $stateRoot -BootstrapperVersion "1.4.6" -NoShortcuts -NoLaunch -Quiet
    if ($LASTEXITCODE -ne 0) { throw "Offline Runtime installation failed with $LASTEXITCODE." }
    $installState = Get-Content -Raw -Encoding UTF8 (Join-Path $installRoot "install-state.json") | ConvertFrom-Json
    Add-Check "Desktop installed" (Test-Path -LiteralPath $installState.desktopPath -PathType Leaf) ([string]$installState.desktopPath)
    Add-Check "Runtime home isolated" ($installState.drsaiHome -eq $stateRoot) ([string]$installState.drsaiHome)

    $codexRoot = Join-Path $stateRoot "runtime\codex"
    $current = Get-Content -Raw -Encoding UTF8 (Join-Path $codexRoot "artifacts\current.json") | ConvertFrom-Json
    $manifestPath = Join-Path $codexRoot "artifacts\versions\$($current.version)\manifest.json"
    $manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
    $codexExe = Join-Path (Split-Path -Parent $manifestPath) ([string]$manifest.executable).Replace('/', '\')
    $version = (& $codexExe --version 2>&1 | Out-String).Trim()
    Add-Check "Managed Codex current pointer" ($current.version -eq $manifest.version) ([string]$current.version)
    Add-Check "Managed Codex trust store" (Test-Path -LiteralPath (Join-Path $codexRoot "trusted-publishers.json")) ([string]$manifest.publisher)
    Add-Check "Managed Codex starts without PATH" ($LASTEXITCODE -eq 0 -and $version -match [regex]::Escape([string]$manifest.version)) $version

    $initialize = '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"OpenDrSai Sandbox Acceptance","version":"1.0.0"}}}' + "`n"
    $initializePath = Join-Path $env:TEMP "opendrsai-codex-initialize.jsonl"
    [IO.File]::WriteAllText($initializePath, $initialize, [Text.UTF8Encoding]::new($false))
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $env:ComSpec
    # `type` preserves the exact bytes; ping keeps stdin open long enough for
    # the server to answer instead of treating immediate EOF as shutdown.
    $startInfo.Arguments = '/d /s /c "(type ' + $initializePath + ' & ping.exe -n 120 127.0.0.1 >nul) | ' + $codexExe + ' app-server --listen stdio://"'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $appServer = [Diagnostics.Process]::new(); $appServer.StartInfo = $startInfo
    if (-not $appServer.Start()) { throw "Managed Codex App Server did not start." }
    try {
        $stderrRead = $appServer.StandardError.ReadToEndAsync()
        $read = $appServer.StandardOutput.ReadLineAsync()
        # A freshly extracted 300+ MB executable can spend well over 30 seconds
        # in first-run Defender scanning inside Windows Sandbox.
        if (-not $read.Wait(45000)) {
            if (-not $appServer.HasExited) { $appServer.Kill(); $appServer.WaitForExit(10000) | Out-Null }
            $stderrRead.Wait(5000) | Out-Null
            $stderr = if ($stderrRead.IsCompleted) { $stderrRead.Result } else { "<stderr still open>" }
            throw "Managed Codex App Server initialize timed out (exit=$($appServer.ExitCode), stderr=$stderr)."
        }
        if ($null -eq $read.Result) {
            $stderrRead.Wait(5000) | Out-Null
            $stderr = if ($stderrRead.IsCompleted) { $stderrRead.Result } else { "<stderr still open>" }
            throw "Managed Codex App Server closed stdout before initialize response (exit=$(if($appServer.HasExited){$appServer.ExitCode}else{'running'}), stderr=$stderr)."
        }
        $response = $read.Result | ConvertFrom-Json
        Add-Check "Managed Codex App Server initialize" ($response.id -eq 1 -and $null -ne $response.result) ($read.Result)
    } finally {
        if (-not $appServer.HasExited) {
            & taskkill.exe /PID $appServer.Id /T /F | Out-Null
            $appServer.WaitForExit(10000) | Out-Null
        }
        $appServer.Dispose()
        Remove-Item -LiteralPath $initializePath -Force -ErrorAction SilentlyContinue
    }
} catch {
    Add-Check "Sandbox execution" $false $_.Exception.Message
} finally {
    $failed = @($checks | Where-Object status -eq "FAIL")
    $evidence = [ordered]@{
        schemaVersion = 1; generatedAt = [DateTime]::UtcNow.ToString("o")
        temporaryAcceptanceCredential = $true; passed = ($failed.Count -eq 0); checks = $checks
    }
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    if ($ShutdownOnComplete) { Start-Process shutdown.exe -ArgumentList @('/s','/t','0') -WindowStyle Hidden }
    if ($failed.Count -gt 0) { exit 1 }
}
