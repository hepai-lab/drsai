param(
    [string]$DrsaiHome,
    [switch]$InstallPrerequisites,
    [switch]$InstallOnly,
    [switch]$ForceInstall,
    [switch]$SkipNpmInstall,
    [switch]$NoDevServer,
    [switch]$NoGateway
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$DesktopDir = Join-Path $RepoRoot "apps\desktop\windows"
$Installer = Join-Path $RepoRoot "scripts\install.ps1"
$GatewayPort = 8642

function Add-PathIfExists {
    param([string]$Path)
    if ($Path -and (Test-Path $Path) -and -not (($env:PATH -split [IO.Path]::PathSeparator) -contains $Path)) {
        $env:PATH = "$Path$([IO.Path]::PathSeparator)$env:PATH"
    }
}

function Resolve-NpmCommand {
    Add-PathIfExists (Join-Path $env:USERPROFILE ".conda\envs\drsai")
    Add-PathIfExists (Join-Path $env:ProgramFiles "nodejs")
    Add-PathIfExists (Join-Path ${env:ProgramFiles(x86)} "nodejs")

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $npm) {
        throw "npm was not found on PATH. Install Node.js, or activate/add your Node environment before running this script. On this machine, try: `$env:PATH = `"C:\Users\HUAWEI\.conda\envs\drsai;`$env:PATH`""
    }
    return $npm.Source
}

function Get-InstallTarget {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $item = Get-Item $Path -Force
    if ($item.Target) { return [string]$item.Target }
    return (Resolve-Path $Path).Path
}

function Test-DeveloperBackendReady {
    param(
        [string]$InstallPath,
        [string]$ExpectedRepo
    )

    $target = Get-InstallTarget $InstallPath
    if (-not $target -or $target.TrimEnd("\") -ine $ExpectedRepo.TrimEnd("\")) {
        return $false
    }

    $venvPython = Join-Path $InstallPath "venv\Scripts\python.exe"
    $cliWrapper = Join-Path $InstallPath "venv\Scripts\drsai.cmd"
    if (-not (Test-Path $venvPython) -or -not (Test-Path $cliWrapper)) {
        return $false
    }

    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $venvPython -c "import drsai" *> $null
        if ($LASTEXITCODE -ne 0) { return $false }

        & $venvPython -W ignore -m drsai.backend.run_cli version *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
}

function Get-LastProgressLine {
    param([string[]]$Paths)

    for ($i = $Paths.Count - 1; $i -ge 0; $i--) {
        $path = $Paths[$i]
        if (-not (Test-Path $path)) { continue }
        $lines = Get-Content -LiteralPath $path -Tail 30 -ErrorAction SilentlyContinue
        for ($j = $lines.Count - 1; $j -ge 0; $j--) {
            $line = ([string]$lines[$j]).Trim()
            if (-not $line) { continue }
            if ($line -match "^\[[0-9]+/[0-9]+\]") {
                $line = ($line -replace "^\[[0-9]+/[0-9]+\]\s*", "").Trim()
            }
            if ($line) { return $line }
        }
    }
    return "working..."
}

function Get-ProgressStepLines {
    param([string[]]$Paths)

    $steps = New-Object System.Collections.Generic.List[string]
    for ($i = $Paths.Count - 1; $i -ge 0; $i--) {
        $path = $Paths[$i]
        if (-not (Test-Path $path)) { continue }
        $lines = Get-Content -LiteralPath $path -Tail 240 -ErrorAction SilentlyContinue
        foreach ($rawLine in $lines) {
            $line = ([string]$rawLine).Trim()
            if ($line -match "^\[[0-9]+/[0-9]+\]\s+.+") {
                $steps.Add($line)
            }
        }
    }
    return $steps
}

function Write-ProgressLine {
    param(
        [string]$Prefix,
        [string]$Message,
        [int]$Frame
    )

    $spinner = @("|", "/", "-", "\")
    $width = 100
    try {
        $width = [Math]::Max(60, [Console]::WindowWidth - 1)
    } catch {
        $width = 100
    }
    $line = "    $($spinner[$Frame % $spinner.Count]) $Prefix $Message"
    if ($line.Length -gt $width) {
        $line = $line.Substring(0, $width - 3) + "..."
    }
    [Console]::Write("`r$($line.PadRight($width))")
}

function Invoke-StepProcess {
    param(
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$Prefix,
        [string]$LogName,
        [string]$LogDir,
        [switch]$ShowNestedSteps
    )

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdout = Join-Path $LogDir "$LogName-$stamp.out.log"
    $stderr = Join-Path $LogDir "$LogName-$stamp.err.log"

    $proc = Start-Process `
        -FilePath $FilePath `
        -ArgumentList $ArgumentList `
        -NoNewWindow `
        -PassThru `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr

    $frame = 0
    $shownStepLines = @{}
    while (-not $proc.HasExited) {
        if ($ShowNestedSteps) {
            $stepLines = Get-ProgressStepLines -Paths @($stdout, $stderr)
            foreach ($stepLine in $stepLines) {
                if (-not $shownStepLines.ContainsKey($stepLine)) {
                    [Console]::Write("`r$((' ' * 120))`r")
                    Write-Host "    - $stepLine" -ForegroundColor DarkCyan
                    $shownStepLines[$stepLine] = $true
                }
            }
        }
        $message = Get-LastProgressLine -Paths @($stderr, $stdout)
        Write-ProgressLine -Prefix $Prefix -Message $message -Frame $frame
        $frame += 1
        Start-Sleep -Milliseconds 350
        $proc.Refresh()
    }
    $proc.WaitForExit()
    $proc.Refresh()
    if ($ShowNestedSteps) {
        $stepLines = Get-ProgressStepLines -Paths @($stdout, $stderr)
        foreach ($stepLine in $stepLines) {
            if (-not $shownStepLines.ContainsKey($stepLine)) {
                [Console]::Write("`r$((' ' * 120))`r")
                Write-Host "    - $stepLine" -ForegroundColor DarkCyan
                $shownStepLines[$stepLine] = $true
            }
        }
    }

    [Console]::Write("`r$((' ' * 120))`r")
    $exitCode = $proc.ExitCode
    if ($null -eq $exitCode) {
        $successText = $false
        if (Test-Path $stdout) {
            $successText = Select-String -LiteralPath $stdout -Pattern "installation complete|Developer install complete|Successfully installed" -Quiet
        }
        if ($successText) {
            $exitCode = 0
        }
    }
    if ($exitCode -eq 0) {
        Write-Host "    OK $Prefix complete." -ForegroundColor Green
        return
    }

    Write-Host "    ERROR $Prefix failed with exit code $exitCode." -ForegroundColor Red
    Write-Host "    Logs:" -ForegroundColor Yellow
    Write-Host "      $stdout"
    Write-Host "      $stderr"
    Write-Host ""
    Write-Host "    Last output:" -ForegroundColor Yellow
    foreach ($path in @($stderr, $stdout)) {
        if (Test-Path $path) {
            Get-Content -LiteralPath $path -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "      $_"
            }
        }
    }
    throw "$Prefix failed with exit code $exitCode."
}

function Test-GatewayReady {
    param([int]$Port)

    try {
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2 -UseBasicParsing
        if ($health.StatusCode -ne 200) { return $false }
        $models = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/v1/models" -TimeoutSec 2 -UseBasicParsing
        return $models.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)

    if (-not $Process -or $Process.HasExited) { return }
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        & taskkill.exe /PID $Process.Id /T /F *> $null
        return
    }
    $Process.Kill()
}

function Start-HotReloadGateway {
    param(
        [string]$PythonPath,
        [string]$RepoRoot,
        [string]$DrsaiHome,
        [string]$LogDir,
        [int]$Port
    )

    Write-Host "[2/3] Gateway hot reload" -ForegroundColor Yellow
    if (Test-GatewayReady -Port $Port) {
        Write-Host "    OK Gateway already ready at http://127.0.0.1:$Port." -ForegroundColor Green
        return $null
    }

    if (-not (Test-Path $PythonPath)) {
        throw "Cannot start Gateway because Python was not found: $PythonPath"
    }

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $stdout = Join-Path $LogDir "gateway-hot-reload-$stamp.out.log"
    $stderr = Join-Path $LogDir "gateway-hot-reload-$stamp.err.log"
    $drsaiSrc = Join-Path $RepoRoot "cores\python\packages\drsai\src"
    $reloadDir = Join-Path $drsaiSrc "drsai"

    Add-PathIfExists (Split-Path -Parent $PythonPath)
    $env:DRSAI_HOME = $DrsaiHome
    $env:DRSAI_GATEWAY_DEV_MANAGED = "1"
    $env:DRSAI_GATEWAY_HOT_RELOAD = "1"
    $env:PYTHONPATH = if ($env:PYTHONPATH) { "$drsaiSrc$([IO.Path]::PathSeparator)$env:PYTHONPATH" } else { $drsaiSrc }

    $args = @(
        "-m", "uvicorn",
        "drsai.backend.gateway:app",
        "--host", "127.0.0.1",
        "--port", [string]$Port,
        "--reload",
        "--reload-dir", $reloadDir
    )

    $proc = Start-Process `
        -FilePath $PythonPath `
        -ArgumentList $args `
        -WorkingDirectory $RepoRoot `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr

    $frame = 0
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) {
            break
        }
        if (Test-GatewayReady -Port $Port) {
            [Console]::Write("`r$((' ' * 120))`r")
            Write-Host "    OK Gateway ready at http://127.0.0.1:$Port (uvicorn --reload)." -ForegroundColor Green
            Write-Host "    Logs: $stdout" -ForegroundColor DarkGray
            return $proc
        }
        $message = Get-LastProgressLine -Paths @($stderr, $stdout)
        Write-ProgressLine -Prefix "Starting Gateway hot reload" -Message $message -Frame $frame
        $frame += 1
        Start-Sleep -Milliseconds 500
        $proc.Refresh()
    }

    [Console]::Write("`r$((' ' * 120))`r")
    Write-Host "    ERROR Gateway did not become ready." -ForegroundColor Red
    Write-Host "    Logs:" -ForegroundColor Yellow
    Write-Host "      $stdout"
    Write-Host "      $stderr"
    Write-Host ""
    Write-Host "    Last output:" -ForegroundColor Yellow
    foreach ($path in @($stderr, $stdout)) {
        if (Test-Path $path) {
            Get-Content -LiteralPath $path -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Host "      $_"
            }
        }
    }
    Stop-ProcessTree -Process $proc
    throw "Gateway hot reload failed to start."
}

if (-not $DrsaiHome) {
    $DrsaiHome = if ($env:DRSAI_HOME) { $env:DRSAI_HOME } else { Join-Path $env:USERPROFILE ".drsai" }
}

$DevLogDir = Join-Path $DrsaiHome "logs\desktop-dev"

if (-not (Test-Path $Installer)) {
    throw "Cannot find installer script: $Installer"
}

if (-not (Test-Path $DesktopDir)) {
    throw "Cannot find Windows desktop directory: $DesktopDir"
}

$InstallDir = Join-Path $DrsaiHome "drsai-agent"
if (Test-Path $InstallDir) {
    $existingRepo = Get-InstallTarget $InstallDir
    if ($existingRepo.TrimEnd("\") -ine $RepoRoot.TrimEnd("\")) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupDir = Join-Path $DrsaiHome "drsai-agent.backup-$stamp"
        Write-Host "Existing developer backend is not linked to this checkout." -ForegroundColor Yellow
        Write-Host "  Existing: $existingRepo" -ForegroundColor Yellow
        Write-Host "  Expected: $RepoRoot" -ForegroundColor Yellow
        Write-Host "  Moving existing backend to: $backupDir" -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path $DrsaiHome | Out-Null
        Move-Item -LiteralPath $InstallDir -Destination $backupDir
    }
}

Write-Host ""
Write-Host "OpenDrSai Windows desktop developer bootstrap" -ForegroundColor Cyan
Write-Host "  Repository:  $RepoRoot" -ForegroundColor Green
Write-Host "  DrSai home:  $DrsaiHome" -ForegroundColor Green
Write-Host "  Desktop app: $DesktopDir" -ForegroundColor Green
Write-Host ""

$installArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $Installer,
    "-DevSource", $RepoRoot,
    "-DrsaiHome", $DrsaiHome,
    "-SkipSetup"
)

if ($InstallPrerequisites) {
    $installArgs += "-InstallPrerequisites"
}

$backendReady = if ($ForceInstall) { $false } else { Test-DeveloperBackendReady -InstallPath $InstallDir -ExpectedRepo $RepoRoot }
if ($backendReady -and -not $ForceInstall) {
    Write-Host "[1/3] Backend install" -ForegroundColor Yellow
    Write-Host "    OK Developer backend already ready." -ForegroundColor Green
} else {
    Write-Host "[1/3] Backend install" -ForegroundColor Yellow
    $env:DRSAI_SKIP_TUI_BUILD = "1"
    Invoke-StepProcess `
        -FilePath "powershell" `
        -ArgumentList (@("-NoProfile") + $installArgs) `
        -Prefix "Installing linked developer backend" `
        -LogName "backend-install" `
        -LogDir $DevLogDir `
        -ShowNestedSteps
}

if ($InstallOnly) {
    Write-Host ""
    Write-Host "Developer install complete." -ForegroundColor Green
    Write-Host "Run the desktop app with:" -ForegroundColor Yellow
    Write-Host "  cd $DesktopDir"
    Write-Host "  npm run dev"
    exit 0
}

$GatewayProcess = $null
if ($NoDevServer -or $NoGateway) {
    Write-Host "[2/3] Gateway hot reload" -ForegroundColor Yellow
    Write-Host "    SKIP Gateway hot reload." -ForegroundColor Yellow
} else {
    $GatewayPython = Join-Path $InstallDir "venv\Scripts\python.exe"
    $GatewayProcess = Start-HotReloadGateway `
        -PythonPath $GatewayPython `
        -RepoRoot $RepoRoot `
        -DrsaiHome $DrsaiHome `
        -LogDir $DevLogDir `
        -Port $GatewayPort
}

Push-Location $DesktopDir
try {
    $npm = $null
    Write-Host "[3/3] Desktop app hot reload" -ForegroundColor Yellow
    if (-not $SkipNpmInstall) {
        $npm = Resolve-NpmCommand
        if (Test-Path "node_modules") {
            Write-Host "    OK npm dependencies already installed." -ForegroundColor Green
        } else {
            Invoke-StepProcess `
                -FilePath $npm `
                -ArgumentList @("install") `
                -Prefix "Installing npm dependencies" `
                -LogName "npm-install" `
                -LogDir $DevLogDir
        }
    } else {
        Write-Host "    SKIP npm install." -ForegroundColor Yellow
    }

    if ($NoDevServer) {
        Write-Host "    SKIP Electron dev server." -ForegroundColor Yellow
        Write-Host "Developer install is ready." -ForegroundColor Green
        exit 0
    }

    Write-Host "    Starting Electron dev server..." -ForegroundColor Green
    $env:DRSAI_HOME = $DrsaiHome
    $env:DRSAI_GATEWAY_DEV_MANAGED = "1"
    $env:DRSAI_GATEWAY_HOT_RELOAD = "1"
    if (-not $npm) {
        $npm = Resolve-NpmCommand
    }
    & $npm run dev
    exit $LASTEXITCODE
} finally {
    Pop-Location
    if ($GatewayProcess) {
        Write-Host "Stopping Gateway hot reload..." -ForegroundColor Yellow
        Stop-ProcessTree -Process $GatewayProcess
    }
}
