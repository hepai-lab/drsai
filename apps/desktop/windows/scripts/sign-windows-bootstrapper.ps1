param(
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$RequireSigned = $env:REQUIRE_SIGNED_WINDOWS_ARTIFACTS -eq "1"
$CertificateBase64 = $env:WINDOWS_CERTIFICATE
$CertificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD
$ExpectedThumbprint = ($env:EXPECTED_WINDOWS_SIGNER_THUMBPRINT -replace "[^0-9A-Fa-f]", "").ToUpperInvariant()
$ExpectedSubject = [string]$env:EXPECTED_WINDOWS_SIGNER_SUBJECT
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Bootstrapper = Join-Path $Root "release\bootstrapper\OpenDrSaiSetup-win-x64.msi"

if (-not $ValidateOnly -and -not (Test-Path $Bootstrapper -PathType Leaf)) {
    throw "Bootstrapper MSI not found: $Bootstrapper"
}
if (-not $CertificateBase64 -or -not $CertificatePassword) {
    $message = "WINDOWS_CERTIFICATE and WINDOWS_CERTIFICATE_PASSWORD are required to sign the bootstrapper MSI."
    if ($RequireSigned -or $ValidateOnly) { throw $message }
    Write-Warning "$message Skipping because REQUIRE_SIGNED_WINDOWS_ARTIFACTS is not 1."
    exit 0
}

function Find-Signtool {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    $candidate = Get-ChildItem -Path $kitsRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw "signtool.exe was not found. Install Windows SDK or add signtool.exe to PATH."
}

$signtool = Find-Signtool
$pfx = Join-Path ([IO.Path]::GetTempPath()) ("opendrsai-signing-{0}.pfx" -f ([Guid]::NewGuid()))
$securePassword = ConvertTo-SecureString $CertificatePassword -AsPlainText -Force
$thumbprint = $null
$imported = $null

try {
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($CertificateBase64))
    $probe = [Security.Cryptography.X509Certificates.X509Certificate2]::new($pfx, $CertificatePassword, [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
    try {
        $thumbprint = $probe.Thumbprint
        $subject = $probe.Subject
        $notAfter = $probe.NotAfter.ToUniversalTime()
        if (-not $probe.HasPrivateKey) { throw "Windows signing certificate does not contain a private key." }
        if ($probe.NotBefore.ToUniversalTime() -gt [DateTime]::UtcNow -or $notAfter -le [DateTime]::UtcNow) { throw "Windows signing certificate is outside its validity period." }
        $codeSigningEkus = @(
            $probe.Extensions |
                Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension] } |
                ForEach-Object { $_.EnhancedKeyUsages } |
                Where-Object { $_.Value -eq "1.3.6.1.5.5.7.3.3" }
        )
        if ($codeSigningEkus.Count -eq 0) { throw "Windows signing certificate does not include the Code Signing EKU." }
        if ($ExpectedThumbprint -and $thumbprint -ne $ExpectedThumbprint) { throw "PFX signer thumbprint does not match EXPECTED_WINDOWS_SIGNER_THUMBPRINT." }
        if ($ExpectedSubject -and -not $subject.Contains($ExpectedSubject)) { throw "PFX signer subject does not match EXPECTED_WINDOWS_SIGNER_SUBJECT." }
    } finally {
        $probe.Dispose()
    }

    if ($ValidateOnly) {
        [pscustomobject]@{
            schemaVersion = 1
            valid = $true
            signerThumbprint = $thumbprint
            signerSubject = $subject
            certificateNotAfter = $notAfter.ToString("o")
            passwordInChildProcess = $false
            temporaryPfxRemovedBeforeSigning = $true
        } | ConvertTo-Json -Depth 4
        return
    }

    $existing = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
    if (-not $existing -or -not $existing.HasPrivateKey) {
        $imported = Import-PfxCertificate -FilePath $pfx -CertStoreLocation "Cert:\CurrentUser\My" -Password $securePassword -Exportable:$false
    }
    Remove-Item -LiteralPath $pfx -Force

    & $signtool sign /sha1 $thumbprint /s My /fd SHA256 /td SHA256 /tr $TimestampUrl $Bootstrapper
    if ($LASTEXITCODE -ne 0) { throw "signtool sign failed with exit code $LASTEXITCODE" }
    & $signtool verify /pa $Bootstrapper
    if ($LASTEXITCODE -ne 0) { throw "signtool verify failed with exit code $LASTEXITCODE" }
    $signature = Get-AuthenticodeSignature -LiteralPath $Bootstrapper
    if (-not $signature.TimeStamperCertificate) { throw "Signed bootstrapper does not contain a verifiable RFC 3161 timestamp." }
    Write-Host "Signed bootstrapper MSI: $Bootstrapper" -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
    if ($imported -and $thumbprint) { Remove-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -Force -ErrorAction SilentlyContinue }
    $CertificateBase64 = $null
    $CertificatePassword = $null
    $securePassword.Dispose()
}
