param(
    [string]$RuntimeUrl = "",
    [string]$RuntimeSha256 = "",
    [Int64]$RuntimeSizeBytes = 0,
    [string]$InstallRoot = (Join-Path $env:ProgramFiles "OpenDrSai"),
    [string]$DrsaiHome = (Join-Path $env:USERPROFILE ".drsai"),
    [string]$Platform = "windows-x64",
    [string]$BootstrapperVersion = "0.1.0",
    [string]$LogFileOverride = "",
    [string]$ProgressFile = "",
    [string]$InstallSessionId = "standalone",
    [ValidateSet("All", "Download", "Verify", "Extract", "Install", "Complete", "Rollback")]
    [string]$Stage = "All",
    [switch]$MachineInstall,
    [switch]$NoShortcuts,
    [switch]$NoLaunch,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)

function Get-Sha256Hex([string]$Path, [scriptblock]$OnProgress = $null) {
    $stream = [System.IO.File]::OpenRead($Path)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $buffer = New-Object byte[] (1024 * 1024)
        [Int64]$processed = 0
        while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $null = $sha256.TransformBlock($buffer, 0, $read, $null, 0)
            $processed += $read
            if ($OnProgress) { & $OnProgress $processed $stream.Length }
        }
        $null = $sha256.TransformFinalBlock($buffer, 0, 0)
        return ([System.BitConverter]::ToString($sha256.Hash)).Replace("-", "").ToLowerInvariant()
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
$machineDataRoot = Join-Path $env:ProgramData "OpenDrSai\Installer"
$tempRoot = if ($MachineInstall) {
    Join-Path $machineDataRoot "staging"
} else {
    $expandedTemp = if ($env:TEMP) { [Environment]::ExpandEnvironmentVariables($env:TEMP) } else { "" }
    if (-not $expandedTemp -or -not [IO.Path]::IsPathRooted($expandedTemp) -or $expandedTemp.Contains('%')) {
        $expandedTemp = [System.IO.Path]::GetTempPath()
    }
    $expandedTemp
}
$safeSessionId = $InstallSessionId -replace '[^A-Za-z0-9._-]', '_'
$StagingRoot = Join-Path $tempRoot $safeSessionId
$LogDir = if ($MachineInstall) { Join-Path $machineDataRoot "logs" } else { Join-Path $DrsaiHome "logs\bootstrapper" }
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = if ($LogFileOverride) { $LogFileOverride } else { Join-Path $LogDir "install-$BootstrapperVersion.log" }
$ExpandedRoot = Join-Path $StagingRoot "runtime-current"
$RollbackStatePath = Join-Path $StagingRoot "install-rollback.json"

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

function Write-StageProgress([int]$Percent, [string]$Detail) {
    if (-not $ProgressFile) { return }
    $boundedPercent = [Math]::Max(0, [Math]::Min(100, $Percent))
    $payload = "$boundedPercent`t$($Detail -replace '[\r\n]+', ' ')"
    $stream = $null
    try {
        New-Directory (Split-Path -Parent $ProgressFile)
        $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($payload)
        $stream = New-Object IO.FileStream(
            $ProgressFile,
            [IO.FileMode]::Create,
            [IO.FileAccess]::Write,
            ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        )
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
    } catch {
        # Progress reporting is best-effort. A short-lived UI reader, antivirus
        # scanner, or indexer must never turn a healthy Runtime install into MSI
        # error 1603.
    } finally {
        if ($stream) { $stream.Dispose() }
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

    $actualHash = Get-Sha256Hex $target {
        param([Int64]$Processed, [Int64]$Total)
        $percent = if ($Total -gt 0) { [int](90 * $Processed / $Total) } else { 0 }
        Write-StageProgress $percent ("{0}%   {1:N1} / {2:N1} MB checked" -f $percent, ($Processed / 1MB), ($Total / 1MB))
    }
    $expectedHash = $RuntimeSha256.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        throw "OpenDrSai Runtime SHA256 mismatch. Expected $expectedHash, got $actualHash."
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($target)
    try {
        [Int64]$expandedBytes = ($archive.Entries | Measure-Object -Property Length -Sum).Sum
    } finally {
        $archive.Dispose()
    }
    $marginBytes = 256MB
    $installDrive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($InstallRoot))
    $stagingDrive = New-Object IO.DriveInfo ([IO.Path]::GetPathRoot($StagingRoot))
    [Int64]$installRequired = $expandedBytes + $marginBytes
    if ($installDrive.Name -eq $stagingDrive.Name) { $installRequired += $expandedBytes }
    if ($installDrive.AvailableFreeSpace -lt $installRequired) {
        throw ("OpenDrSai needs {0:N1} GB free on {1}, but only {2:N1} GB is available." -f ($installRequired / 1GB), $installDrive.Name, ($installDrive.AvailableFreeSpace / 1GB))
    }
    if ($installDrive.Name -ne $stagingDrive.Name -and $stagingDrive.AvailableFreeSpace -lt ($expandedBytes + $marginBytes)) {
        throw ("OpenDrSai staging needs {0:N1} GB free on {1}, but only {2:N1} GB is available." -f (($expandedBytes + $marginBytes) / 1GB), $stagingDrive.Name, ($stagingDrive.AvailableFreeSpace / 1GB))
    }
    Write-StageProgress 100 ("100%   Package verified; {0:N1} MB will be installed" -f ($expandedBytes / 1MB))
}

function Expand-ZipClean([string]$Archive, [string]$Destination) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Destination
    New-Directory $Destination
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveFile = [System.IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        [Int64]$totalBytes = ($archiveFile.Entries | Measure-Object -Property Length -Sum).Sum
        [Int64]$expandedBytes = 0
        $destinationRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
        $buffer = New-Object byte[] (1024 * 1024)
        foreach ($entry in $archiveFile.Entries) {
            $targetPath = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
            if (-not $targetPath.StartsWith($destinationRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Runtime archive contains an unsafe path: $($entry.FullName)"
            }
            if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) {
                New-Directory $targetPath
                continue
            }
            New-Directory (Split-Path -Parent $targetPath)
            $source = $null
            $target = $null
            try {
                $source = $entry.Open()
                $target = [IO.File]::Open($targetPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
                while (($read = $source.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $target.Write($buffer, 0, $read)
                    $expandedBytes += $read
                    $percent = if ($totalBytes -gt 0) { [int](100 * $expandedBytes / $totalBytes) } else { 100 }
                    Write-StageProgress $percent ("{0}%   {1:N1} / {2:N1} MB extracted" -f $percent, ($expandedBytes / 1MB), ($totalBytes / 1MB))
                }
            } catch {
                $exception = $_.Exception
                throw ("Failed to extract Runtime entry '{0}' to '{1}': {2} (type={3}, hresult=0x{4:X8})" -f $entry.FullName, $targetPath, $exception.Message, $exception.GetType().FullName, $exception.HResult)
            } finally {
                if ($target) { $target.Dispose() }
                if ($source) { $source.Dispose() }
            }
        }
        Write-StageProgress 100 ("100%   {0:N1} MB extracted" -f ($totalBytes / 1MB))
    } finally {
        $archiveFile.Dispose()
    }
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
    if ([string]$RuntimeManifest.version -ne $BootstrapperVersion) {
        throw "Runtime version $($RuntimeManifest.version) does not match Setup version $BootstrapperVersion."
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

function Copy-DirectoryWithProgress([string]$Source, [string]$Destination, [int]$StartPercent, [int]$EndPercent) {
    Remove-PathWithRetry $Destination
    New-Directory $Destination
    $files = @(Get-ChildItem -LiteralPath $Source -File -Recurse -Force)
    [Int64]$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
    [Int64]$copiedBytes = 0
    $buffer = New-Object byte[] (1024 * 1024)
    foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($Source.TrimEnd('\').Length).TrimStart('\')
        $targetPath = Join-Path $Destination $relativePath
        New-Directory (Split-Path -Parent $targetPath)
        $input = [IO.File]::OpenRead($file.FullName)
        $output = [IO.File]::Open($targetPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            while (($read = $input.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $output.Write($buffer, 0, $read)
                $copiedBytes += $read
                $fraction = if ($totalBytes -gt 0) { $copiedBytes / $totalBytes } else { 1 }
                $percent = [int]($StartPercent + (($EndPercent - $StartPercent) * $fraction))
                Write-StageProgress $percent ("{0}%   {1:N1} / {2:N1} MB installed" -f $percent, ($copiedBytes / 1MB), ($totalBytes / 1MB))
            }
        } finally {
            $output.Dispose()
            $input.Dispose()
        }
        [IO.File]::SetLastWriteTimeUtc($targetPath, $file.LastWriteTimeUtc)
        [IO.File]::SetAttributes($targetPath, $file.Attributes)
    }
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
    $appCandidate = Join-Path $InstallRoot "app.installing"
    $agentCandidate = Join-Path $InstallRoot "drsai-agent.installing"
    Write-Log "Installing desktop app..."
    Write-StageProgress 2 "Preparing the desktop application..."
    Copy-DirectoryWithProgress (Join-Path $runtimeRoot "app") $appCandidate 2 48

    Write-Log "Installing OpenDrSai agent runtime..."
    Copy-DirectoryWithProgress (Join-Path $runtimeRoot "drsai-agent") $agentCandidate 48 90
    Write-RollbackState
    Stop-InstalledProcessTrees
    Write-StageProgress 92 "Activating the desktop application..."
    Swap-Directory $appCandidate $appDir
    Write-StageProgress 95 "Activating the OpenDrSai agent runtime..."
    Swap-Directory $agentCandidate $AgentDir
    Repair-InstalledWrappers $AgentDir
    Write-StageProgress 97 "Installing default configuration..."
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
    Write-StageProgress 100 "100%   OpenDrSai files installed"
}

function Remove-PathsWithProgress([string[]]$Paths, [int]$StartPercent, [int]$EndPercent) {
    $existingPaths = @($Paths | Where-Object { Test-Path -LiteralPath $_ })
    $files = @($existingPaths | ForEach-Object { Get-ChildItem -LiteralPath $_ -File -Recurse -Force -ErrorAction SilentlyContinue })
    $total = [Math]::Max(1, $files.Count)
    for ($index = 0; $index -lt $files.Count; $index++) {
        Remove-Item -LiteralPath $files[$index].FullName -Force -ErrorAction SilentlyContinue
        $percent = [int]($StartPercent + (($EndPercent - $StartPercent) * (($index + 1) / $total)))
        Write-StageProgress $percent ("{0}%   {1} / {2} temporary files removed" -f $percent, ($index + 1), $total)
    }
    foreach ($path in $existingPaths) {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Write-RollbackState {
    $state = [ordered]@{
        appExisted = Test-Path -LiteralPath (Join-Path $InstallRoot "app")
        agentExisted = Test-Path -LiteralPath $AgentDir
    }
    [IO.File]::WriteAllText($RollbackStatePath, (($state | ConvertTo-Json -Compress) + [Environment]::NewLine), (New-Object Text.UTF8Encoding($false)))
}

function Rollback-RuntimeInstall {
    if (-not (Test-Path -LiteralPath $RollbackStatePath)) { return }
    $state = Get-Content -LiteralPath $RollbackStatePath -Raw | ConvertFrom-Json
    Stop-InstalledProcessTrees
    foreach ($item in @(
        @{ Current = (Join-Path $InstallRoot "app"); Previous = (Join-Path $InstallRoot "app.previous"); Existed = [bool]$state.appExisted },
        @{ Current = $AgentDir; Previous = "$AgentDir.previous"; Existed = [bool]$state.agentExisted }
    )) {
        if (Test-Path -LiteralPath $item.Previous) {
            Remove-PathWithRetry $item.Current
            Move-Item -LiteralPath $item.Previous -Destination $item.Current -Force
        } elseif (-not $item.Existed) {
            Remove-PathWithRetry $item.Current
        }
    }
    Remove-PathWithRetry (Join-Path $InstallRoot "app.installing")
    Remove-PathWithRetry (Join-Path $InstallRoot "drsai-agent.installing")
    Remove-Item -LiteralPath $RollbackStatePath -Force -ErrorAction SilentlyContinue
}

function Complete-RuntimeInstall {
    $desktopExe = Join-Path $InstallRoot "app\OpenDrSai.exe"
    if (-not (Test-Path -LiteralPath $desktopExe)) {
        throw "OpenDrSai executable was not installed: $desktopExe"
    }
    Write-StageProgress 20 "Checking the installed application..."
    Remove-PathsWithProgress @(
        (Join-Path $InstallRoot "app.previous"),
        "$AgentDir.previous",
        $ExpandedRoot
    ) 20 97
    Remove-Item -LiteralPath $RollbackStatePath -Force -ErrorAction SilentlyContinue
    Write-StageProgress 99 "Cleaning temporary installation files..."

    Write-Log "OpenDrSai Runtime installation complete."
    if (-not $NoLaunch) {
        Write-Log "Launching OpenDrSai..."
        Start-Process -FilePath $desktopExe -WorkingDirectory (Split-Path -Parent $desktopExe)
    }
    Write-StageProgress 100 "100%   OpenDrSai installation complete"
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
        Write-StageProgress 0 "Checking the Runtime package..."
        Write-Log "Verifying OpenDrSai Runtime..."
        Assert-RuntimeArchive
    }
    if ($Stage -in @("All", "Extract")) {
        Write-StageProgress 0 "Preparing to extract the Runtime..."
        Write-Log "Extracting OpenDrSai Runtime..."
        Expand-ZipClean (Get-RuntimeArchivePath) $ExpandedRoot
        $null = Get-ExpandedRuntime
    }
    if ($Stage -in @("All", "Install")) {
        Write-StageProgress 0 "Preparing to install OpenDrSai..."
        Write-Log "Preparing the new OpenDrSai runtime before activation..."
        Install-RuntimePayload
    }
    if ($Stage -in @("All", "Complete")) {
        Write-StageProgress 0 "Finishing OpenDrSai installation..."
        Complete-RuntimeInstall
    }
    if ($Stage -eq "Rollback") {
        Rollback-RuntimeInstall
    }
    exit 0
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    Write-Log "ERROR DETAILS: $($_.Exception.ToString())"
    if (-not $Quiet) {
        Write-Host ""
        Write-Host "OpenDrSai Runtime installation failed. Log: $LogFile" -ForegroundColor Red
    }
    exit 1
}
