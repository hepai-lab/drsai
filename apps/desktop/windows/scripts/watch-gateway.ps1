param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$WatchPath,
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$InstanceTokenPath,
    [switch]$EnableRegressionControl
)

$ErrorActionPreference = "Stop"
$child = $null

function Get-SourceFingerprint {
    $files = Get-ChildItem -LiteralPath $WatchPath -Recurse -File -Filter "*.py" -ErrorAction SilentlyContinue
    $latest = ($files | Measure-Object -Property LastWriteTimeUtc -Maximum).Maximum
    return "$($files.Count):$($latest.Ticks)"
}

function Stop-GatewayChild {
    if (-not $script:child -or $script:child.HasExited) { return }
    & taskkill.exe /PID $script:child.Id /T /F *> $null
    $script:child.WaitForExit()
}

function Set-GatewayChildToken {
    if (-not (Test-Path -LiteralPath $InstanceTokenPath -PathType Leaf)) {
        throw "Gateway instance token file is unavailable."
    }
    $item = Get-Item -LiteralPath $InstanceTokenPath -Force
    if ($item.LinkType) {
        throw "Gateway instance token file must not be a link."
    }
    if ($item.Length -gt 256) {
        throw "Gateway instance token file is invalid."
    }
    $token = (Get-Content -LiteralPath $InstanceTokenPath -Raw -Encoding ascii).Trim()
    if ($token -notmatch '^[A-Za-z0-9_-]{32,128}$') {
        throw "Gateway instance token file is invalid."
    }
    # The token value never appears in the watcher command line or logs.  It
    # is injected into each child so source-reload restarts preserve the same
    # loopback authorization boundary as the packaged Desktop launcher.
    $env:OPENDRSAI_GATEWAY_INSTANCE_TOKEN = $token
}

function Start-GatewayChild {
    Set-GatewayChildToken
    if ($EnableRegressionControl) {
        $env:OPENDRSAI_ENABLE_REGRESSION_CONTROL = "1"
    } else {
        Remove-Item Env:OPENDRSAI_ENABLE_REGRESSION_CONTROL -ErrorAction SilentlyContinue
    }
    $script:child = Start-Process `
        -FilePath $PythonPath `
        -ArgumentList @(
            "-m", "uvicorn", "drsai.backend.gateway:app",
            "--host", "127.0.0.1", "--port", [string]$Port
        ) `
        -WorkingDirectory $RepoRoot `
        -PassThru `
        -NoNewWindow
}

try {
    $fingerprint = Get-SourceFingerprint
    Start-GatewayChild
    while ($true) {
        Start-Sleep -Milliseconds 750
        $nextFingerprint = Get-SourceFingerprint
        if ($nextFingerprint -ne $fingerprint) {
            $fingerprint = $nextFingerprint
            Write-Host "Gateway Python source changed; restarting..."
            Stop-GatewayChild
            Start-GatewayChild
            continue
        }
        if ($child.HasExited) {
            Write-Host "Gateway exited with code $($child.ExitCode); restarting..."
            Start-Sleep -Milliseconds 500
            Start-GatewayChild
        }
    }
} finally {
    Stop-GatewayChild
}
