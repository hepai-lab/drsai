[CmdletBinding(DefaultParameterSetName = "Pfx")]
param(
    [Parameter(Mandatory = $true, ParameterSetName = "Pfx")]
    [string]$PfxPath,
    [Parameter(Mandatory = $true, ParameterSetName = "Store")]
    [string]$CertificateThumbprint,
    [Parameter(ParameterSetName = "Store")]
    [ValidateSet("CurrentUser", "LocalMachine")]
    [string]$CertificateStoreLocation = "CurrentUser",
    [Parameter(ParameterSetName = "Pfx")]
    [string]$PasswordEnvironmentVariable = "OPENDRSAI_WINDOWS_SIGNING_PASSWORD",
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repoRoot = [IO.Path]::GetFullPath((Join-Path $appRoot "..\..\.."))
$passwordText = $null
$securePassword = $null
$imported = $null
$thumbprint = $null
$certificateStorePath = $null
$certificateSource = $PSCmdlet.ParameterSetName

$signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $signtool) { throw "Windows SDK signtool.exe (x64) was not found." }

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE." }
}

function Sign-Artifact([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Signing target does not exist: $Path" }
    $arguments = @("sign", "/sha1", $thumbprint, "/s", "My", "/fd", "SHA256")
    if ($CertificateStoreLocation -eq "LocalMachine") { $arguments += "/sm" }
    if ($TimestampUrl) { $arguments += @("/tr", $TimestampUrl, "/td", "SHA256") }
    $arguments += $Path
    Invoke-Checked $signtool.FullName $arguments
    Invoke-Checked $signtool.FullName @("verify", "/pa", $Path)
    if ($TimestampUrl) {
        $signature = Get-AuthenticodeSignature -LiteralPath $Path
        if (-not $signature.TimeStamperCertificate) { throw "Signed artifact does not contain a verifiable RFC 3161 timestamp: $Path" }
    }
}

try {
    if ($PSCmdlet.ParameterSetName -eq "Pfx") {
        $pfx = [IO.Path]::GetFullPath($PfxPath)
        if (-not (Test-Path -LiteralPath $pfx -PathType Leaf)) { throw "Windows signing PFX does not exist: $pfx" }
        $passwordText = [Environment]::GetEnvironmentVariable($PasswordEnvironmentVariable)
        if ([string]::IsNullOrWhiteSpace($passwordText)) { throw "Set $PasswordEnvironmentVariable before signing; the password is never written to disk." }
        $securePassword = ConvertTo-SecureString $passwordText -AsPlainText -Force
        $probe = [Security.Cryptography.X509Certificates.X509Certificate2]::new($pfx, $passwordText, [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
        $certificateStorePath = "Cert:\CurrentUser\My"
        $CertificateStoreLocation = "CurrentUser"
    } else {
        $normalizedThumbprint = ($CertificateThumbprint -replace "[^0-9A-Fa-f]", "").ToUpperInvariant()
        if ($normalizedThumbprint.Length -ne 40) { throw "CertificateThumbprint must be a SHA-1 certificate thumbprint." }
        $certificateStorePath = if ($CertificateStoreLocation -eq "LocalMachine") { "Cert:\LocalMachine\My" } else { "Cert:\CurrentUser\My" }
        $probe = Get-Item -LiteralPath "$certificateStorePath\$normalizedThumbprint" -ErrorAction SilentlyContinue
        if (-not $probe) { throw "Windows signing certificate was not found in $certificateStorePath." }
    }

    try {
        $thumbprint = $probe.Thumbprint
        $subject = $probe.Subject
        $issuer = $probe.Issuer
        $certificateNotAfter = $probe.NotAfter.ToUniversalTime()
        $now = [DateTime]::UtcNow
        if (-not $probe.HasPrivateKey) { throw "Windows signing certificate does not contain an accessible private key." }
        if ($probe.NotBefore.ToUniversalTime() -gt $now) { throw "Windows signing certificate is not valid yet." }
        if ($certificateNotAfter -le $now) { throw "Windows signing certificate has expired." }
        $codeSigningEkus = @(
            $probe.Extensions |
                Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension] } |
                ForEach-Object { $_.EnhancedKeyUsages } |
                Where-Object { $_.Value -eq "1.3.6.1.5.5.7.3.3" }
        )
        if ($codeSigningEkus.Count -eq 0) { throw "Windows signing certificate does not include the Code Signing EKU." }
    } finally {
        $probe.Dispose()
    }

    if ($ValidateOnly) {
        [pscustomobject]@{
            schemaVersion = 1
            valid = $true
            certificateSource = $certificateSource
            certificateStoreLocation = $CertificateStoreLocation
            signerThumbprint = $thumbprint
            signerSubject = $subject
            signerIssuer = $issuer
            certificateNotAfter = $certificateNotAfter.ToString("o")
            hasPrivateKey = $true
            codeSigningEku = $true
            passwordPersisted = $false
        } | ConvertTo-Json -Depth 4
        return
    }

    if ($PSCmdlet.ParameterSetName -eq "Pfx") {
        $existing = Get-Item -LiteralPath "$certificateStorePath\$thumbprint" -ErrorAction SilentlyContinue
        if (-not $existing -or -not $existing.HasPrivateKey) {
            $imported = Import-PfxCertificate -FilePath $pfx -CertStoreLocation $certificateStorePath -Password $securePassword -Exportable:$false
        }
    }

    $desktopExecutable = Join-Path $appRoot "release\win-unpacked\OpenDrSai.exe"
    Sign-Artifact $desktopExecutable

    $runtimeBuilder = Join-Path $repoRoot "apps\desktop\installers\windows\create-opendrsai-runtime.ps1"
    & $runtimeBuilder -DesktopAppDir (Join-Path $appRoot "release\win-unpacked")
    if (-not $?) { throw "Runtime ZIP rebuild failed." }

    $msiBuilder = Join-Path $repoRoot "apps\desktop\installers\windows\build-msi.ps1"
    & $msiBuilder -RuntimePath (Join-Path $appRoot "release\bootstrapper\OpenDrSaiRuntime-win-x64.zip")
    if (-not $?) { throw "MSI rebuild failed." }
    $msi = Join-Path $appRoot "release\bootstrapper\OpenDrSaiSetup-win-x64.msi"
    Sign-Artifact $msi

    Push-Location $appRoot
    try {
        Invoke-Checked "npm.cmd" @("run", "manifest:win")
        Invoke-Checked "npm.cmd" @("run", "summary:win")
        Invoke-Checked "npm.cmd" @("run", "verify:artifacts")
        $env:REQUIRE_SIGNED_WINDOWS_ARTIFACTS = "1"
        $env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT = $thumbprint
        $env:EXPECTED_WINDOWS_SIGNER_SUBJECT = $subject
        Invoke-Checked "npm.cmd" @("run", "verify:signatures")
    } finally {
        Pop-Location
    }

    $evidenceDir = Join-Path $appRoot "release\product-evidence\remote-workspace"
    New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
    $packageVersion = (Get-Content -LiteralPath (Join-Path $appRoot "package.json") -Raw | ConvertFrom-Json).version
    $manifest = Get-Content -LiteralPath (Join-Path $appRoot "release\latest-windows.json") -Raw | ConvertFrom-Json
    $releaseSummary = Get-Content -LiteralPath (Join-Path $appRoot "release\release-summary.json") -Raw | ConvertFrom-Json
    if ($manifest.version -ne $packageVersion -or $releaseSummary.version -ne $packageVersion) {
        throw "Signed artifact version mismatch: package=$packageVersion manifest=$($manifest.version) summary=$($releaseSummary.version)."
    }
    $runtimeZip = Join-Path $appRoot "release\bootstrapper\OpenDrSaiRuntime-win-x64.zip"
    $signedArtifacts = @(
        [ordered]@{
            kind = "desktopExecutable"
            path = "release/win-unpacked/OpenDrSai.exe"
            sizeBytes = (Get-Item -LiteralPath $desktopExecutable).Length
            sha256 = (Get-FileHash -LiteralPath $desktopExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
            authenticodeVerified = $true
        },
        [ordered]@{
            kind = "runtimeZip"
            path = "release/bootstrapper/OpenDrSaiRuntime-win-x64.zip"
            sizeBytes = (Get-Item -LiteralPath $runtimeZip).Length
            sha256 = (Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256).Hash.ToLowerInvariant()
            containsSignedDesktopExecutable = $true
            manifestDigestVerified = $true
        },
        [ordered]@{
            kind = "msi"
            path = "release/bootstrapper/OpenDrSaiSetup-win-x64.msi"
            sizeBytes = (Get-Item -LiteralPath $msi).Length
            sha256 = (Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant()
            authenticodeVerified = $true
        }
    )
    $evidence = [ordered]@{
        schemaVersion = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        signed = $true
        packageVersion = $packageVersion
        manifestVersion = $manifest.version
        releaseSummaryVersion = $releaseSummary.version
        versionConsistencyVerified = $true
        artifacts = $signedArtifacts
        certificateSource = $certificateSource
        certificateStoreLocation = $CertificateStoreLocation
        signerThumbprint = $thumbprint
        signerSubject = $subject
        signerIssuer = $issuer
        certificateNotAfter = $certificateNotAfter.ToString("o")
        timestampUrl = $TimestampUrl
        timestampVerified = $true
        codeSigningEku = $true
        immediateAuthenticodeVerification = $true
        passwordPersisted = $false
    }
    [IO.File]::WriteAllText((Join-Path $evidenceDir "windows-signatures.json"), (($evidence | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    Invoke-Checked "npm.cmd" @("run", "verify:signing-evidence")
} finally {
    Remove-Item Env:\REQUIRE_SIGNED_WINDOWS_ARTIFACTS -ErrorAction SilentlyContinue
    Remove-Item Env:\EXPECTED_WINDOWS_SIGNER_THUMBPRINT -ErrorAction SilentlyContinue
    Remove-Item Env:\EXPECTED_WINDOWS_SIGNER_SUBJECT -ErrorAction SilentlyContinue
    if ($imported) { Remove-Item -LiteralPath "$certificateStorePath\$thumbprint" -Force -ErrorAction SilentlyContinue }
    $passwordText = $null
    if ($securePassword) { $securePassword.Dispose() }
}
