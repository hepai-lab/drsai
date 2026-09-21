param(
    [ValidateSet("Prepare", "Apply")]
    [string]$Mode,
    [string]$ArchivePath = "",
    [string]$StagingRoot,
    [string]$InstallRoot,
    [string]$AgentDir,
    [string]$ExpectedVersion,
    [string]$ExpectedSha256 = "",
    [Int64]$ExpectedSizeBytes = 0,
    [string]$CurrentExecutable = "",
    [ValidateSet("0", "1")]
    [string]$RequireSignature = "1",
    [ValidateSet("0", "1")]
    [string]$AllowUnsigned = "0",
    [int]$WaitPid = 0,
    [string]$HealthToken = "",
    [int]$HealthTimeoutSeconds = 90,
    [string]$StatePath
)

$ErrorActionPreference = "Stop"

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

function Write-UpdateState([string]$Phase, [string]$Message = "") {
    $state = [ordered]@{
        schemaVersion = 1
        phase = $Phase
        version = $ExpectedVersion
        message = $Message
        updatedAt = (Get-Date).ToUniversalTime().ToString("o")
        installRoot = $InstallRoot
        agentDir = $AgentDir
        stagingRoot = $StagingRoot
    }
    $parent = Split-Path -Parent $StatePath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [IO.File]::WriteAllText(
        $StatePath,
        (($state | ConvertTo-Json -Depth 5) + [Environment]::NewLine),
        (New-Object Text.UTF8Encoding($false))
    )
}

function Resolve-FullPath([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return (Resolve-Path -LiteralPath $Path).Path }
    return [IO.Path]::GetFullPath($Path)
}

function Assert-PathInside([string]$Root, [string]$Candidate) {
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $candidatePath = [IO.Path]::GetFullPath($Candidate)
    if (-not $candidatePath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Runtime archive entry escapes the staging directory."
    }
}

function Expand-RuntimeArchive([string]$Archive, [string]$Destination) {
    Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        foreach ($entry in $zip.Entries) {
            $target = Join-Path $Destination $entry.FullName
            Assert-PathInside $Destination $target
            if ([string]::IsNullOrEmpty($entry.Name)) {
                New-Item -ItemType Directory -Force -Path $target | Out-Null
                continue
            }
            $parent = Split-Path -Parent $target
            if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
        }
    } finally {
        $zip.Dispose()
    }
}

function Resolve-RuntimeRoot([string]$ExpandedRoot) {
    if (Test-Path -LiteralPath (Join-Path $ExpandedRoot "opendrsai-runtime.json")) {
        return $ExpandedRoot
    }
    $matches = @(Get-ChildItem -LiteralPath $ExpandedRoot -Directory -ErrorAction Stop |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "opendrsai-runtime.json") })
    if ($matches.Count -ne 1) { throw "Runtime archive must contain exactly one opendrsai-runtime.json root." }
    return $matches[0].FullName
}

function Read-RuntimeManifest([string]$RuntimeRoot) {
    try {
        return Get-Content -LiteralPath (Join-Path $RuntimeRoot "opendrsai-runtime.json") -Raw | ConvertFrom-Json
    } catch {
        throw "Runtime manifest is not valid JSON."
    }
}

function Assert-Runtime([string]$RuntimeRoot) {
    $manifest = Read-RuntimeManifest $RuntimeRoot
    if ([string]$manifest.version -ne $ExpectedVersion) {
        throw "Runtime version $($manifest.version) does not match expected version $ExpectedVersion."
    }
    if ([string]$manifest.platform -ne "windows-x64") {
        throw "Runtime platform must be windows-x64."
    }
    if ([int]$manifest.layoutVersion -ne 1) {
        throw "Unsupported runtime layout version $($manifest.layoutVersion)."
    }
    $appExe = Join-Path $RuntimeRoot "app\OpenDrSai.exe"
    $pythonExe = Join-Path $RuntimeRoot "drsai-agent\venv\Scripts\python.exe"
    $drsaiCmd = Join-Path $RuntimeRoot "drsai-agent\venv\Scripts\drsai.cmd"
    foreach ($required in @($appExe, $pythonExe, $drsaiCmd)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "Runtime is missing required file: $required"
        }
    }
    $versionOutput = & $pythonExe -W ignore -m drsai.backend.run_cli version 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch [regex]::Escape($ExpectedVersion)) {
        throw "Staged backend version check failed: $versionOutput"
    }
    Assert-Publisher $CurrentExecutable $appExe
    return $manifest
}

function Assert-Publisher([string]$CurrentExe, [string]$StagedExe) {
    if ($RequireSignature -ne "1" -or $AllowUnsigned -eq "1") { return }
    if (-not $CurrentExe -or -not (Test-Path -LiteralPath $CurrentExe)) {
        throw "Current executable is unavailable for publisher verification."
    }
    $current = Get-AuthenticodeSignature -LiteralPath $CurrentExe
    $staged = Get-AuthenticodeSignature -LiteralPath $StagedExe
    if ($current.Status -ne "Valid" -or -not $current.SignerCertificate) {
        throw "The installed executable does not have a valid Authenticode signature."
    }
    if ($staged.Status -ne "Valid" -or -not $staged.SignerCertificate) {
        throw "The staged executable does not have a valid Authenticode signature."
    }
    if ($current.SignerCertificate.Thumbprint -ne $staged.SignerCertificate.Thumbprint) {
        throw "The staged executable publisher does not match the installed publisher."
    }
}

function Repair-AgentWrappers([string]$TargetAgentDir) {
    $venvRoot = Join-Path $TargetAgentDir "venv"
    $scriptsDir = Join-Path $venvRoot "Scripts"
    $pythonExe = Join-Path $scriptsDir "python.exe"
    $config = @(
        "home = $venvRoot",
        "include-system-site-packages = false",
        "version = 3.11.0",
        "executable = $pythonExe"
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText(
        (Join-Path $venvRoot "pyvenv.cfg"),
        ($config + [Environment]::NewLine),
        (New-Object Text.UTF8Encoding($false))
    )
    foreach ($wrapper in @(
        @{ name = "drsai.cmd"; module = "drsai.backend.run_cli" },
        @{ name = "drsai-gateway.cmd"; module = "drsai.backend.tui_gateway.entry" }
    )) {
        $content = "@echo off`r`n`"$pythonExe`" -m $($wrapper.module) %*`r`n"
        [IO.File]::WriteAllText(
            (Join-Path $scriptsDir $wrapper.name),
            $content,
            (New-Object Text.UTF8Encoding($false))
        )
    }
}

function Write-InstallState($Manifest, [string]$DesktopExe) {
    $path = Join-Path $InstallRoot "install-state.json"
    $previous = @{}
    if (Test-Path -LiteralPath $path) {
        try { $previous = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json } catch { $previous = @{} }
    }
    $state = [ordered]@{
        version = [string]$Manifest.version
        runtimeVersion = [string]$Manifest.version
        channel = [string]$Manifest.channel
        platform = "windows-x64"
        installedAt = (Get-Date).ToUniversalTime().ToString("o")
        installRoot = $InstallRoot
        drsaiHome = Split-Path -Parent $AgentDir
        desktopPath = $DesktopExe
        agentPath = $AgentDir
        runtimeLayoutVersion = [int]$Manifest.layoutVersion
        logFile = if ($previous.logFile) { [string]$previous.logFile } else { "" }
    }
    [IO.File]::WriteAllText(
        $path,
        (($state | ConvertTo-Json -Depth 5) + [Environment]::NewLine),
        (New-Object Text.UTF8Encoding($false))
    )
}

function Wait-ForProcessExit([int]$ProcessId, [int]$TimeoutSeconds = 90) {
    if ($ProcessId -le 0) { return }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for OpenDrSai to exit."
}

function Move-CurrentToPrevious([string]$Current, [string]$Previous) {
    Remove-Item -LiteralPath $Previous -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Current) {
        Move-Item -LiteralPath $Current -Destination $Previous -Force
    }
}

function Restore-Previous([string]$Current, [string]$Previous) {
    Remove-Item -LiteralPath $Current -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Previous) {
        Move-Item -LiteralPath $Previous -Destination $Current -Force
    }
}

function Invoke-Prepare {
    if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw "Runtime archive does not exist." }
    if ((Get-Item -LiteralPath $ArchivePath).Length -ne $ExpectedSizeBytes) { throw "Runtime archive size mismatch." }
    $actualHash = Get-Sha256Hex $ArchivePath
    if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) { throw "Runtime archive SHA-256 mismatch." }
    Write-UpdateState "staging" "Extracting and validating runtime."
    $expanded = Join-Path $StagingRoot "expanded"
    Expand-RuntimeArchive $ArchivePath $expanded
    $runtimeRoot = Resolve-RuntimeRoot $expanded
    $prepared = Join-Path $StagingRoot "runtime"
    Remove-Item -LiteralPath $prepared -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $runtimeRoot -Destination $prepared
    # A venv created on a build runner keeps that machine's absolute Python
    # home in pyvenv.cfg and command wrappers. Rebind it to the extracted
    # portable Python before executing any staged backend code.
    Repair-AgentWrappers (Join-Path $prepared "drsai-agent")
    $manifest = Assert-Runtime $prepared
    Write-UpdateState "ready" "Runtime staged and verified."
    [pscustomobject]@{ ok = $true; version = $manifest.version; runtimeRoot = $prepared } | ConvertTo-Json -Compress
}

function Invoke-Apply {
    $runtimeRoot = Join-Path $StagingRoot "runtime"
    $manifest = Assert-Runtime $runtimeRoot
    Wait-ForProcessExit $WaitPid
    $appDir = Join-Path $InstallRoot "app"
    $appPrevious = Join-Path $InstallRoot "app.previous"
    $agentPrevious = "$AgentDir.previous"
    $newApp = Join-Path $runtimeRoot "app"
    $newAgent = Join-Path $runtimeRoot "drsai-agent"
    $marker = Join-Path (Split-Path -Parent $StatePath) "health-$HealthToken.ok"
    $installState = Join-Path $InstallRoot "install-state.json"
    $installStatePrevious = Join-Path $InstallRoot "install-state.json.previous"
    $hadInstallState = Test-Path -LiteralPath $installState -PathType Leaf
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $installStatePrevious -Force -ErrorAction SilentlyContinue
    if ($hadInstallState) { Copy-Item -LiteralPath $installState -Destination $installStatePrevious -Force }
    try {
        Write-UpdateState "installing" "Replacing managed runtime directories."
        Move-CurrentToPrevious $appDir $appPrevious
        Move-CurrentToPrevious $AgentDir $agentPrevious
        Move-Item -LiteralPath $newApp -Destination $appDir
        Move-Item -LiteralPath $newAgent -Destination $AgentDir
        Repair-AgentWrappers $AgentDir
        $desktopExe = Join-Path $appDir "OpenDrSai.exe"
        Write-InstallState $manifest $desktopExe
        Write-UpdateState "awaiting-health" "Waiting for the updated app to confirm startup."
        $launchArguments = "--opendrsai-update-token=$HealthToken --opendrsai-update-state=`"$StatePath`""
        $process = Start-Process -FilePath $desktopExe -WorkingDirectory $appDir -ArgumentList $launchArguments -PassThru
        $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
        do {
            if (Test-Path -LiteralPath $marker) {
                $confirmedVersion = (Get-Content -LiteralPath $marker -Raw).Trim()
                if ($confirmedVersion -ne $ExpectedVersion) {
                    throw "Updated app reported version $confirmedVersion instead of $ExpectedVersion."
                }
                Write-UpdateState "complete" "Updated app confirmed startup."
                Remove-Item -LiteralPath $appPrevious -Recurse -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $agentPrevious -Recurse -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $StagingRoot -Recurse -Force -ErrorAction SilentlyContinue
                Remove-Item -LiteralPath $installStatePrevious -Force -ErrorAction SilentlyContinue
                if ($ArchivePath) {
                    Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction SilentlyContinue
                    Remove-Item -LiteralPath "$ArchivePath.partial" -Force -ErrorAction SilentlyContinue
                }
                Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
                return
            }
            if ($process.HasExited) { break }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)
        throw "Updated app did not confirm a healthy startup."
    } catch {
        $reason = $_.Exception.Message
        Write-UpdateState "rollback" $reason
        if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        Restore-Previous $appDir $appPrevious
        Restore-Previous $AgentDir $agentPrevious
        if ($hadInstallState -and (Test-Path -LiteralPath $installStatePrevious -PathType Leaf)) {
            Move-Item -LiteralPath $installStatePrevious -Destination $installState -Force
        } elseif (-not $hadInstallState) {
            Remove-Item -LiteralPath $installState -Force -ErrorAction SilentlyContinue
        }
        $oldExe = Join-Path $appDir "OpenDrSai.exe"
        Write-UpdateState "rolled-back" $reason
        if (Test-Path -LiteralPath $oldExe) { Start-Process -FilePath $oldExe -WorkingDirectory $appDir }
        throw
    }
}

try {
    $InstallRoot = Resolve-FullPath $InstallRoot
    $AgentDir = Resolve-FullPath $AgentDir
    $StagingRoot = Resolve-FullPath $StagingRoot
    $StatePath = Resolve-FullPath $StatePath
    if ($Mode -eq "Prepare") { Invoke-Prepare } else { Invoke-Apply }
    exit 0
} catch {
    try {
        $phase = if (Test-Path -LiteralPath $StatePath) {
            [string](Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json).phase
        } else { "" }
        if ($phase -ne "rolled-back") { Write-UpdateState "failed" $_.Exception.Message }
    } catch { }
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
