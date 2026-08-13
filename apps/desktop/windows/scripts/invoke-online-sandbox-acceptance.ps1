param(
    [string]$EvidenceRoot = "",
    [string]$ChannelManifestUrl = "https://download-opendrsai.ihep.ac.cn/channels/beta/latest-windows.json",
    [string]$ReleaseBaseUrl = "https://download-opendrsai.ihep.ac.cn/releases",
    [ValidateRange(300, 7200)][int]$TimeoutSeconds = 2400,
    [switch]$StopExistingSessions,
    [switch]$AutomateInstaller,
    [switch]$KeepSandboxOnPass
)

$arguments = @{
    Mode="Online"; ChannelManifestUrl=$ChannelManifestUrl; ReleaseBaseUrl=$ReleaseBaseUrl
    TimeoutSeconds=$TimeoutSeconds; StopExistingSessions=$StopExistingSessions
    AutomateInstaller=$AutomateInstaller; KeepSandboxOnPass=$KeepSandboxOnPass
}
if ($EvidenceRoot) { $arguments.EvidenceRoot = $EvidenceRoot }
& (Join-Path $PSScriptRoot "invoke-windows-sandbox-oidc-acceptance.ps1") @arguments
