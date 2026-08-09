param(
    [Parameter(Mandatory = $true)][string]$PythonPath,
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][string]$WatchPath,
    [Parameter(Mandatory = $true)][int]$Port
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

function Start-GatewayChild {
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
