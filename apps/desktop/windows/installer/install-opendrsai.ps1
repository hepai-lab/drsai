param(
    [string]$RuntimeUrl = "",
    [string]$RuntimeSha256 = "",
    [Int64]$RuntimeSizeBytes = 0,
    [string]$InstallRoot = (Join-Path $env:ProgramFiles "OpenDrSai"),
    [string]$DrsaiHome = (Join-Path $env:USERPROFILE ".drsai"),
    [string]$Platform = "windows-x64",
    [string]$BootstrapperVersion = "0.1.0",
    [string]$LogFileOverride = "",
    [ValidateSet("All", "Download", "Verify", "Extract", "Install", "Complete")]
    [string]$Stage = "All",
    [switch]$MachineInstall,
    [switch]$NoShortcuts,
    [switch]$NoLaunch,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)

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
$ProgressPreference = "SilentlyContinue"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not $RuntimeUrl) {
    $RuntimeUrl = "https://download-opendrsai.ihep.ac.cn/releases/v$BootstrapperVersion/windows/OpenDrSai-Windows-v$BootstrapperVersion-x64.zip"
}

$CacheDir = Join-Path $InstallRoot "cache"
$AgentDir = Join-Path $InstallRoot "drsai-agent"
$tempRoot = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
$StagingRoot = Join-Path $tempRoot "OpenDrSaiStaging"
$machineDataRoot = Join-Path $env:ProgramData "OpenDrSai\Installer"
$LogDir = if ($MachineInstall) { Join-Path $machineDataRoot "logs" } else { Join-Path $DrsaiHome "logs\bootstrapper" }
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = if ($LogFileOverride) { $LogFileOverride } else { Join-Path $LogDir "install-$BootstrapperVersion.log" }
$ExpandedRoot = Join-Path $StagingRoot "runtime-current"

function New-Directory([string]$Path) {
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Write-Log([string]$Message) {
    New-Directory $LogDir
    $line = "[$((Get-Date).ToString("s"))] $Message"
    Add-Content -LiteralPath $LogFile -Value $line
    if (-not $Quiet) {
        Write-Host $Message
    }
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

function Remove-PathWithRetry([string]$Path, [int]$MaxAttempts = 6) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $lastError = $null
    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            return
        } catch {
            $lastError = $_
            if ($attempt -lt $MaxAttempts) {
                Write-Log "Could not remove $Path (attempt $attempt of $MaxAttempts): $($_.Exception.Message)"
                Start-Sleep -Milliseconds (250 * $attempt)
            }
        }
    }
    throw "Could not remove $Path after $MaxAttempts attempts: $($lastError.Exception.Message)"
}

function Resolve-LocalPathFromUri([string]$Value) {
    $uri = [Uri]$Value
    return [Uri]::UnescapeDataString($uri.LocalPath)
}

function Copy-OrDownload([string]$Url, [string]$OutFile, [string]$Label) {
    New-Directory (Split-Path -Parent $OutFile)
    if ($Url -match '^[a-zA-Z][a-zA-Z0-9+.-]*://') {
        $uri = [Uri]$Url
        if ($uri.Scheme -eq "file") {
            $source = Resolve-LocalPathFromUri $Url
            if (-not (Test-Path $source)) {
                throw "$Label file does not exist: $source"
            }
            Copy-Item -LiteralPath $source -Destination $OutFile -Force
            return
        }
        if ($uri.Scheme -ne "https") {
            throw "$Label URL must use https or file: $Url"
        }
        $lastError = $null
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                Write-Log "Downloading $Label (attempt $attempt)..."
                Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 300
                return
            } catch {
                $lastError = $_
                Start-Sleep -Seconds (2 * $attempt)
            }
        }
        throw $lastError
    }
    if (-not (Test-Path $Url)) {
        throw "$Label file does not exist: $Url"
    }
    Copy-Item -LiteralPath $Url -Destination $OutFile -Force
}

function Get-SafeFileName([string]$Url, [string]$Fallback) {
    if ($Url -match '^[a-zA-Z][a-zA-Z0-9+.-]*://') {
        $leaf = Split-Path ([Uri]$Url).LocalPath -Leaf
    } else {
        $leaf = Split-Path $Url -Leaf
    }
    if (-not $leaf) { return $Fallback }
    return ($leaf -replace '[^\w.\- ]', '_')
}

function Get-RuntimeArchivePath {
    return (Join-Path $CacheDir (Get-SafeFileName $RuntimeUrl "OpenDrSai-Windows-v$BootstrapperVersion-x64.zip"))
}

function Assert-RuntimeMetadata {
    if (-not $RuntimeSha256 -or -not ($RuntimeSha256 -match "^[A-Fa-f0-9]{64}$")) {
        throw "RuntimeSha256 must be provided as a 64-character hex string."
    }
    if ($RuntimeSizeBytes -le 0) {
        throw "RuntimeSizeBytes must be greater than zero."
    }
}

function Download-RuntimeArchive {
    Assert-RuntimeMetadata
    $target = Get-RuntimeArchivePath
    Copy-OrDownload $RuntimeUrl $target "OpenDrSai Runtime"
}

function Assert-RuntimeArchive {
    Assert-RuntimeMetadata
    $target = Get-RuntimeArchivePath
    if (-not (Test-Path -LiteralPath $target)) {
        throw "OpenDrSai Runtime has not been downloaded: $target"
    }
    $actualSize = (Get-Item -LiteralPath $target).Length
    if ($actualSize -ne $RuntimeSizeBytes) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        throw "OpenDrSai Runtime size mismatch. Expected $RuntimeSizeBytes bytes, got $actualSize."
    }

    $actualHash = Get-Sha256Hex $target
    $expectedHash = $RuntimeSha256.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        throw "OpenDrSai Runtime SHA256 mismatch. Expected $expectedHash, got $actualHash."
    }

}

function Expand-ZipClean([string]$Archive, [string]$Destination) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Destination
    New-Directory $Destination
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($Archive, $Destination)
}

function Resolve-RuntimeRoot([string]$ExpandedRoot) {
    $directManifest = Join-Path $ExpandedRoot "opendrsai-runtime.json"
    if (Test-Path $directManifest) {
        return $ExpandedRoot
    }
    $children = Get-ChildItem -LiteralPath $ExpandedRoot -Directory -ErrorAction SilentlyContinue
    foreach ($child in $children) {
        if (Test-Path (Join-Path $child.FullName "opendrsai-runtime.json")) {
            return $child.FullName
        }
    }
    throw "OpenDrSai Runtime archive did not contain opendrsai-runtime.json."
}

function Read-RuntimeManifest([string]$RuntimeRoot) {
    $manifestPath = Join-Path $RuntimeRoot "opendrsai-runtime.json"
    try {
        return Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    } catch {
        throw "opendrsai-runtime.json is not valid JSON: $manifestPath"
    }
}

function Assert-RuntimePayload([string]$RuntimeRoot, $RuntimeManifest) {
    if (-not $RuntimeManifest.version) {
        throw "opendrsai-runtime.json is missing version."
    }
    if ($RuntimeManifest.platform -and $RuntimeManifest.platform -ne $Platform) {
        throw "Runtime platform $($RuntimeManifest.platform) does not match installer platform $Platform."
    }
    $appExe = Join-Path $RuntimeRoot "app\OpenDrSai.exe"
    $agentDir = Join-Path $RuntimeRoot "drsai-agent"
    $pythonExe = Join-Path $agentDir "venv\Scripts\python.exe"
    $drsaiCmd = Join-Path $agentDir "venv\Scripts\drsai.cmd"
    if (-not (Test-Path $appExe)) {
        throw "OpenDrSai Runtime is missing app\OpenDrSai.exe."
    }
    if (-not (Test-Path $pythonExe)) {
        throw "OpenDrSai Runtime is missing drsai-agent\venv\Scripts\python.exe."
    }
    if (-not (Test-Path $drsaiCmd)) {
        throw "OpenDrSai Runtime is missing drsai-agent\venv\Scripts\drsai.cmd."
    }
}

function Swap-Directory([string]$Source, [string]$Destination) {
    $previous = "$Destination.previous"
    Remove-PathWithRetry $previous
    if (Test-Path $Destination) {
        Move-Item -LiteralPath $Destination -Destination $previous -Force
    }
    New-Directory (Split-Path -Parent $Destination)
    Move-Item -LiteralPath $Source -Destination $Destination -Force
}

function Remove-PreviousDirectories {
    foreach ($path in @(
        (Join-Path $InstallRoot "app.previous"),
        "$AgentDir.previous"
    )) {
        Remove-PathWithRetry $path
    }
}

function Write-CmdWrapper([string]$Path, [string]$PythonExe, [string]$Module) {
    $content = "@echo off`r`n`"$PythonExe`" -m $Module %*`r`n"
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $content, $encoding)
}

function Repair-InstalledWrappers([string]$AgentDir) {
    $venvRoot = Join-Path $AgentDir "venv"
    $pyvenvConfig = Join-Path $venvRoot "pyvenv.cfg"
    if (Test-Path (Join-Path $venvRoot "python.exe")) {
        $config = @(
            "home = $venvRoot",
            "include-system-site-packages = false",
            "version = 3.11.0",
            "executable = $(Join-Path $venvRoot 'python.exe')"
        ) -join [Environment]::NewLine
        [IO.File]::WriteAllText($pyvenvConfig, ($config + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
    }
    $scriptsDir = Join-Path $AgentDir "venv\Scripts"
    $pythonExe = Join-Path $scriptsDir "python.exe"
    Write-CmdWrapper (Join-Path $scriptsDir "drsai.cmd") $pythonExe "drsai.backend.run_cli"
    Write-CmdWrapper (Join-Path $scriptsDir "drsai-gateway.cmd") $pythonExe "drsai.backend.tui_gateway.entry"
}

function Copy-DefaultHomeFiles([string]$RuntimeRoot) {
    $homeDefaults = Join-Path $RuntimeRoot "drsai-home"
    if (-not (Test-Path $homeDefaults)) {
        return
    }
    $defaultsTarget = if ($MachineInstall) { Join-Path $InstallRoot "defaults" } else { $DrsaiHome }
    New-Directory $defaultsTarget
    foreach ($item in Get-ChildItem -LiteralPath $homeDefaults -Force) {
        $target = Join-Path $defaultsTarget $item.Name
        if (Test-Path $target) {
            continue
        }
        Copy-Item -LiteralPath $item.FullName -Destination $target -Recurse -Force
    }
}

function New-Shortcut([string]$ShortcutPath, [string]$TargetPath, [string]$WorkingDirectory) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.IconLocation = $TargetPath
    $shortcut.Save()
}

function Try-NewShortcut([string]$ShortcutPath, [string]$TargetPath, [string]$WorkingDirectory) {
    try {
        New-Shortcut $ShortcutPath $TargetPath $WorkingDirectory
    } catch {
        Write-Log "Shortcut could not be created at ${ShortcutPath}: $($_.Exception.Message)"
    }
}

function Write-InstallState($RuntimeManifest, [string]$DesktopExe, [string]$AgentDir) {
    $state = [ordered]@{
        version = [string]$RuntimeManifest.version
        runtimeVersion = [string]$RuntimeManifest.version
        channel = if ($RuntimeManifest.channel) { [string]$RuntimeManifest.channel } else { "" }
        platform = $Platform
        installedAt = (Get-Date).ToUniversalTime().ToString("o")
        installRoot = $InstallRoot
        drsaiHome = if ($MachineInstall) { "" } else { $DrsaiHome }
        desktopPath = $DesktopExe
        agentPath = $AgentDir
        runtimeLayoutVersion = if ($RuntimeManifest.layoutVersion) { [int]$RuntimeManifest.layoutVersion } else { 1 }
        logFile = $LogFile
    }
    $statePath = Join-Path $InstallRoot "install-state.json"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($statePath, (($state | ConvertTo-Json -Depth 4) + [Environment]::NewLine), $utf8NoBom)
}

function Initialize-InstallDirectories {
    New-Directory $InstallRoot
    if (-not $MachineInstall) {
        New-Directory $DrsaiHome
    }
    New-Directory $CacheDir
    New-Directory $StagingRoot
    New-Directory $LogDir
}

function Get-ExpandedRuntime {
    $runtimeRoot = Resolve-RuntimeRoot $ExpandedRoot
    $runtimeManifest = Read-RuntimeManifest $runtimeRoot
    Assert-RuntimePayload $runtimeRoot $runtimeManifest
    return @($runtimeRoot, $runtimeManifest)
}

function Install-RuntimePayload {
    $expandedRuntime = Get-ExpandedRuntime
    $runtimeRoot = $expandedRuntime[0]
    $runtimeManifest = $expandedRuntime[1]

    $appDir = Join-Path $InstallRoot "app"
    Write-Log "Installing desktop app..."
    Swap-Directory (Join-Path $runtimeRoot "app") $appDir

    Write-Log "Installing OpenDrSai agent runtime..."
    Swap-Directory (Join-Path $runtimeRoot "drsai-agent") $AgentDir
    Repair-InstalledWrappers $AgentDir
    Copy-DefaultHomeFiles $runtimeRoot

    $desktopExe = Join-Path $appDir "OpenDrSai.exe"
    if (-not $NoShortcuts) {
        $desktopFolder = [Environment]::GetFolderPath("Desktop")
        if ($desktopFolder -and [System.IO.Path]::IsPathRooted($desktopFolder)) {
            Try-NewShortcut (Join-Path $desktopFolder "OpenDrSai.lnk") $desktopExe (Split-Path -Parent $desktopExe)
        } else {
            Write-Log "Desktop folder was not available; skipping desktop shortcut."
        }

        $programsFolder = [Environment]::GetFolderPath("Programs")
        if ($programsFolder -and [System.IO.Path]::IsPathRooted($programsFolder)) {
            try {
                $startMenuDir = Join-Path $programsFolder "OpenDrSai"
                New-Directory $startMenuDir
                Try-NewShortcut (Join-Path $startMenuDir "OpenDrSai.lnk") $desktopExe (Split-Path -Parent $desktopExe)
            } catch {
                Write-Log "Start menu shortcut could not be created: $($_.Exception.Message)"
            }
        } else {
            Write-Log "Start menu programs folder was not available; skipping start menu shortcut."
        }
    }

    Write-InstallState $runtimeManifest $desktopExe $AgentDir
}

function Complete-RuntimeInstall {
    $desktopExe = Join-Path $InstallRoot "app\OpenDrSai.exe"
    if (-not (Test-Path -LiteralPath $desktopExe)) {
        throw "OpenDrSai executable was not installed: $desktopExe"
    }
    Remove-PreviousDirectories
    Remove-Item -LiteralPath $ExpandedRoot -Recurse -Force -ErrorAction SilentlyContinue

    Write-Log "OpenDrSai Runtime installation complete."
    if (-not $NoLaunch) {
        Write-Log "Launching OpenDrSai..."
        Start-Process -FilePath $desktopExe -WorkingDirectory (Split-Path -Parent $desktopExe)
    }
}

try {
    Initialize-InstallDirectories

    Write-Log "OpenDrSai Runtime install started."
    Write-Log "Stage: $Stage"
    Write-Log "Runtime URL: $RuntimeUrl"
    Write-Log "Install root: $InstallRoot"
    Write-Log "DrSai home: $DrsaiHome"

    if ($Stage -in @("All", "Download")) {
        Write-Log "Downloading OpenDrSai Runtime..."
        Download-RuntimeArchive
    }
    if ($Stage -in @("All", "Verify")) {
        Write-Log "Verifying OpenDrSai Runtime..."
        Assert-RuntimeArchive
    }
    if ($Stage -in @("All", "Extract")) {
        Write-Log "Extracting OpenDrSai Runtime..."
        Expand-ZipClean (Get-RuntimeArchivePath) $ExpandedRoot
        $null = Get-ExpandedRuntime
    }
    if ($Stage -in @("All", "Install")) {
        Write-Log "Stopping an existing OpenDrSai runtime before installation..."
        Stop-InstalledProcessTrees
        Install-RuntimePayload
    }
    if ($Stage -in @("All", "Complete")) {
        Complete-RuntimeInstall
    }
    exit 0
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    if (-not $Quiet) {
        Write-Host ""
        Write-Host "OpenDrSai Runtime installation failed. Log: $LogFile" -ForegroundColor Red
    }
    exit 1
}
