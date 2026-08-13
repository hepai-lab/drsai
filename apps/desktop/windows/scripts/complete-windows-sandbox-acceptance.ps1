param(
    [Parameter(Mandatory=$true)][string]$EvidenceDir,
    [Parameter(Mandatory=$true)][string]$RunId,
    [ValidateSet("PASS", "FAIL")][string]$ManualOutcome,
    [string]$ManualNote = ""
)

$ErrorActionPreference = "Continue"
$checks = [Collections.Generic.List[object]]::new()
$packageDir = "C:\OpenDrSaiPackage"
$installRoot = "C:\Program Files\OpenDrSai"
$drsaiHome = Join-Path $env:USERPROFILE ".drsai"
$resolvedInputPath = Join-Path $EvidenceDir "resolved-input.json"
$inputPath = if (Test-Path $resolvedInputPath) { $resolvedInputPath } else { Join-Path $packageDir "acceptance-input.json" }
$input = if (Test-Path $inputPath) { Get-Content $inputPath -Raw -Encoding UTF8 | ConvertFrom-Json } else { [pscustomobject]@{} }

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail = "", [string]$Evidence = "", [string]$FailureCode = "ACCEPTANCE_CHECK_FAILED") {
    $checks.Add([ordered]@{
        name=$Name; status=$(if($Passed){"PASS"}else{"FAIL"}); checkedAt=[DateTime]::UtcNow.ToString("o")
        detail=$Detail; evidence=$Evidence; diagnosticCode=$(if($Passed){""}else{$FailureCode})
    }) | Out-Null
}

Add-Check "Manual OIDC, chat and restart acceptance" ($ManualOutcome -eq "PASS") $ManualNote "manual" "MANUAL_ACCEPTANCE_FAILED"
Add-Check "Windows Sandbox identity" ($env:USERNAME -eq "WDAGUtilityAccount") $env:USERNAME "system.json" "NOT_WINDOWS_SANDBOX"

$statePath = Join-Path $installRoot "install-state.json"
Add-Check "Install state exists" (Test-Path -LiteralPath $statePath -PathType Leaf) $statePath "installer/install-state.json" "INSTALL_STATE_MISSING"
$state = $null
try { if (Test-Path $statePath) { $state = Get-Content $statePath -Raw -Encoding UTF8 | ConvertFrom-Json } } catch { }
$expectedVersion = [string]$input.expectedVersion
Add-Check "Installed version" ($state -and (!$expectedVersion -or [string]$state.version -eq $expectedVersion)) ([string]$state.version) "installer/install-state.json" "INSTALLED_VERSION_MISMATCH"
Add-Check "Desktop executable" ($state -and (Test-Path -LiteralPath ([string]$state.desktopPath) -PathType Leaf)) ([string]$state.desktopPath) "app/processes.json" "DESKTOP_EXECUTABLE_MISSING"
$setupFiles = @("install-opendrsai.ps1", "uninstall-opendrsai.ps1", "run-opendrsai-install.vbs", "run-opendrsai-uninstall.vbs")
$missingSetupFiles = @($setupFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $installRoot $_) -PathType Leaf) })
Add-Check "Installer support files colocated" ($missingSetupFiles.Count -eq 0) ($missingSetupFiles -join ",") "installer/install-state.json" "INSTALLER_SUPPORT_FILES_MISSING"
$startMenuShortcut = Get-ChildItem "C:\ProgramData\Microsoft\Windows\Start Menu\Programs" -Filter "*OpenDrSai*.lnk" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
Add-Check "Start menu shortcut" ([bool]$startMenuShortcut) ([string]$startMenuShortcut.FullName) "app/processes.json" "START_MENU_SHORTCUT_MISSING"
$runtimePython = Get-ChildItem $installRoot -Filter python.exe -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
Add-Check "Bundled Runtime Python" ([bool]$runtimePython) ([string]$runtimePython.FullName) "installer/install-state.json" "RUNTIME_PYTHON_MISSING"

$configPath = Join-Path $drsaiHome "config.toml"
$agentPath = Join-Path $drsaiHome "configs\agents\agent_opendrsai.toml"
$configText = if (Test-Path $configPath) { Get-Content $configPath -Raw -Encoding UTF8 } else { "" }
$agentText = if (Test-Path $agentPath) { Get-Content $agentPath -Raw -Encoding UTF8 } else { "" }
Add-Check "Compact config exists" ([bool]$configText) $configPath "config-sanitized/config.toml"
Add-Check "Default Agent bound" ($configText -match '(?m)^current_agent\s*=\s*"opendrsai"\s*$') "opendrsai" "config-sanitized/config.toml"
Add-Check "HepAI Provider selected" ($configText -match '(?m)^model_provider\s*=\s*"hepai"\s*$') "hepai" "config-sanitized/config.toml"
Add-Check "API Key not required" ($configText -match '(?m)^requires_api_key\s*=\s*false\s*$' -and $configText -notmatch 'legacy-anthropic|ANTHROPIC_API_KEY') "OIDC" "config-sanitized/config.toml"
Add-Check "Default Agent file exists" ([bool]$agentText) $agentPath "config-sanitized/configs__agents__agent_opendrsai.toml"
Add-Check "Default Agent model is explicit HepAI" ($agentText -match '(?m)^provider_id\s*=\s*"hepai"\s*$' -and $agentText -match '(?m)^mode\s*=\s*"explicit"\s*$') "hepai" "config-sanitized/configs__agents__agent_opendrsai.toml"

$authPath = Join-Path $drsaiHome "auth\auth.json"
$auth = $null
try { if (Test-Path $authPath) { $auth = Get-Content $authPath -Raw -Encoding UTF8 | ConvertFrom-Json } } catch { }
$tokenPresent = $auth -and ($auth.accessToken -or $auth.encryptedAccessToken)
Add-Check "OIDC session persisted" ($auth -and $auth.authenticated -and $auth.authMode -eq "oidc" -and $tokenPresent) ([string]$auth.authMode) "app/auth-metadata.json" "OIDC_TOKEN_MISSING_OR_EXPIRED"

$gatewayHeaders = @{}
$gatewayTokenPath = Join-Path $drsaiHome "runtime\instance-token"
if (Test-Path $gatewayTokenPath) { $gatewayHeaders["X-OpenDrSai-Gateway-Token"] = (Get-Content $gatewayTokenPath -Raw).Trim() }
function Invoke-Local([string]$Path) {
    try { return Invoke-RestMethod -Uri "http://127.0.0.1:18642$Path" -Headers $gatewayHeaders -TimeoutSec 15 }
    catch { return $null }
}
$health = Invoke-Local "/health"
Add-Check "Gateway ready" ($health -and $health.status -eq "ok") ([string]$health.status) "gateway/gateway.log" "GATEWAY_NOT_READY"
$gatewayListeners = @(Get-NetTCPConnection -State Listen -LocalPort 18642 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
Add-Check "Single Gateway listener" ($gatewayListeners.Count -eq 1) ($gatewayListeners -join ",") "network/connections.json" "GATEWAY_PORT_CONFLICT"
$agents = Invoke-Local "/v1/config/agents"
Add-Check "Gateway resolves current Agent" ($agents -and $agents.current_agent -eq "opendrsai" -and @($agents.agents).Count -gt 0) ([string]$agents.current_agent) "gateway/gateway.log"
$modelState = Invoke-Local "/v1/config/model-state"
Add-Check "Gateway resolves HepAI model" ($modelState -and $modelState.effective.model_provider -eq "hepai" -and -not $modelState.effective.provider.requires_api_key) ([string]$modelState.effective.model) "gateway/gateway.log"
$modelCatalogStatusPath = Join-Path $drsaiHome "logs\model-catalog-status.json"
$modelCatalogStatus = $null
try { if (Test-Path $modelCatalogStatusPath) { $modelCatalogStatus = Get-Content $modelCatalogStatusPath -Raw -Encoding UTF8 | ConvertFrom-Json } } catch { }
Add-Check "Runtime model catalog non-empty" ($modelCatalogStatus -and $modelCatalogStatus.authMode -eq "oidc" -and $modelCatalogStatus.state -eq "ready" -and [int]$modelCatalogStatus.modelCount -gt 0) ("state=" + [string]$modelCatalogStatus.state + "; count=" + [string]$modelCatalogStatus.modelCount) "app/model-catalog-status.json" "MODEL_CATALOG_UNAVAILABLE"

$telemetryPath = Join-Path $drsaiHome "logs\agent-telemetry.jsonl"
$completed = $false
$correlated = $false
if (Test-Path $telemetryPath) {
    Get-Content $telemetryPath -Tail 200 | ForEach-Object {
        try {
            $row = $_ | ConvertFrom-Json
            if ($row.event -eq "execution_completed" -and $row.agentId -eq "opendrsai") {
                $completed = $true
                if ($row.acceptanceRunId -eq $RunId -and $row.requestId -and $row.runId) { $correlated = $true }
            }
        } catch { }
    }
}
Add-Check "Real OpenDrSai execution completed" $completed "agent=opendrsai" "agent/agent-telemetry.jsonl" "CHAT_EXECUTION_NOT_COMPLETED"
Add-Check "Chat evidence correlated" $correlated "acceptanceRunId=$RunId" "agent/agent-telemetry.jsonl" "CHAT_EVIDENCE_NOT_CORRELATED"

$collector = Join-Path $packageDir "collect-windows-sandbox-diagnostics.ps1"
if (Test-Path $collector) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $collector -EvidenceDir $EvidenceDir -RunId $RunId -Phase "final"
}
$collectionPath = Join-Path $EvidenceDir "collection-result.json"
$collection = $null
try { if (Test-Path $collectionPath) { $collection = Get-Content $collectionPath -Raw -Encoding UTF8 | ConvertFrom-Json } } catch { }
Add-Check "Diagnostic evidence redaction" ($collection -and $collection.passed) ("findings=" + [string]$collection.secretFindingCount) "collection-result.json" "DIAGNOSTIC_REDACTION_FAILED"
Add-Check "Run manifest generated" (Test-Path (Join-Path $EvidenceDir "run-manifest.json")) "run-manifest.json" "run-manifest.json" "RUN_MANIFEST_MISSING"

$failed = @($checks | Where-Object status -eq "FAIL")
$result = [ordered]@{
    schemaVersion=1; runId=$RunId; generatedAt=[DateTime]::UtcNow.ToString("o")
    passed=($failed.Count -eq 0); manualOutcome=$ManualOutcome; expectedVersion=$expectedVersion
    checks=$checks; failedCount=$failed.Count
}
[IO.File]::WriteAllText((Join-Path $EvidenceDir "acceptance-result.json"), (($result | ConvertTo-Json -Depth 8) + "`n"), [Text.UTF8Encoding]::new($false))
$summaryLines = @(
    "# OpenDrSai Windows Sandbox acceptance", "", "- Run ID: $RunId", "- Generated: $($result.generatedAt)",
    "- Outcome: $(if($result.passed){'PASS'}else{'FAIL'})", "- Expected version: $expectedVersion", "", "## Checks", ""
)
$summaryLines += @($checks | ForEach-Object { "- [$($_.status)] $($_.name): $($_.detail)$(if($_.diagnosticCode){' (' + $_.diagnosticCode + ')'}else{''})" })
[IO.File]::WriteAllText((Join-Path $EvidenceDir "summary.md"), (($summaryLines -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
$checksumLines = Get-ChildItem -LiteralPath $EvidenceDir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object Name -ne "checksums.txt" | Sort-Object FullName |
    ForEach-Object { "{0}  {1}" -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.FullName.Substring($EvidenceDir.Length + 1).Replace('\','/') }
[IO.File]::WriteAllText((Join-Path $EvidenceDir "checksums.txt"), (($checksumLines -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
$message = if ($result.passed) { "OpenDrSai Sandbox acceptance passed. Evidence is saved; the Sandbox may now be closed." } else { "Acceptance failed. Evidence is saved; keep the Sandbox open for inspection." }
Add-Type -AssemblyName PresentationFramework
[Windows.MessageBox]::Show($message, "OpenDrSai Sandbox Acceptance") | Out-Null
if (-not $result.passed) { exit 1 }
