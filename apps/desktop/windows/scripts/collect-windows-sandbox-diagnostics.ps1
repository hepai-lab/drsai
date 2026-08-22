param(
    [Parameter(Mandatory=$true)][string]$EvidenceDir,
    [Parameter(Mandatory=$true)][string]$RunId,
    [string]$Phase = "manual",
    [ValidateRange(1, 24)][int]$EventHours = 6,
    [string]$DrsaiHomeOverride = "",
    [string]$InstallRootOverride = "",
    [string]$MachineLogsOverride = "",
    [switch]$SkipScreenshot,
    [switch]$SkipNetworkProbes,
    [switch]$SkipWindowsEvents
)

$ErrorActionPreference = "Continue"
$EvidenceDir = [IO.Path]::GetFullPath($EvidenceDir)
$drsaiHome = if ($DrsaiHomeOverride) { [IO.Path]::GetFullPath($DrsaiHomeOverride) } else { Join-Path $env:USERPROFILE ".drsai" }
$installRoot = if ($InstallRootOverride) { [IO.Path]::GetFullPath($InstallRootOverride) } else { "C:\Program Files\OpenDrSai" }
$machineLogs = if ($MachineLogsOverride) { [IO.Path]::GetFullPath($MachineLogsOverride) } else { "C:\ProgramData\OpenDrSai\Installer\logs" }
$startedAt = [DateTime]::UtcNow
$errors = [Collections.Generic.List[string]]::new()

function New-Directory([string]$Path) {
    [IO.Directory]::CreateDirectory($Path) | Out-Null
}

function Redact-Text([string]$Text) {
    if ($null -eq $Text) { return "" }
    $safe = $Text
    $safe = $safe -replace '(?i)(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._~+/=-]+', '$1[REDACTED]'
    $safe = $safe -replace '(?i)("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|password|secret)"?\s*[:=]\s*"?)[^\s,";}]+' , '$1[REDACTED]'
    $safe = $safe -replace '(?i)(X-OpenDrSai-Gateway-Token\s*[:=]\s*)[A-Za-z0-9_-]+', '$1[REDACTED]'
    $safe = $safe -replace [regex]::Escape($env:USERPROFILE), '%USERPROFILE%'
    return $safe
}

function Write-Utf8([string]$Path, [string]$Content) {
    New-Directory (Split-Path -Parent $Path)
    [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Get-ShortHash([string]$Value) {
    if (-not $Value) { return "" }
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace("-", "").Substring(0, 16).ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function Copy-Redacted([string]$Source, [string]$Destination) {
    try {
        $content = Get-Content -LiteralPath $Source -Raw -Encoding UTF8 -ErrorAction Stop
        Write-Utf8 $Destination (Redact-Text $content)
    } catch {
        $errors.Add("copy:$Source`: $($_.Exception.Message)") | Out-Null
    }
}

New-Directory $EvidenceDir
foreach ($name in @("app", "gateway", "agent", "config-sanitized", "installer", "network", "windows-events", "screenshots")) {
    New-Directory (Join-Path $EvidenceDir $name)
}

if (-not $SkipScreenshot) { try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
        $safePhase = $Phase -replace '[^A-Za-z0-9._-]', '_'
        $bitmap.Save((Join-Path $EvidenceDir "screenshots\$safePhase.png"), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
} catch { $errors.Add("screenshot: $($_.Exception.Message)") | Out-Null } }

try {
    $system = [ordered]@{
        runId = $RunId
        phase = $Phase
        collectedAt = $startedAt.ToString("o")
        username = $env:USERNAME
        sandboxIdentity = ($env:USERNAME -eq "WDAGUtilityAccount")
        windowsVersion = [Environment]::OSVersion.Version.ToString()
        architecture = $env:PROCESSOR_ARCHITECTURE
        computerNameHash = if ($env:COMPUTERNAME) {
            $bytes = [Text.Encoding]::UTF8.GetBytes($env:COMPUTERNAME)
            $sha = [Security.Cryptography.SHA256]::Create()
            try { ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").Substring(0, 16).ToLowerInvariant() } finally { $sha.Dispose() }
        } else { "" }
    }
    Write-Utf8 (Join-Path $EvidenceDir "system.json") (($system | ConvertTo-Json -Depth 5) + "`n")
} catch { $errors.Add("system: $($_.Exception.Message)") | Out-Null }

try {
    $processes = Get-CimInstance Win32_Process -ErrorAction Stop |
        Where-Object { $_.Name -match 'OpenDrSai|python|msiexec|WindowsSandbox' } |
        ForEach-Object { [ordered]@{
            name = $_.Name; pid = $_.ProcessId; parentPid = $_.ParentProcessId
            executable = Redact-Text ([string]$_.ExecutablePath)
            commandLine = Redact-Text ([string]$_.CommandLine)
        }}
    Write-Utf8 (Join-Path $EvidenceDir "app\processes.json") (($processes | ConvertTo-Json -Depth 5) + "`n")
} catch { $errors.Add("processes: $($_.Exception.Message)") | Out-Null }

try {
    $connections = Get-NetTCPConnection -State Listen,Established -ErrorAction Stop |
        Where-Object { $_.OwningProcess -in @((Get-Process OpenDrSai,python -ErrorAction SilentlyContinue).Id) } |
        Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess
    Write-Utf8 (Join-Path $EvidenceDir "network\connections.json") (($connections | ConvertTo-Json -Depth 4) + "`n")
} catch { $errors.Add("network: $($_.Exception.Message)") | Out-Null }

if (-not $SkipNetworkProbes) { try {
    $networkTests = foreach ($probe in @(
        [ordered]@{ uri = "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json"; method = "Head" },
        [ordered]@{ uri = "https://ai-dev.ihep.ac.cn/api/.well-known/openid-configuration"; method = "Get" },
        [ordered]@{ uri = "https://ai-dev.ihep.ac.cn/apiv2/v1/models"; method = "Get" }
    )) {
        $uri = [string]$probe.uri
        $method = [string]$probe.method
        $watch = [Diagnostics.Stopwatch]::StartNew()
        try {
            $response = Invoke-WebRequest -Uri $uri -Method $method -UseBasicParsing -TimeoutSec 15 -MaximumRedirection 5
            [ordered]@{ uri = $uri; method = $method; reachable = $true; status = [int]$response.StatusCode; elapsedMs = $watch.ElapsedMilliseconds }
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
            [ordered]@{ uri = $uri; method = $method; reachable = ($status -gt 0); status = $status; elapsedMs = $watch.ElapsedMilliseconds; error = Redact-Text $_.Exception.Message }
        }
    }
    Write-Utf8 (Join-Path $EvidenceDir "network\endpoints.json") (($networkTests | ConvertTo-Json -Depth 5) + "`n")
} catch { $errors.Add("network-tests: $($_.Exception.Message)") | Out-Null } }

try {
    $tree = if (Test-Path -LiteralPath $drsaiHome) {
        Get-ChildItem -LiteralPath $drsaiHome -Recurse -Force -ErrorAction SilentlyContinue |
            ForEach-Object { [ordered]@{
                path = (Redact-Text $_.FullName)
                type = if ($_.PSIsContainer) { "directory" } else { "file" }
                size = if ($_.PSIsContainer) { 0 } else { $_.Length }
                modifiedAt = $_.LastWriteTimeUtc.ToString("o")
            }}
    } else { @() }
    Write-Utf8 (Join-Path $EvidenceDir "app\drsai-home-tree.json") (($tree | ConvertTo-Json -Depth 4) + "`n")
} catch { $errors.Add("tree: $($_.Exception.Message)") | Out-Null }

foreach ($relative in @("config.toml", "config.yaml", "configs\agents\agent_opendrsai.toml")) {
    $source = Join-Path $drsaiHome $relative
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Redacted $source (Join-Path $EvidenceDir ("config-sanitized\" + ($relative -replace '[\\/]', '__')))
    }
}

try {
    $authPath = Join-Path $drsaiHome "auth\auth.json"
    $metadata = [ordered]@{ exists = (Test-Path -LiteralPath $authPath); authenticated = $false; authMode = ""; issuerHash = ""; clientIdHash = ""; subjectHash = ""; expiresAt = ""; scopes = @(); accessTokenPresent = $false; refreshTokenPresent = $false; encryptedTokens = $false; acl = @() }
    if ($metadata.exists) {
        $auth = Get-Content -LiteralPath $authPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $metadata.authenticated = [bool]$auth.authenticated
        $metadata.authMode = [string]$auth.authMode
        $metadata.issuerHash = Get-ShortHash ([string]$auth.issuer)
        $metadata.clientIdHash = Get-ShortHash ([string]$auth.clientId)
        $metadata.subjectHash = Get-ShortHash ([string]$(if ($auth.subject) { $auth.subject } elseif ($auth.profile -and $auth.profile.sub) { $auth.profile.sub } else { "" }))
        $metadata.expiresAt = [string]$auth.expiresAt
        $metadata.scopes = @($(if ($auth.scopes) { $auth.scopes } elseif ($auth.scope) { ([string]$auth.scope -split '\s+') } else { @() }))
        $metadata.accessTokenPresent = [bool]($auth.accessToken -or $auth.encryptedAccessToken)
        $metadata.refreshTokenPresent = [bool]($auth.refreshToken -or $auth.encryptedRefreshToken)
        $metadata.encryptedTokens = [bool]($auth.encryptedAccessToken -or $auth.encryptedRefreshToken -or $auth.encryptedIdToken)
        $metadata.acl = @((Get-Acl -LiteralPath $authPath).Access | ForEach-Object { [ordered]@{ identity = [string]$_.IdentityReference; rights = [string]$_.FileSystemRights; type = [string]$_.AccessControlType } })
    }
    Write-Utf8 (Join-Path $EvidenceDir "app\auth-metadata.json") (($metadata | ConvertTo-Json -Depth 6) + "`n")
} catch { $errors.Add("auth-metadata: $($_.Exception.Message)") | Out-Null }

foreach ($source in @(
    (Join-Path $drsaiHome "logs\gateway.log"),
    (Join-Path $drsaiHome "logs\gateway.log.1"),
    (Join-Path $drsaiHome "logs\agent-telemetry.jsonl"),
    (Join-Path $drsaiHome "logs\model-catalog-status.json")
)) {
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        $folder = if ($source -match 'agent-telemetry') { "agent" } elseif ($source -match 'model-catalog-status') { "app" } else { "gateway" }
        Copy-Redacted $source (Join-Path $EvidenceDir "$folder\$([IO.Path]::GetFileName($source))")
    }
}

foreach ($sourceDir in @((Join-Path $drsaiHome "desktop\diagnostics"), $machineLogs)) {
    if (-not (Test-Path -LiteralPath $sourceDir -PathType Container)) { continue }
    Get-ChildItem -LiteralPath $sourceDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
        $folder = if ($sourceDir -eq $machineLogs) { "installer" } else { "app" }
        Copy-Redacted $_.FullName (Join-Path $EvidenceDir "$folder\$($_.Name)")
    }
}

if (Test-Path -LiteralPath (Join-Path $installRoot "install-state.json")) {
    Copy-Redacted (Join-Path $installRoot "install-state.json") (Join-Path $EvidenceDir "installer\install-state.json")
}

function Export-EventLog([string]$LogName, [string]$OutputName, [string]$Filter = "") {
    try {
        $since = (Get-Date).AddHours(-$EventHours)
        $events = Get-WinEvent -FilterHashtable @{ LogName = $LogName; StartTime = $since } -ErrorAction Stop |
            Where-Object { -not $Filter -or $_.ProviderName -match $Filter -or $_.Message -match 'OpenDrSai|python.exe|msiexec' } |
            Select-Object -First 300 |
            ForEach-Object { [ordered]@{ time = $_.TimeCreated.ToUniversalTime().ToString("o"); provider = $_.ProviderName; id = $_.Id; level = $_.LevelDisplayName; message = Redact-Text $_.Message } }
        Write-Utf8 (Join-Path $EvidenceDir "windows-events\$OutputName.json") (($events | ConvertTo-Json -Depth 5) + "`n")
    } catch {
        Write-Utf8 (Join-Path $EvidenceDir "windows-events\$OutputName.json") "[]`n"
        $errors.Add("events:$LogName`: $($_.Exception.Message)") | Out-Null
    }
}
if ($SkipWindowsEvents) {
    foreach ($name in @("application", "code-integrity", "defender")) { Write-Utf8 (Join-Path $EvidenceDir "windows-events\$name.json") "[]`n" }
} else {
    Export-EventLog "Application" "application" 'MsiInstaller|Application Error|\.NET Runtime|Windows Error Reporting'
    Export-EventLog "Microsoft-Windows-CodeIntegrity/Operational" "code-integrity"
    Export-EventLog "Microsoft-Windows-Windows Defender/Operational" "defender"
}

try {
    $resolvedInputPath = Join-Path $EvidenceDir "resolved-input.json"
    $resolved = if (Test-Path $resolvedInputPath) { Get-Content $resolvedInputPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }
    $downloadPath = Join-Path $EvidenceDir "download-evidence.json"
    $download = if (Test-Path $downloadPath) { Get-Content $downloadPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $statePath = Join-Path $installRoot "install-state.json"
    $state = if (Test-Path $statePath) { Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $manifest = [ordered]@{
        schemaVersion = 1; runId = $RunId; startedAt = [string]$resolved.createdAt; collectedAt = [DateTime]::UtcNow.ToString("o")
        mode = [string]$resolved.mode; testLine = $(if ([string]$resolved.mode -eq "online") { "A-online-baseline" } else { "B-candidate" })
        expectedVersion = [string]$resolved.expectedVersion; installedVersion = [string]$state.version
        architecture = $env:PROCESSOR_ARCHITECTURE; windowsVersion = [Environment]::OSVersion.Version.ToString(); sandboxIdentity = ($env:USERNAME -eq "WDAGUtilityAccount")
        channelManifestUrl = [string]$resolved.channelManifestUrl; releaseBaseUrl = [string]$resolved.releaseBaseUrl
        installer = if ($download) { [ordered]@{ url=[string]$download.url; path=[IO.Path]::GetFileName([string]$download.path); size=[long]$download.size; sha256=[string]$download.sha256; signatureStatus=[string]$download.signatureStatus } } else { $null }
        git = [ordered]@{ commit=[string]$resolved.gitCommit; dirty=[bool]$resolved.gitDirty }
        excludedAssets = @("Android", "macOS")
    }
    Write-Utf8 (Join-Path $EvidenceDir "run-manifest.json") (($manifest | ConvertTo-Json -Depth 8) + "`n")
} catch { $errors.Add("run-manifest: $($_.Exception.Message)") | Out-Null }

$secretFindings = [Collections.Generic.List[object]]::new()
Get-ChildItem -LiteralPath $EvidenceDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Name -in @("checksums.txt", "collection-result.json")) { return }
    try {
        $content = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 -ErrorAction Stop
        if ($content -match '(?i)authorization\s*[:=]\s*bearer\s+(?!\[REDACTED\])\S+' -or
            $content -match '(?i)"?(?:access[_-]?token|refresh[_-]?token|api[_-]?key)"?\s*[:=]\s*"?(?!\[REDACTED\]|false|true|null)[A-Za-z0-9._~+/=-]{12,}') {
            $secretFindings.Add([ordered]@{ file = $_.FullName.Substring($EvidenceDir.Length + 1); finding = "secret-shaped value" }) | Out-Null
        }
    } catch { }
}

$checksums = Get-ChildItem -LiteralPath $EvidenceDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object Name -NotIn @("checksums.txt", "collection-result.json") |
    Sort-Object FullName |
    ForEach-Object { "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring($EvidenceDir.Length + 1).Replace('\','/') }
Write-Utf8 (Join-Path $EvidenceDir "checksums.txt") (($checksums -join "`n") + "`n")

$result = [ordered]@{
    schemaVersion = 1; runId = $RunId; phase = $Phase; collectedAt = [DateTime]::UtcNow.ToString("o")
    passed = ($secretFindings.Count -eq 0); secretFindingCount = $secretFindings.Count
    secretFindings = $secretFindings; warnings = $errors; fileCount = @(Get-ChildItem $EvidenceDir -Recurse -File).Count
}
Write-Utf8 (Join-Path $EvidenceDir "collection-result.json") (($result | ConvertTo-Json -Depth 8) + "`n")
$summary = @(
    "# OpenDrSai Windows Sandbox diagnostics", "", "- Run ID: $RunId", "- Phase: $Phase",
    "- Collected: $($result.collectedAt)", "- Secret scan: $(if($result.passed){'PASS'}else{'FAIL'})",
    "- Files: $($result.fileCount)", "- Warnings: $($errors.Count)"
) -join "`n"
Write-Utf8 (Join-Path $EvidenceDir "summary.md") ($summary + "`n")
$checksums = Get-ChildItem -LiteralPath $EvidenceDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object Name -ne "checksums.txt" | Sort-Object FullName |
    ForEach-Object { "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring($EvidenceDir.Length + 1).Replace('\','/') }
Write-Utf8 (Join-Path $EvidenceDir "checksums.txt") (($checksums -join "`n") + "`n")
if (-not $result.passed) { throw "Diagnostic evidence secret scan failed." }
Write-Host "Sandbox diagnostics collected at $EvidenceDir" -ForegroundColor Green
