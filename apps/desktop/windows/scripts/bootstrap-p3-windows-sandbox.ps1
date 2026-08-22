param(
    [Parameter(Mandatory)] [string] $PackageRoot,
    [Parameter(Mandatory)] [string] $EvidenceRoot,
    [Parameter(Mandatory)] [string] $RunId,
    [switch] $DeveloperMode,
    [string] $ProviderSource
)

$ErrorActionPreference = "Stop"
$profileRoot = "C:\P3\profile"
$installRoot = Join-Path $env:ProgramFiles "OpenDrSai"
$statusPath = Join-Path $EvidenceRoot "sandbox-bootstrap-status.json"
function Write-Status([string] $Status, [string] $Detail) {
    [ordered]@{ schemaVersion=2; status=$Status; detail=$Detail; runId=$RunId; atUtc=[DateTime]::UtcNow.ToString("o"); sandboxUser=$env:USERNAME; profile=$profileRoot; hostSessionReused=$false; packageMountedReadOnly=$true } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusPath -Encoding UTF8
}
try {
    New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
    if ($DeveloperMode) {
        if (-not $ProviderSource -or -not (Test-Path -LiteralPath (Join-Path $ProviderSource "config.toml") -PathType Leaf)) { throw "Developer Provider source is incomplete." }
        New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
        Copy-Item -LiteralPath (Join-Path $ProviderSource "config.toml") -Destination (Join-Path $profileRoot "config.toml") -Force
        if (Test-Path -LiteralPath (Join-Path $ProviderSource "configs") -PathType Container) { Copy-Item -LiteralPath (Join-Path $ProviderSource "configs") -Destination (Join-Path $profileRoot "configs") -Recurse -Force }
    }
    $descriptor = Get-Content -LiteralPath (Join-Path $PackageRoot "p3-package.json") -Raw | ConvertFrom-Json
    $runtime = Join-Path $PackageRoot $descriptor.runtime.file
    $msi = Join-Path $PackageRoot $descriptor.msi.file
    foreach ($item in @($runtime, $msi)) { if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { throw "P3 package is incomplete: $item" } }
    if ((Get-FileHash -Algorithm SHA256 $runtime).Hash.ToLowerInvariant() -ne $descriptor.runtime.sha256) { throw "Runtime SHA-256 mismatch." }
    if ((Get-FileHash -Algorithm SHA256 $msi).Hash.ToLowerInvariant() -ne $descriptor.msi.sha256) { throw "MSI SHA-256 mismatch." }
    Write-Status "installing" "Installing current-source MSI in the fresh Sandbox."
    $install = Start-Process -FilePath msiexec.exe -ArgumentList @('/i', $msi, '/qn', '/norestart') -Wait -PassThru
    if ($install.ExitCode -ne 0) { throw "MSI installation failed with exit code $($install.ExitCode)." }
    $app = Join-Path $installRoot "app\OpenDrSai.exe"
    if (-not (Test-Path -LiteralPath $app -PathType Leaf)) { throw "Installed Desktop executable is missing: $app" }
    $env:DRSAI_HOME = $profileRoot
    $env:OPENDRSAI_GATEWAY_PORT = "28643"
    $env:OPENDRSAI_ELECTRON_USER_DATA = (Join-Path $profileRoot "electron-user-data")
    New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
    Start-Process -FilePath $app | Out-Null
    $modeDetail = if ($DeveloperMode) { "Developer UI login and a real isolated Provider configuration are ready." } else { "Complete OIDC login only inside this Sandbox." }
    Write-Status "ready_for_login" "Current-source OpenDrSai Desktop has started. $modeDetail"
} catch {
    Write-Status "failed" $_.Exception.Message
    throw
}
