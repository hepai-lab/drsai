param(
    [ValidateSet("Enable", "Disable", "Status")]
    [string]$Action = "Status",
    [int]$SshPort = 22224,
    [string]$SandboxSubnet = "172.27.96.0/20"
)

$ErrorActionPreference = "Stop"
$ruleName = "OpenDrSai Remote Workspace Acceptance SSH"
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
$isAdministrator = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if ($Action -ne "Status" -and -not $isAdministrator) {
    throw "Run this script once from an elevated PowerShell window."
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($Action -eq "Enable") {
    if ($existing) { Remove-NetFirewallRule -DisplayName $ruleName }
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Description "Allows only the Windows Sandbox subnet to reach the temporary OpenDrSai Docker SSH lab." `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $SshPort `
        -Profile Any `
        -RemoteAddress $SandboxSubnet | Out-Null
    $existing = Get-NetFirewallRule -DisplayName $ruleName
} elseif ($Action -eq "Disable") {
    if ($existing) { Remove-NetFirewallRule -DisplayName $ruleName }
    Write-Host "OpenDrSai remote workspace acceptance firewall rule removed." -ForegroundColor Green
    exit 0
}

if (-not $existing) {
    Write-Host "OpenDrSai remote workspace acceptance firewall rule is not installed."
    exit $(if ($Action -eq "Status") { 1 } else { 0 })
}

$port = $existing | Get-NetFirewallPortFilter
$address = $existing | Get-NetFirewallAddressFilter
[pscustomobject]@{
    displayName = $existing.DisplayName
    enabled = [string]$existing.Enabled
    direction = [string]$existing.Direction
    action = [string]$existing.Action
    profile = [string]$existing.Profile
    protocol = [string]$port.Protocol
    localPort = [string]$port.LocalPort
    remoteAddress = @($address.RemoteAddress)
} | ConvertTo-Json -Depth 4
