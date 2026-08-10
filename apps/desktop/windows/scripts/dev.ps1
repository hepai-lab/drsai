param(
    [string]$DrsaiHome,
    [ValidateRange(1, 65535)]
    [int]$GatewayPort = 28642,
    [switch]$InstallPrerequisites,
    [switch]$InstallOnly,
    [switch]$ForceInstall,
    [switch]$SkipNpmInstall,
    [switch]$NoDevServer,
    [switch]$NoGateway,
    [switch]$WithGateway,
    [string]$PipIndexUrl = "https://pypi.tuna.tsinghua.edu.cn/simple",
    [switch]$ShowLibPngWarnings
)

$ErrorActionPreference = "Stop"
$StartupStopwatch = [Diagnostics.Stopwatch]::StartNew()
$env:OPENDRSAI_DEV_START_EPOCH_MS = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..\..\..")).Path
$DesktopWorkspaceDir = Join-Path $RepoRoot "apps\desktop"
$DesktopDir = Join-Path $RepoRoot "apps\desktop\windows"
$Installer = Join-Path $RepoRoot "scripts\install.ps1"

function Add-PathIfExists {
    param([string]$Path)
    if ($Path -and (Test-Path $Path) -and -not (($env:PATH -split [IO.Path]::PathSeparator) -contains $Path)) {
        $env:PATH = "$Path$([IO.Path]::PathSeparator)$env:PATH"
    }
}

function Install-WithWinget {
    param(
        [string]$Id,
        [string]$Name
    )

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "$Name is required but was not found, and winget is not available to install it automatically."
    }

    Write-Host "    Installing $Name with winget..." -ForegroundColor Yellow
    & $winget.Source install --exact --id $Id --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "winget failed to install $Name (exit code $LASTEXITCODE). Install it manually and run this script again."
    }

    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machinePath, $userPath, $env:Path) -join [IO.Path]::PathSeparator
}

function Resolve-NpmCommand {
    Add-PathIfExists (Join-Path $env:USERPROFILE ".conda\envs\drsai")
    Add-PathIfExists (Join-Path $env:ProgramFiles "nodejs")
    Add-PathIfExists (Join-Path ${env:ProgramFiles(x86)} "nodejs")

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        $npm = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $npm -and $InstallPrerequisites) {
        Install-WithWinget -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
        Add-PathIfExists (Join-Path $env:ProgramFiles "nodejs")
        Add-PathIfExists (Join-Path ${env:ProgramFiles(x86)} "nodejs")
        $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npm) {
            $npm = Get-Command npm -ErrorAction SilentlyContinue
        }
    }
    if (-not $npm) {
        throw "npm was not found on PATH. Install Node.js 22 LTS, or run this script with -InstallPrerequisites."
    }
    return $npm.Source
}

function Test-NodeVersionAtLeast {
    param(
        [int]$Major,
        [int]$Minor,
        [int]$Patch
    )

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) {
        $node = Get-Command node -ErrorAction SilentlyContinue
    }
    if (-not $node) {
        throw "node was not found on PATH. Install Node.js 22 LTS, or activate/add your Node environment before running this script."
    }

    $versionText = (& $node.Source -v 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $versionText) {
        throw "Failed to run node from $($node.Source). Install Node.js 22 LTS and try again."
    }

    $version = ([string]$versionText).Trim().TrimStart("v")
    $parts = $version.Split(".")
    if ($parts.Count -lt 3) {
        throw "Unable to parse Node.js version '$versionText'. Install Node.js 22 LTS and try again."
    }

    $current = @([int]$parts[0], [int]$parts[1], [int]$parts[2])
    $required = @($Major, $Minor, $Patch)
    for ($i = 0; $i -lt 3; $i++) {
        if ($current[$i] -gt $required[$i]) { return $true }
        if ($current[$i] -lt $required[$i]) { return $false }
    }
    return $true
}

function Assert-DesktopNodeVersion {
    $supportsVite7 = $false
    try {
        $supportsVite7 = (Test-NodeVersionAtLeast -Major 20 -Minor 19 -Patch 0)
    } catch {
        if (-not $InstallPrerequisites) {
            throw
        }
    }
    if ($supportsVite7) {
        return
    }

    $version = ""
    try {
        $version = (& node -v 2>$null)
    } catch {
        $version = "not found"
    }
    if ($InstallPrerequisites) {
        Write-Host "    Node.js $version is too old; installing Node.js LTS..." -ForegroundColor Yellow
        Install-WithWinget -Id "OpenJS.NodeJS.LTS" -Name "Node.js LTS"
        if (Test-NodeVersionAtLeast -Major 20 -Minor 19 -Patch 0) {
            return
        }
        $version = (& node -v 2>$null)
    }

    throw "Node.js $version is too old for the Windows desktop dev server. This project requires Node.js >= 20.19.0 (Node 22 LTS recommended). Upgrade Node, then remove apps\desktop\node_modules and run npm run dev:bootstrap again."
}

function Get-TailwindOxideVersion {
    $oxidePackageJson = "node_modules\@tailwindcss\oxide\package.json"
    if (Test-Path $oxidePackageJson) {
        try {
            $pkg = Get-Content -LiteralPath $oxidePackageJson -Raw | ConvertFrom-Json
            if ($pkg.version) {
                return [string]$pkg.version
            }
        } catch {
        }
    }
    return "4.2.2"
}

function Repair-TailwindNativeBinding {
    param([string]$NpmCommand)

    if (-not (Test-Path "node_modules\@tailwindcss\oxide")) {
        return
    }

    $isWindowsX64 = $env:OS -eq "Windows_NT" -and $env:PROCESSOR_ARCHITECTURE -match "^(AMD64|x64)$"
    if (-not $isWindowsX64) {
        return
    }

    $binding = "node_modules\@tailwindcss\oxide-win32-x64-msvc\tailwindcss-oxide.win32-x64-msvc.node"
    if (Test-Path $binding) {
        return
    }

    Write-Host "    Repairing missing Tailwind native binding..." -ForegroundColor Yellow
    $oxideVersion = Get-TailwindOxideVersion
    Invoke-StepProcess `
        -FilePath $NpmCommand `
        -ArgumentList @("install", "--no-save", "@tailwindcss/oxide-win32-x64-msvc@$oxideVersion") `
        -Prefix "Installing Tailwind native binding" `
        -LogName "npm-tailwind-oxide-install" `
        -LogDir $DevLogDir
}

function Repair-ElectronBinary {
    param([string]$NpmCommand)

    if (-not (Test-Path "node_modules\electron")) {
        return
    }

    $electronExe = "node_modules\electron\dist\electron.exe"
    $electronPathFile = "node_modules\electron\path.txt"
    if ((Test-Path $electronExe) -and (Test-Path $electronPathFile)) {
        return
    }

    Write-Host "    Repairing missing Electron binary..." -ForegroundColor Yellow
    $oldMirror = $env:ELECTRON_MIRROR
    if (-not $env:ELECTRON_MIRROR) {
        $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
    }
    try {
        Invoke-StepProcess `
            -FilePath $NpmCommand `
            -ArgumentList @("rebuild", "electron") `
            -Prefix "Installing Electron binary" `
            -LogName "npm-electron-rebuild" `
            -LogDir $DevLogDir
    } finally {
        $env:ELECTRON_MIRROR = $oldMirror
    }
}

function Get-InstallTarget {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $item = Get-Item $Path -Force
    $sourceMarker = Join-Path $Path ".dev-source"
    if (Test-Path -LiteralPath $sourceMarker) {
        $source = (Get-Content -LiteralPath $sourceMarker -Raw).Trim()
        if (-not $source) { return $null }
        if (Test-Path -LiteralPath $source) { return (Resolve-Path -LiteralPath $source).Path }
        return $source
    }
    if ($item.Target) { return [string]$item.Target }
    return $null
}

function Remove-LegacyProductionDeveloperInstall {
    param(
        [string]$DeveloperHome,
        [string]$RepositoryRoot
    )

    $productionHome = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".drsai"))
    if ($productionHome.TrimEnd("\") -ieq $DeveloperHome.TrimEnd("\")) { return }
    $legacyInstall = Join-Path $productionHome "drsai-agent"
    if (-not (Test-Path -LiteralPath $legacyInstall)) { return }
    $legacyTarget = Get-InstallTarget $legacyInstall
    if (-not $legacyTarget -or $legacyTarget.TrimEnd("\") -ine $RepositoryRoot.TrimEnd("\")) { return }

    $item = Get-Item -LiteralPath $legacyInstall -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        [System.IO.Directory]::Delete($item.FullName)
        Write-Host "    Removed legacy production developer link: $legacyInstall" -ForegroundColor Yellow
        return
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backup = Join-Path $productionHome "drsai-agent.legacy-dev-backup-$stamp"
    Move-Item -LiteralPath $legacyInstall -Destination $backup
    Write-Host "    Detached legacy production developer install." -ForegroundColor Yellow
    Write-Host "      Previous: $legacyInstall" -ForegroundColor DarkGray
    Write-Host "      Backup:   $backup" -ForegroundColor DarkGray
}

function Remove-LegacySourceWorkspaceRegistration {
    param(
        [string]$DeveloperHome,
        [string]$RepositoryRoot
    )

    $migrationMarker = Join-Path $DeveloperHome "cache\desktop-dev\legacy-source-workspace-cleanup-v1"
    if (Test-Path -LiteralPath $migrationMarker) { return }
    $workspacesFile = Join-Path $DeveloperHome "desktop\workspaces.json"
    if (Test-Path -LiteralPath $workspacesFile) {
        try {
            $parsedRecords = [IO.File]::ReadAllText($workspacesFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
            $records = @()
            foreach ($record in $parsedRecords) { $records += $record }
            $filtered = @($records | Where-Object {
                $keep = $true
                if ($_.path) {
                    try {
                        $keep = [IO.Path]::GetFullPath([string]$_.path).TrimEnd("\") -ine $RepositoryRoot.TrimEnd("\")
                    } catch {
                        $keep = $true
                    }
                }
                $keep
            })
            if ($filtered.Count -ne $records.Count) {
                $temporary = "$workspacesFile.$PID.tmp"
                $serializedRecords = @($filtered | ForEach-Object { ConvertTo-Json -InputObject $_ -Depth 32 -Compress })
                $payload = if ($serializedRecords.Count -eq 0) {
                    "[]`n"
                } else {
                    "[`n" + ($serializedRecords -join ",`n") + "`n]`n"
                }
                [IO.File]::WriteAllText($temporary, $payload, (New-Object Text.UTF8Encoding($false)))
                Move-Item -LiteralPath $temporary -Destination $workspacesFile -Force
                Write-Host "    Removed the legacy source-repository default Workspace registration." -ForegroundColor Yellow
            }
        } catch {
            Write-Warning "Could not migrate legacy developer Workspace registrations: $($_.Exception.Message)"
            return
        }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $migrationMarker) | Out-Null
    [IO.File]::WriteAllText($migrationMarker, "complete`n", (New-Object Text.UTF8Encoding($false)))
}

function Test-DeveloperBackendReady {
    param(
        [string]$InstallPath,
        [string]$ExpectedRepo
    )

    if (-not (Test-Path -LiteralPath $InstallPath)) { return $false }
    $installItem = Get-Item -LiteralPath $InstallPath -Force
    if (($installItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        return $false
    }

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
        & $venvPython -c "import drsai, playwright; from drsai.backend.runtime.web_search import web_search_runtime_status; assert web_search_runtime_status()['status'] == 'available'" *> $null
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
            $successText = Select-String -LiteralPath $stdout -Pattern "installation complete|Developer install complete|Successfully installed|added \d+ packages|up to date, audited \d+ packages" -Quiet
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

function Get-GatewayInstanceToken {
    param([string]$DrsaiHome)

    $tokenPath = Join-Path $DrsaiHome "runtime\instance-token"
    if (Test-Path $tokenPath) {
        $existing = (Get-Content -LiteralPath $tokenPath -Raw -ErrorAction SilentlyContinue).Trim()
        if ($existing -match '^[A-Za-z0-9_-]{32,128}$') { return $existing }
    }
    $bytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $tokenPath) | Out-Null
    Set-Content -LiteralPath $tokenPath -Value $token -NoNewline -Encoding ascii
    return $token
}

function Get-GatewayHeaders {
    param([string]$Token)
    return @{ "X-OpenDrSai-Gateway-Token" = $Token }
}

function Test-GatewayReady {
    param([int]$Port, [string]$Token)

    try {
        $headers = Get-GatewayHeaders -Token $Token
        $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -Headers $headers -TimeoutSec 2 -UseBasicParsing
        if ($health.StatusCode -ne 200) { return $false }
        $models = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/v1/models" -Headers $headers -TimeoutSec 2 -UseBasicParsing
        return $models.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-DevManagedGateway {
    param([int]$Port, [string]$Token)

    try {
        $identity = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/runtime" -Headers (Get-GatewayHeaders -Token $Token) -TimeoutSec 2
        return $identity.dev_managed -eq $true
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

    $instanceToken = Get-GatewayInstanceToken -DrsaiHome $DrsaiHome
    $gatewayHeaders = Get-GatewayHeaders -Token $instanceToken
    Write-Host "[2/3] Gateway hot reload" -ForegroundColor Yellow
    if (Test-GatewayReady -Port $Port -Token $instanceToken) {
        if (Test-DevManagedGateway -Port $Port -Token $instanceToken) {
            # Windows intentionally runs uvicorn without --reload because its
            # reload worker cannot launch Codex app-server. Reusing the prior
            # process here would keep stale Adapter code after Desktop restarts.
            Write-Host "    Restarting the source Gateway to load current Python code..." -ForegroundColor Yellow
        } else {
            Write-Host "    Replacing non-development Gateway on port $Port with the source Gateway..." -ForegroundColor Yellow
        }
        try {
            Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/runtime/shutdown" -Headers $gatewayHeaders -Method Post -TimeoutSec 2 | Out-Null
        } catch {
            throw "Port $Port is occupied by a Gateway that cannot be stopped through /v1/runtime/shutdown. Stop it and retry."
        }
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline -and (Test-GatewayReady -Port $Port -Token $instanceToken)) {
            Start-Sleep -Milliseconds 200
        }
        if (Test-GatewayReady -Port $Port -Token $instanceToken) {
            throw "The non-development Gateway on port $Port did not stop."
        }
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
    $env:DRSAI_API_PORT = [string]$Port
    $env:OPENDRSAI_GATEWAY_PORT = [string]$Port
    $env:DRSAI_GATEWAY_DEV_MANAGED = "1"
    $env:DRSAI_GATEWAY_HOT_RELOAD = "1"
    $env:OPENDRSAI_GATEWAY_INSTANCE_TOKEN = $instanceToken
    $env:PYTHONPATH = if ($env:PYTHONPATH) { "$drsaiSrc$([IO.Path]::PathSeparator)$env:PYTHONPATH" } else { $drsaiSrc }

    $gatewayCommand = $PythonPath
    $gatewayArgs = @(
        "-m", "uvicorn",
        "drsai.backend.gateway:app",
        "--host", "127.0.0.1",
        "--port", [string]$Port
    )
    # uvicorn's Windows reload worker uses SelectorEventLoop, which cannot
    # launch the Codex app-server subprocess required by CodexAdapter.
    # Keep the Gateway worker on Windows' subprocess-capable event loop. An
    # outer watcher restarts that direct worker when Python changes instead of
    # using uvicorn's incompatible Windows reload worker.
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        $watcher = Join-Path $ScriptDir "watch-gateway.ps1"
        $gatewayCommand = (Get-Command powershell.exe).Source
        $gatewayArgs = @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$watcher`"",
            "-PythonPath", "`"$PythonPath`"", "-RepoRoot", "`"$RepoRoot`"",
            "-WatchPath", "`"$reloadDir`"", "-Port", [string]$Port
        )
    } else {
        $gatewayArgs += @("--reload", "--reload-dir", $reloadDir)
    }

    $proc = Start-Process `
        -FilePath $gatewayCommand `
        -ArgumentList $gatewayArgs `
        -WorkingDirectory $RepoRoot `
        -PassThru `
        -NoNewWindow `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr

    $frame = 0
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) {
            break
        }
        if (Test-GatewayReady -Port $Port -Token $instanceToken) {
            [Console]::Write("`r$((' ' * 120))`r")
            $gatewayMode = if ($IsWindows -or $env:OS -eq "Windows_NT") { "Windows source watcher" } else { "uvicorn --reload" }
            Write-Host "    OK Gateway ready at http://127.0.0.1:$Port ($gatewayMode)." -ForegroundColor Green
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
    # Development must never mutate or attach to the production profile at
    # %USERPROFILE%\.drsai unless the caller explicitly opts into that path.
    $DrsaiHome = Join-Path $env:USERPROFILE ".drsai-dev"
}
$DrsaiHome = [IO.Path]::GetFullPath($DrsaiHome)
$ElectronUserData = Join-Path $DrsaiHome "electron-user-data"

# Desktop development must exercise the same OIDC-only credential boundary as
# a clean packaged install. Static keys in the host environment or ~/.drsai/.env
# must not mask missing request-scoped OIDC propagation.
$env:OPENDRSAI_DESKTOP_DEV = "1"
$env:OPENDRSAI_OIDC_ONLY = "1"
$BuiltInSkillsDir = Join-Path $RepoRoot "skills\skills"
if (-not (Test-Path -LiteralPath $BuiltInSkillsDir -PathType Container)) {
    throw "Cannot find the built-in Skills directory: $BuiltInSkillsDir"
}
$env:SYSTEM_SKILLS_DIR = $BuiltInSkillsDir
Remove-Item Env:HEPAI_API_KEY, Env:OPENAI_API_KEY, Env:OPENAI_ADMIN_KEY -ErrorAction SilentlyContinue

# A fresh, isolated developer profile must not stall on an unreachable public
# PyPI mirror.  The caller can override this with -PipIndexUrl (or the
# OPENDRSAI_DEV_PIP_INDEX_URL environment variable) for an internal mirror.
$PipIndexUrl = if ($env:OPENDRSAI_DEV_PIP_INDEX_URL) { $env:OPENDRSAI_DEV_PIP_INDEX_URL } else { $PipIndexUrl }
if ($PipIndexUrl -notmatch '^https://[^\s/]+(?:/.*)?$') { throw "PipIndexUrl must be an HTTPS simple-index URL." }
$PipIndexUrl = $PipIndexUrl.TrimEnd('/')
$env:PIP_INDEX_URL = if ($PipIndexUrl.EndsWith('/simple')) { $PipIndexUrl } else { "$PipIndexUrl/simple" }
$env:PIP_DEFAULT_TIMEOUT = "60"

$DevLogDir = Join-Path $DrsaiHome "logs\desktop-dev"
$DevCacheDir = Join-Path $DrsaiHome "cache\desktop-dev"
$BackendValidationStamp = Join-Path $DevCacheDir "backend-validation.txt"
$FrontendValidationStamp = Join-Path $DevCacheDir "frontend-validation.txt"

Remove-LegacyProductionDeveloperInstall -DeveloperHome $DrsaiHome -RepositoryRoot $RepoRoot
Remove-LegacySourceWorkspaceRegistration -DeveloperHome $DrsaiHome -RepositoryRoot $RepoRoot

function Get-ValidationFingerprint {
    param([string[]]$Paths)
    return (($Paths | ForEach-Object {
        if (Test-Path $_) {
            $item = Get-Item -LiteralPath $_
            "$($item.FullName)|$($item.Length)|$($item.LastWriteTimeUtc.Ticks)"
        } else {
            "$_|missing"
        }
    }) -join "`n")
}

if (-not (Test-Path $Installer)) {
    throw "Cannot find installer script: $Installer"
}

if (-not (Test-Path $DesktopDir)) {
    throw "Cannot find Windows desktop directory: $DesktopDir"
}

$InstallDir = Join-Path $DrsaiHome "drsai-agent"
if (Test-Path $InstallDir) {
    $existingRepo = Get-InstallTarget $InstallDir
    if ($existingRepo -and $existingRepo.TrimEnd("\") -ine $RepoRoot.TrimEnd("\")) {
        $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupDir = Join-Path $DrsaiHome "drsai-agent.backup-$stamp"
        Write-Host "Existing developer backend belongs to another checkout." -ForegroundColor Yellow
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
Write-Host "  User data:   $ElectronUserData" -ForegroundColor Green
Write-Host "  Gateway:     http://127.0.0.1:$GatewayPort" -ForegroundColor Green
Write-Host "  Skills:      $BuiltInSkillsDir" -ForegroundColor Green
Write-Host "  Pip index:   $($env:PIP_INDEX_URL)" -ForegroundColor Green
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

$backendFingerprint = Get-ValidationFingerprint -Paths @(
    (Join-Path $RepoRoot "pyproject.toml"),
    (Join-Path $RepoRoot "uv.lock"),
    (Join-Path $RepoRoot "cores\python\packages\drsai\pyproject.toml")
)
$cachedBackendReady = (-not $ForceInstall) -and (Test-Path $BackendValidationStamp) -and
    ((Get-Content -LiteralPath $BackendValidationStamp -Raw -ErrorAction SilentlyContinue) -eq $backendFingerprint) -and
    (Test-DeveloperBackendReady -InstallPath $InstallDir -ExpectedRepo $RepoRoot)
$backendReady = if ($cachedBackendReady) { $true } elseif ($ForceInstall) { $false } else {
    Test-DeveloperBackendReady -InstallPath $InstallDir -ExpectedRepo $RepoRoot
}
if ($backendReady -and -not $cachedBackendReady) {
    New-Item -ItemType Directory -Force -Path $DevCacheDir | Out-Null
    Set-Content -LiteralPath $BackendValidationStamp -Value $backendFingerprint -NoNewline
}
if ($backendReady -and -not $ForceInstall) {
    Write-Host "[1/3] Backend install" -ForegroundColor Yellow
    Write-Host "    OK Developer backend already ready." -ForegroundColor Green
} else {
    Write-Host "[1/3] Backend install" -ForegroundColor Yellow
    $env:DRSAI_SKIP_TUI_BUILD = "1"
    Invoke-StepProcess `
        -FilePath "powershell" `
        -ArgumentList (@("-NoProfile") + $installArgs) `
        -Prefix "Installing independent developer backend" `
        -LogName "backend-install" `
        -LogDir $DevLogDir `
        -ShowNestedSteps
    New-Item -ItemType Directory -Force -Path $DevCacheDir | Out-Null
    Set-Content -LiteralPath $BackendValidationStamp -Value $backendFingerprint -NoNewline
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
$StartGateway = $WithGateway -and -not $NoGateway -and -not $NoDevServer
if (-not $StartGateway) {
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

Push-Location $DesktopWorkspaceDir
try {
    $npm = $null
    Write-Host "[3/3] Desktop app hot reload" -ForegroundColor Yellow
    if (-not $SkipNpmInstall) {
        $npm = Resolve-NpmCommand
        Assert-DesktopNodeVersion
        $workspaceDependenciesReady = (Test-Path "node_modules\react\jsx-dev-runtime.js") -and
            (Test-Path "node_modules\electron") -and
            (Test-Path "node_modules\vite") -and
            ((Test-Path "node_modules\@electron-toolkit\utils\package.json") -or
                (Test-Path (Join-Path $DesktopDir "node_modules\@electron-toolkit\utils\package.json"))) -and
            ((Test-Path "node_modules\@electron-toolkit\preload\package.json") -or
                (Test-Path (Join-Path $DesktopDir "node_modules\@electron-toolkit\preload\package.json")))
        if ($workspaceDependenciesReady) {
            Write-Host "    OK desktop workspace dependencies already installed." -ForegroundColor Green
        } else {
            Invoke-StepProcess `
                -FilePath $npm `
                -ArgumentList @("install") `
                -Prefix "Installing desktop workspace dependencies" `
                -LogName "npm-install" `
                -LogDir $DevLogDir
        }
        $frontendFingerprint = Get-ValidationFingerprint -Paths @(
            (Join-Path $DesktopWorkspaceDir "package.json"),
            (Join-Path $DesktopWorkspaceDir "package-lock.json"),
            (Join-Path $DesktopDir "package.json"),
            (Join-Path $DesktopWorkspaceDir "shared\renderer\package.json")
        )
        $frontendCacheReady = (Test-Path $FrontendValidationStamp) -and
            ((Get-Content -LiteralPath $FrontendValidationStamp -Raw -ErrorAction SilentlyContinue) -eq $frontendFingerprint) -and
            (Test-Path "node_modules\electron\dist\electron.exe") -and
            (Test-Path "node_modules\@tailwindcss\oxide-win32-x64-msvc\tailwindcss-oxide.win32-x64-msvc.node")
        if ($frontendCacheReady) {
            Write-Host "    OK frontend dependency validation cached." -ForegroundColor Green
        } else {
            Repair-TailwindNativeBinding -NpmCommand $npm
            Repair-ElectronBinary -NpmCommand $npm
            New-Item -ItemType Directory -Force -Path $DevCacheDir | Out-Null
            Set-Content -LiteralPath $FrontendValidationStamp -Value $frontendFingerprint -NoNewline
        }
    } else {
        Write-Host "    SKIP npm install." -ForegroundColor Yellow
        if (-not (Test-Path "node_modules\react\jsx-dev-runtime.js")) {
            throw "Desktop workspace dependencies are missing. Run without -SkipNpmInstall so apps\desktop\node_modules can be installed."
        }
    }

    if ($NoDevServer) {
        Write-Host "    SKIP Electron dev server." -ForegroundColor Yellow
        Write-Host "Developer install is ready." -ForegroundColor Green
        exit 0
    }

    Write-Host "    Starting Electron dev server with hot reload..." -ForegroundColor Green
    Write-Host "    Renderer: React/CSS hot module replacement; main/preload: automatic Electron restart." -ForegroundColor DarkGray
    Write-Host "    Startup preparation: $($StartupStopwatch.ElapsedMilliseconds) ms" -ForegroundColor DarkGray
    $env:DRSAI_HOME = $DrsaiHome
    $env:OPENDRSAI_DEV_HOME = $DrsaiHome
    $env:DRSAI_REPO = $RepoRoot
    $env:OPENDRSAI_RUNTIME_ROOT = $InstallDir
    $env:OPENDRSAI_ELECTRON_USER_DATA = $ElectronUserData
    $env:OPENDRSAI_GATEWAY_STARTUP = if ($StartGateway) { "eager" } else { "on-demand" }
    $env:OPENDRSAI_DEV_GATEWAY_PORT = [string]$GatewayPort
    $env:OPENDRSAI_VOICE_TTS_RUNTIME = "gateway-provider"
    if ($StartGateway) {
        $env:DRSAI_GATEWAY_DEV_MANAGED = "1"
        $env:DRSAI_GATEWAY_HOT_RELOAD = "1"
        $env:OPENDRSAI_GATEWAY_PORT = [string]$GatewayPort
    } else {
        Remove-Item Env:DRSAI_GATEWAY_DEV_MANAGED -ErrorAction SilentlyContinue
        Remove-Item Env:DRSAI_GATEWAY_HOT_RELOAD -ErrorAction SilentlyContinue
    }
    if (-not $npm) {
        $npm = Resolve-NpmCommand
    }
    Set-Location $DesktopDir
    $devOutputRunner = Join-Path $DesktopDir "scripts\run-dev-with-filter.mjs"
    $devOutputArgs = @($devOutputRunner)
    if ($ShowLibPngWarnings) {
        $devOutputArgs += "--show-libpng-warnings"
    }
    $devOutputArgs += $npm
    & node @devOutputArgs
    $devExitCode = $LASTEXITCODE
    exit $devExitCode
} finally {
    Pop-Location
    if ($GatewayProcess) {
        Write-Host "Stopping Gateway hot reload..." -ForegroundColor Yellow
        Stop-ProcessTree -Process $GatewayProcess
    }
}
