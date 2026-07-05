param(
    [string]$ManifestUrl = "https://github.com/hepai-lab/drsai/releases/latest/download/latest-windows.json",
    [string]$DownloadDir = "$env:TEMP\OpenDrSaiInstaller",
    [string]$BootstrapperVersion = "0.1.0",
    [string]$ExpectedSignerThumbprint = "",
    [string]$ExpectedSignerSubject = "",
    [switch]$Quiet
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AllowedHosts = @(
    "github.com",
    "github-releases.githubusercontent.com",
    "objects.githubusercontent.com"
)

function Write-Step([string]$Message) {
    if (-not $Quiet) {
        Write-Host "[OpenDrSai] $Message"
    }
}

function Assert-HttpsUrl([string]$Url, [string]$Name) {
    $parsed = [Uri]$Url
    if ($parsed.Scheme -ne "https") {
        throw "$Name must use https: $Url"
    }
    if ($AllowedHosts -notcontains $parsed.Host.ToLowerInvariant()) {
        throw "$Name host is not allowed: $($parsed.Host)"
    }
}

function Invoke-Download([string]$Url, [string]$OutFile) {
    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -TimeoutSec 60
            return
        } catch {
            $lastError = $_
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
    throw $lastError
}

function Assert-Manifest($Manifest) {
    $missing = @()
    foreach ($field in @("version", "channel", "installer", "sha256", "sizeBytes")) {
        if (-not $Manifest.PSObject.Properties.Name.Contains($field) -or -not $Manifest.$field) {
            $missing += $field
        }
    }
    if ($missing.Count -gt 0) {
        throw "Manifest is missing required fields: $($missing -join ', ')."
    }
    if ($Manifest.channel -notin @("stable", "beta", "dev")) {
        throw "Unsupported manifest channel: $($Manifest.channel)"
    }
    if (-not ([string]$Manifest.sha256 -match "^[A-Fa-f0-9]{64}$")) {
        throw "Manifest sha256 must be a 64-character hex string."
    }
    if ([int64]$Manifest.sizeBytes -le 0) {
        throw "Manifest sizeBytes must be greater than zero."
    }
    if ($Manifest.PSObject.Properties.Name.Contains("minimumBootstrapperVersion") -and $Manifest.minimumBootstrapperVersion) {
        Assert-BootstrapperVersion -MinimumVersion ([string]$Manifest.minimumBootstrapperVersion)
    }
}

function Assert-BootstrapperVersion([string]$MinimumVersion) {
    $current = ConvertTo-Version $BootstrapperVersion "BootstrapperVersion"
    $minimum = ConvertTo-Version $MinimumVersion "minimumBootstrapperVersion"
    if ($current -lt $minimum) {
        throw "This OpenDrSai Installer is version $BootstrapperVersion, but the release requires bootstrapper version $MinimumVersion or newer. Please download the latest OpenDrSai Installer."
    }
}

function ConvertTo-Version([string]$Value, [string]$Name) {
    try {
        return [version]$Value
    } catch {
        throw "$Name must be a dotted numeric version. Got: $Value"
    }
}

function Assert-AuthenticodeSignature([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne "Valid") {
        Remove-Item $Path -Force -ErrorAction SilentlyContinue
        throw "Installer Authenticode signature is not valid: $($signature.Status)"
    }
    $expectedThumbprint = Normalize-Thumbprint $ExpectedSignerThumbprint
    $actualThumbprint = Normalize-Thumbprint $signature.SignerCertificate.Thumbprint
    if ($expectedThumbprint -and $actualThumbprint -ne $expectedThumbprint) {
        Remove-Item $Path -Force -ErrorAction SilentlyContinue
        throw "Installer signer thumbprint does not match the expected OpenDrSai publisher."
    }
    if ($ExpectedSignerSubject -and $signature.SignerCertificate.Subject -notlike "*$ExpectedSignerSubject*") {
        Remove-Item $Path -Force -ErrorAction SilentlyContinue
        throw "Installer signer subject does not match the expected OpenDrSai publisher."
    }
}

function Normalize-Thumbprint([string]$Value) {
    if (-not $Value) { return "" }
    return ($Value -replace "[^0-9A-Fa-f]", "").ToUpperInvariant()
}

New-Item -ItemType Directory -Force -Path $DownloadDir | Out-Null

Write-Step "Downloading manifest..."
Assert-HttpsUrl $ManifestUrl "Manifest URL"
$manifestPath = Join-Path $DownloadDir "latest-windows.json"
Invoke-Download $ManifestUrl $manifestPath

$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
Assert-Manifest $manifest

Assert-HttpsUrl $manifest.installer "Installer URL"

$installerName = Split-Path ([Uri]$manifest.installer).AbsolutePath -Leaf
if (-not $installerName) {
    $installerName = "OpenDrSai-setup.exe"
}
$installerPath = Join-Path $DownloadDir $installerName

Write-Step "Downloading OpenDrSai $($manifest.version)..."
Invoke-Download $manifest.installer $installerPath

$actualSize = (Get-Item $installerPath).Length
$expectedSize = [int64]$manifest.sizeBytes
if ($actualSize -ne $expectedSize) {
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    throw "Installer size mismatch. Expected $expectedSize bytes, got $actualSize bytes."
}

Write-Step "Verifying SHA256..."
$actualHash = (Get-FileHash -Algorithm SHA256 -Path $installerPath).Hash.ToLowerInvariant()
$expectedHash = ([string]$manifest.sha256).ToLowerInvariant()
if ($actualHash -ne $expectedHash) {
    Remove-Item $installerPath -Force -ErrorAction SilentlyContinue
    throw "SHA256 mismatch. Expected $expectedHash, got $actualHash."
}

Write-Step "Verifying Authenticode signature..."
Assert-AuthenticodeSignature $installerPath

Write-Step "Launching full installer..."
$args = if ($Quiet) { @("/S") } else { @() }
$proc = Start-Process -FilePath $installerPath -ArgumentList $args -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    throw "Full installer failed with exit code $($proc.ExitCode)."
}

Write-Step "Installation complete."
