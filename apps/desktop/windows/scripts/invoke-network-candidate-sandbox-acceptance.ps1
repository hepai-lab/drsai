param(
    [Parameter(Mandatory=$true)][string]$ChannelManifestUrl,
    [string]$ReleaseBaseUrl = "https://download-opendrsai.ihep.ac.cn/releases",
    [string]$EvidenceRoot = "",
    [ValidateRange(300, 7200)][int]$TimeoutSeconds = 2400,
    [switch]$StopExistingSessions,
    [switch]$KeepSandboxOnPass
)

$arguments = @{
    Mode="NetworkCandidate"; ChannelManifestUrl=$ChannelManifestUrl
    ReleaseBaseUrl=$ReleaseBaseUrl; TimeoutSeconds=$TimeoutSeconds
    StopExistingSessions=$StopExistingSessions; AutomateInstaller=$true
    KeepSandboxOnPass=$KeepSandboxOnPass
}
if ($EvidenceRoot) { $arguments.EvidenceRoot = $EvidenceRoot }
& (Join-Path $PSScriptRoot "invoke-windows-sandbox-oidc-acceptance.ps1") @arguments

