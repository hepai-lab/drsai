param(
    [string]$CertificateBase64 = $env:WINDOWS_CERTIFICATE,
    [string]$CertificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD,
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

$RequireSigned = $env:REQUIRE_SIGNED_WINDOWS_ARTIFACTS -eq "1"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Bootstrapper = Join-Path $Root "release\bootstrapper\OpenDrSai Installer.exe"

if (-not (Test-Path $Bootstrapper)) {
    throw "Bootstrapper not found: $Bootstrapper"
}

if (-not $CertificateBase64 -or -not $CertificatePassword) {
    $message = "WINDOWS_CERTIFICATE and WINDOWS_CERTIFICATE_PASSWORD are required to sign the bootstrapper."
    if ($RequireSigned) {
        throw $message
    }
    Write-Warning "$message Skipping because REQUIRE_SIGNED_WINDOWS_ARTIFACTS is not 1."
    exit 0
}

function Find-Signtool {
    $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
    if (Test-Path $kitsRoot) {
        $candidate = Get-ChildItem -Path $kitsRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($candidate) { return $candidate.FullName }
    }

    throw "signtool.exe was not found. Install Windows SDK or add signtool.exe to PATH."
}

$signtool = Find-Signtool
$pfx = Join-Path ([IO.Path]::GetTempPath()) ("opendrsai-signing-{0}.pfx" -f ([Guid]::NewGuid()))

try {
    [IO.File]::WriteAllBytes($pfx, [Convert]::FromBase64String($CertificateBase64))
    & $signtool sign /fd SHA256 /td SHA256 /tr $TimestampUrl /f $pfx /p $CertificatePassword $Bootstrapper
    if ($LASTEXITCODE -ne 0) {
        throw "signtool sign failed with exit code $LASTEXITCODE"
    }

    & $signtool verify /pa $Bootstrapper
    if ($LASTEXITCODE -ne 0) {
        throw "signtool verify failed with exit code $LASTEXITCODE"
    }

    Write-Host "Signed bootstrapper: $Bootstrapper" -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $pfx -Force -ErrorAction SilentlyContinue
}
