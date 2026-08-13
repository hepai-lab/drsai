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
    # The watcher may outlive the shell that launched Desktop. Reassert the
    # source tree for every child instead of relying on an inherited
    # PYTHONPATH, otherwise a restart can silently fall back to the installed
    # backend and ignore current development changes.
    $sourceRoot = Join-Path $RepoRoot "cores\python\packages\drsai\src"
    $env:PYTHONPATH = if ($env:PYTHONPATH) {
        "$sourceRoot$([IO.Path]::PathSeparator)$env:PYTHONPATH"
    } else {
        $sourceRoot
    }
    if ($EnableRegressionControl) {
        $env:OPENDRSAI_ENABLE_REGRESSION_CONTROL = "1"
    } else {
        Remove-Item Env:OPENDRSAI_ENABLE_REGRESSION_CONTROL -ErrorAction SilentlyContinue
    }
    # Start-Process materializes the inherited Windows environment as a
    # case-insensitive dictionary. Some developer shells can contain both
    # WS_PROXY/ws_proxy (and similar pairs), which makes that conversion fail
    # before Python starts. Build one canonical child environment explicitly.
    $childEnvironment = @{}
    Get-ChildItem Env: | ForEach-Object {
        $canonicalName = $_.Name.ToUpperInvariant()
        if (-not $childEnvironment.ContainsKey($canonicalName) -or $_.Name -ceq $canonicalName) {
            $childEnvironment[$canonicalName] = [string]$_.Value
        }
    }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $PythonPath
    $startInfo.Arguments = "-m uvicorn drsai.backend.gateway:app --host 127.0.0.1 --port $Port"
    $startInfo.WorkingDirectory = $RepoRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables.Clear()
    foreach ($entry in $childEnvironment.GetEnumerator()) {
        $startInfo.EnvironmentVariables[$entry.Key] = $entry.Value
    }
    $script:child = [System.Diagnostics.Process]::Start($startInfo)
    if (-not $script:child) {
        throw "Gateway child process could not be started."
    }
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
