param(
    [Parameter(Mandatory)] [string] $StageDir,
    [string] $SessionId = "",
    [Parameter(Mandatory)] [string] $Controller,
    [ValidateRange(60, 43200)] [int] $TimeoutSeconds = 28800
)

$ErrorActionPreference = "Stop"
$privateRoot = [IO.Path]::GetFullPath((Join-Path $env:TEMP "OpenDrSaiP3Provider"))
$resolvedStage = [IO.Path]::GetFullPath($StageDir)
if (-not $resolvedStage.StartsWith($privateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "P3 Provider staging path is outside its private temporary root."
}

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$observed = $false
while ((Get-Date) -lt $deadline) {
    $active = $false
    if ($SessionId) {
        try {
            $state = (& $Controller -Action List -AsJson) | ConvertFrom-Json
            $active = @($state.sessions | Where-Object { [string]$_.Id -eq $SessionId }).Count -gt 0
        } catch {
            $active = $true
        }
    } else {
        $active = @(
            Get-Process WindowsSandboxClient, WindowsSandboxRemoteSession -ErrorAction SilentlyContinue
        ).Count -gt 0
    }
    if ($active) {
        $observed = $true
    } elseif ($observed) {
        if (Test-Path -LiteralPath $resolvedStage -PathType Container) {
            Remove-Item -LiteralPath $resolvedStage -Recurse -Force
        }
        exit 0
    }
    Start-Sleep -Seconds 5
}

throw "Timed out waiting for the P3 Sandbox to close; private Provider staging was retained for fail-closed cleanup."
