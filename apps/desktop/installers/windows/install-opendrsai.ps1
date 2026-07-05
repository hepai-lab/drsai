param(
    [string]$ManifestUrl = "https://github.com/hepai-lab/drsai/releases/latest/download/desktop-installer-windows.json",
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA "OpenDrSai"),
    [string]$DrsaiHome = (Join-Path $env:USERPROFILE ".drsai"),
    [string]$Platform = "windows-x64",
    [string]$BootstrapperVersion = "0.1.0",
    [string]$EmbeddedInstallScript = "",
    [switch]$InstallPrerequisites,
    [switch]$NoLaunch,
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AllowedChannels = @("stable", "beta", "dev")
$CacheDir = Join-Path $InstallRoot "cache"
$LogDir = Join-Path $DrsaiHome "logs\bootstrapper"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "install-$Stamp.log"

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

function ConvertTo-InstallerVersion([string]$Value, [string]$Name) {
    try {
        return [version]$Value
    } catch {
        throw "$Name must be a dotted numeric version. Got: $Value"
    }
}

function Assert-MinimumBootstrapper([string]$MinimumVersion) {
    $current = ConvertTo-InstallerVersion $BootstrapperVersion "BootstrapperVersion"
    $minimum = ConvertTo-InstallerVersion $MinimumVersion "minimumBootstrapperVersion"
    if ($current -lt $minimum) {
        throw "This OpenDrSai bootstrapper is $BootstrapperVersion, but the release requires $MinimumVersion or newer."
    }
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
                Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 120
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

function Read-Manifest([string]$Url) {
    $manifestPath = Join-Path $CacheDir "desktop-installer-manifest.json"
    Copy-OrDownload $Url $manifestPath "manifest"
    try {
        return Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    } catch {
        throw "Manifest is not valid JSON: $manifestPath"
    }
}

function Assert-Field($Object, [string]$Field, [string]$Name) {
    if (-not $Object.PSObject.Properties.Name.Contains($Field) -or -not $Object.$Field) {
        throw "$Name is missing required field: $Field"
    }
}

function Assert-Artifact($Artifact, [string]$Name) {
    foreach ($field in @("url", "sha256", "sizeBytes")) {
        Assert-Field $Artifact $field $Name
    }
    if (-not ([string]$Artifact.sha256 -match "^[A-Fa-f0-9]{64}$")) {
        throw "$Name sha256 must be a 64-character hex string."
    }
    if ([int64]$Artifact.sizeBytes -le 0) {
        throw "$Name sizeBytes must be greater than zero."
    }
}

function Resolve-PlatformPayload($Manifest) {
    foreach ($field in @("version", "channel", "minimumBootstrapperVersion", "platforms")) {
        Assert-Field $Manifest $field "manifest"
    }
    if ($Manifest.channel -notin $AllowedChannels) {
        throw "Unsupported manifest channel: $($Manifest.channel)"
    }
    Assert-MinimumBootstrapper ([string]$Manifest.minimumBootstrapperVersion)
    if (-not $Manifest.platforms.PSObject.Properties.Name.Contains($Platform)) {
        throw "Manifest does not contain platform payload: $Platform"
    }
    $payload = $Manifest.platforms.$Platform
    Assert-Field $payload "desktop" "platform $Platform"
    Assert-Field $payload "backend" "platform $Platform"
    Assert-Artifact $payload.desktop "desktop artifact"
    Assert-Artifact $payload.backend "backend artifact"
    return $payload
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

function Get-Artifact([object]$Artifact, [string]$Label, [string]$FallbackName) {
    $target = Join-Path $CacheDir (Get-SafeFileName ([string]$Artifact.url) $FallbackName)
    Copy-OrDownload ([string]$Artifact.url) $target $Label
    $actualSize = (Get-Item -LiteralPath $target).Length
    $expectedSize = [int64]$Artifact.sizeBytes
    if ($actualSize -ne $expectedSize) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        throw "$Label size mismatch. Expected $expectedSize bytes, got $actualSize."
    }
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
    $expectedHash = ([string]$Artifact.sha256).ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        throw "$Label SHA256 mismatch. Expected $expectedHash, got $actualHash."
    }
    return $target
}

function Expand-ZipClean([string]$Archive, [string]$Destination) {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $Destination
    New-Directory $Destination
    Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
}

function Swap-Directory([string]$Source, [string]$Destination) {
    $previous = "$Destination.previous"
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $previous
    if (Test-Path $Destination) {
        Move-Item -LiteralPath $Destination -Destination $previous -Force
    }
    Move-Item -LiteralPath $Source -Destination $Destination -Force
}

function Resolve-InstallScript {
    if ($EmbeddedInstallScript -and (Test-Path $EmbeddedInstallScript)) {
        return $EmbeddedInstallScript
    }
    $candidate = Join-Path $PSScriptRoot "install.ps1"
    if (Test-Path $candidate) {
        return $candidate
    }
    $repoCandidate = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..\scripts\install.ps1") -ErrorAction SilentlyContinue
    if ($repoCandidate) {
        return $repoCandidate.Path
    }
    throw "Cannot find backend install.ps1."
}

function Install-Backend([string]$BackendArchive, [object]$BackendArtifact) {
    $mode = "source-archive"
    if ($BackendArtifact.PSObject.Properties.Name.Contains("installMode") -and $BackendArtifact.installMode) {
        $mode = [string]$BackendArtifact.installMode
    }
    if ($mode -ne "source-archive") {
        throw "Unsupported backend installMode: $mode"
    }
    $installScript = Resolve-InstallScript
    $backendInstallDir = Join-Path $DrsaiHome "drsai-agent"
    $args = @(
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        $installScript,
        "-SkipSetup",
        "-DrsaiHome",
        $DrsaiHome,
        "-InstallDir",
        $backendInstallDir,
        "-SourceArchive",
        $BackendArchive,
        "-SourceArchiveSha256",
        ([string]$BackendArtifact.sha256)
    )
    if ($InstallPrerequisites) {
        $args += "-InstallPrerequisites"
    }
    Write-Log "Installing backend..."
    & powershell.exe @args 2>&1 | ForEach-Object {
        Write-Log "backend: $_"
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Backend install failed with exit code $LASTEXITCODE."
    }
    return $backendInstallDir
}

function New-Shortcut([string]$ShortcutPath, [string]$TargetPath, [string]$WorkingDirectory) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.IconLocation = $TargetPath
    $shortcut.Save()
}

function Write-InstallState([object]$Manifest, [string]$DesktopExe, [string]$BackendDir) {
    $state = [ordered]@{
        version = [string]$Manifest.version
        channel = [string]$Manifest.channel
        platform = $Platform
        installedAt = (Get-Date).ToUniversalTime().ToString("o")
        installRoot = $InstallRoot
        drsaiHome = $DrsaiHome
        desktopPath = $DesktopExe
        backendPath = $BackendDir
        logFile = $LogFile
    }
    $statePath = Join-Path $InstallRoot "install-state.json"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($statePath, (($state | ConvertTo-Json -Depth 4) + [Environment]::NewLine), $utf8NoBom)
}

try {
    New-Directory $InstallRoot
    New-Directory $DrsaiHome
    New-Directory $CacheDir
    New-Directory $LogDir

    Write-Log "OpenDrSai desktop bootstrap install started."
    Write-Log "Manifest: $ManifestUrl"
    Write-Log "Install root: $InstallRoot"
    Write-Log "DrSai home: $DrsaiHome"

    $manifest = Read-Manifest $ManifestUrl
    $payload = Resolve-PlatformPayload $manifest

    $desktopArchive = Get-Artifact $payload.desktop "desktop artifact" "OpenDrSai-desktop-win-x64.zip"
    $backendArchive = Get-Artifact $payload.backend "backend artifact" "opendrsai-backend-source.zip"

    $desktopTemp = Join-Path $InstallRoot "app.next"
    $appDir = Join-Path $InstallRoot "app"
    Write-Log "Extracting desktop app..."
    Expand-ZipClean $desktopArchive $desktopTemp

    $exeRelativePath = "OpenDrSai.exe"
    if ($payload.desktop.PSObject.Properties.Name.Contains("executableRelativePath") -and $payload.desktop.executableRelativePath) {
        $exeRelativePath = [string]$payload.desktop.executableRelativePath
    }
    $candidateExe = Join-Path $desktopTemp $exeRelativePath
    if (-not (Test-Path $candidateExe)) {
        $found = Get-ChildItem -Path $desktopTemp -Recurse -Filter "OpenDrSai.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            $candidateExe = $found.FullName
        }
    }
    if (-not (Test-Path $candidateExe)) {
        throw "Desktop archive did not contain OpenDrSai.exe."
    }

    $desktopTempResolved = (Resolve-Path $desktopTemp).Path
    $candidateExeResolved = (Resolve-Path $candidateExe).Path
    $installedExeRelativePath = $candidateExeResolved.Substring($desktopTempResolved.Length).TrimStart("\", "/")
    Swap-Directory $desktopTemp $appDir
    $desktopExe = Join-Path $appDir $installedExeRelativePath
    if (-not (Test-Path $desktopExe)) {
        $foundAfterSwap = Get-ChildItem -Path $appDir -Recurse -Filter "OpenDrSai.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $foundAfterSwap) {
            throw "Installed OpenDrSai.exe was not found under $appDir."
        }
        $desktopExe = $foundAfterSwap.FullName
    }

    $backendDir = Install-Backend $backendArchive $payload.backend

    $desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "OpenDrSai.lnk"
    $startMenuDir = Join-Path ([Environment]::GetFolderPath("Programs")) "OpenDrSai"
    New-Directory $startMenuDir
    New-Shortcut $desktopShortcut $desktopExe (Split-Path -Parent $desktopExe)
    New-Shortcut (Join-Path $startMenuDir "OpenDrSai.lnk") $desktopExe (Split-Path -Parent $desktopExe)

    Write-InstallState $manifest $desktopExe $backendDir

    Write-Log "OpenDrSai installation complete."
    if (-not $NoLaunch) {
        Write-Log "Launching OpenDrSai..."
        Start-Process -FilePath $desktopExe -WorkingDirectory (Split-Path -Parent $desktopExe)
    }
    exit 0
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    if (-not $Quiet) {
        Write-Host ""
        Write-Host "OpenDrSai installation failed. Log: $LogFile" -ForegroundColor Red
    }
    exit 1
}
