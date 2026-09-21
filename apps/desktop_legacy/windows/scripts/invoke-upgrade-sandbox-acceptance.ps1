param(
    [Parameter(Mandatory=$true)][string]$RuntimePath,
    [string]$EvidenceRoot = "",
    [string]$ChannelManifestUrl = "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json",
    [string]$ReleaseBaseUrl = "https://download-opendrsai.ihep.ac.cn/releases",
    [ValidateRange(300, 7200)][int]$TimeoutSeconds = 3600,
    [switch]$StopExistingSessions,
    [switch]$KeepSandboxOnPass
)

$arguments = @{
    Mode="Upgrade"; RuntimePath=$RuntimePath; ChannelManifestUrl=$ChannelManifestUrl
    ReleaseBaseUrl=$ReleaseBaseUrl; TimeoutSeconds=$TimeoutSeconds
    StopExistingSessions=$StopExistingSessions; AutomateInstaller=$true
    KeepSandboxOnPass=$KeepSandboxOnPass
}
if ($EvidenceRoot) { $arguments.EvidenceRoot = $EvidenceRoot }
& (Join-Path $PSScriptRoot "invoke-windows-sandbox-oidc-acceptance.ps1") @arguments
