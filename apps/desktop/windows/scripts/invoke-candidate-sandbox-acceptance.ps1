param(
    [Parameter(Mandatory=$true)][string]$RuntimePath,
    [string]$EvidenceRoot = "",
    [ValidateRange(300, 7200)][int]$TimeoutSeconds = 2400,
    [switch]$StopExistingSessions,
    [switch]$AutomateInstaller,
    [switch]$KeepSandboxOnPass
)

$arguments = @{
    Mode="Candidate"; RuntimePath=$RuntimePath; TimeoutSeconds=$TimeoutSeconds
    StopExistingSessions=$StopExistingSessions; AutomateInstaller=$AutomateInstaller
    KeepSandboxOnPass=$KeepSandboxOnPass
}
if ($EvidenceRoot) { $arguments.EvidenceRoot = $EvidenceRoot }
& (Join-Path $PSScriptRoot "invoke-windows-sandbox-oidc-acceptance.ps1") @arguments

