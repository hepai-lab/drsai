param(
    [string]$InstallRoot = (Join-Path $env:ProgramFiles "OpenDrSai"),
    [string]$DrsaiHome = (Join-Path $env:USERPROFILE ".drsai"),
    [switch]$RemoveUserData
)

$ErrorActionPreference = "Stop"
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$machineInstallerData = Join-Path $env:ProgramData "OpenDrSai\Installer"
$logDir = Join-Path $machineInstallerData "logs"
$logFile = Join-Path $logDir ("uninstall-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-Log([string]$Message) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Add-Content -LiteralPath $logFile -Value "[$((Get-Date).ToString("s"))] $Message"
}

function Stop-InstalledProcessTrees {
    $normalizedRoot = $InstallRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ProcessId -ne $PID -and
            $_.ExecutablePath -and
            $_.ExecutablePath.StartsWith($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)
        } |
        Sort-Object ProcessId -Descending

    foreach ($process in $processes) {
        Write-Log "Stopping installed process tree: $($process.Name) (PID $($process.ProcessId))"
        & taskkill.exe /PID $process.ProcessId /T /F 2>&1 | ForEach-Object {
            Write-Log "taskkill: $_"
        }
    }

    $deadline = (Get-Date).AddSeconds(15)
    do {
        $remaining = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.ProcessId -ne $PID -and
                $_.ExecutablePath -and
                $_.ExecutablePath.StartsWith($normalizedRoot, [StringComparison]::OrdinalIgnoreCase)
            }
        if (-not $remaining) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    $description = ($remaining | ForEach-Object { "$($_.Name) (PID $($_.ProcessId))" }) -join ", "
    throw "Installed OpenDrSai processes did not exit: $description"
}

function Remove-Safely([string]$Path, [int]$MaxAttempts = 6) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $lastError = $null
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            Write-Log "Removed $Path"
            return
        } catch {
            $lastError = $_
            Write-Log "Could not remove $Path (attempt $attempt of $MaxAttempts): $($_.Exception.Message)"
            if ($attempt -lt $MaxAttempts) {
                Start-Sleep -Milliseconds (250 * $attempt)
            }
        }
    }
    throw "Could not remove $Path after $MaxAttempts attempts: $($lastError.Exception.Message)"
}

try {
    Write-Log "OpenDrSai uninstall started. Install root: $InstallRoot"
    Stop-InstalledProcessTrees

    foreach ($relativePath in @(
        "app",
        "app.previous",
        "drsai-agent",
        "drsai-agent.previous",
        "defaults",
        "cache",
        "install-state.json"
    )) {
        Remove-Safely (Join-Path $InstallRoot $relativePath)
    }

    if ($RemoveUserData) {
        Remove-Safely $DrsaiHome
    }

    Write-Log "OpenDrSai runtime uninstall completed."
    Remove-Item -LiteralPath $machineInstallerData -Recurse -Force -ErrorAction SilentlyContinue
    exit 0
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
