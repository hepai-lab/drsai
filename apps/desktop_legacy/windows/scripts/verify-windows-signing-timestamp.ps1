[CmdletBinding()]
param([string]$TimestampUrl = "http://timestamp.digicert.com")

$ErrorActionPreference = "Stop"
$appRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$source = Join-Path $appRoot "release\win-unpacked\OpenDrSai.exe"
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Desktop executable is missing: $source" }
$signtool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Filter signtool.exe -File -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw "Windows SDK signtool.exe was not found." }

$temporary = Join-Path ([IO.Path]::GetTempPath()) ("opendrsai-temporary-timestamp-{0}" -f ([Guid]::NewGuid()))
$certificate = $null
$thumbprint = $null
New-Item -ItemType Directory -Force -Path $temporary | Out-Null
$target = Join-Path $temporary "OpenDrSai-temporary-timestamp.exe"
$publicCertificate = Join-Path $temporary "temporary-timestamp.cer"

try {
    Copy-Item -LiteralPath $source -Destination $target
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=OpenDrSai Temporary Timestamp Contract" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddDays(1) -KeyExportPolicy NonExportable
    $thumbprint = $certificate.Thumbprint
    Export-Certificate -Cert $certificate -FilePath $publicCertificate | Out-Null
    Import-Certificate -FilePath $publicCertificate -CertStoreLocation "Cert:\CurrentUser\Root" | Out-Null
    Import-Certificate -FilePath $publicCertificate -CertStoreLocation "Cert:\CurrentUser\TrustedPublisher" | Out-Null
    & $signtool.FullName sign /sha1 $thumbprint /s My /fd SHA256 /tr $TimestampUrl /td SHA256 $target
    if ($LASTEXITCODE -ne 0) { throw "Temporary timestamp signing failed with exit code $LASTEXITCODE." }
    & $signtool.FullName verify /pa $target
    if ($LASTEXITCODE -ne 0) { throw "Temporary timestamp signature verification failed with exit code $LASTEXITCODE." }
    $signature = Get-AuthenticodeSignature -LiteralPath $target
    if ($signature.Status -ne "Valid" -or -not $signature.TimeStamperCertificate) { throw "Authenticode signature is not valid or lacks a real timestamp certificate." }
    [pscustomobject]@{
        schemaVersion = 1
        status = "passed"
        temporaryCertificate = $true
        signerThumbprint = $thumbprint
        timestampUrl = $TimestampUrl
        timestampSubject = $signature.TimeStamperCertificate.Subject
        timestampNotAfter = $signature.TimeStamperCertificate.NotAfter.ToUniversalTime().ToString("o")
        certificateRemovedAfterTest = $true
    } | ConvertTo-Json -Depth 4
} finally {
    if ($thumbprint) {
        Remove-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -Force -ErrorAction SilentlyContinue
        foreach ($store in @("Root", "TrustedPublisher")) {
            $registryPath = "HKCU:\Software\Microsoft\SystemCertificates\$store\Certificates\$thumbprint"
            if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath -Recurse -Force }
        }
    }
    if ($certificate) { $certificate.Dispose() }
    Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
}
