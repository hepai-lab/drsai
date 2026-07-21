param(
    [ValidateSet("Diagnose", "RepairRegistration", "List", "Start", "Stop", "StopAll")]
    [string]$Action = "Diagnose",
    [string]$ConfigPath = "",
    [string]$Id = "",
    [ValidateRange(10, 600)]
    [int]$TimeoutSeconds = 90,
    [switch]$Force,
    [switch]$AsJson
)

$ErrorActionPreference = "Stop"
$packageName = "MicrosoftWindows.WindowsSandbox"
$packageFamilyName = "MicrosoftWindows.WindowsSandbox_cw5n1h2txyewy"
$packageCliAppId = "AppCli"

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Write-Result($Value) {
    if ($AsJson) {
        $Value | ConvertTo-Json -Depth 8 -Compress
    } else {
        $Value
    }
}

function Get-CurrentUserSandboxPackage {
    return Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Get-RecentSandboxServerCrashes {
    try {
        $since = (Get-Date).AddHours(-1)
        return @(Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = ".NET Runtime"; Id = 1026; StartTime = $since } -ErrorAction Stop |
            Where-Object { $_.Message -match "WindowsSandboxServer\.exe" } |
            Select-Object TimeCreated, Id, @{ Name = "RpcShutdownFailure"; Expression = { $_.Message -match "0x800706BF|ManagedWindowsVM\.Terminate" } })
    } catch {
        return @()
    }
}

function Quote-CmdArgument([string]$Value) {
    if ($Value -notmatch '[\s&|<>^"]') { return $Value }
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Invoke-PackagedWsbCli([string[]]$Arguments) {
    $direct = Get-Command wsb.exe -ErrorAction SilentlyContinue
    if ($direct) {
        $output = & $direct.Source @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "wsb $($Arguments -join ' ') failed with exit code $LASTEXITCODE`: $($output -join [Environment]::NewLine)"
        }
        return (($output | Out-String).Trim())
    }

    $package = Get-CurrentUserSandboxPackage
    if (-not $package) { return $null }
    if (-not (Get-Command Invoke-CommandInDesktopPackage -ErrorAction SilentlyContinue)) { return $null }

    $workRoot = Join-Path $env:TEMP "OpenDrSaiWsbCli"
    [IO.Directory]::CreateDirectory($workRoot) | Out-Null
    $token = [Guid]::NewGuid().ToString("N")
    $commandPath = Join-Path $workRoot "$token.cmd"
    $outputPath = Join-Path $workRoot "$token.out"
    $exitPath = Join-Path $workRoot "$token.exit"
    $argumentLine = (($Arguments | ForEach-Object { Quote-CmdArgument $_ }) -join " ")
    $content = @"
@echo off
wsb.exe $argumentLine > "$outputPath" 2>&1
echo %errorlevel% > "$exitPath"
"@
    [IO.File]::WriteAllText($commandPath, $content, (New-Object Text.UTF8Encoding($false)))

    try {
        Invoke-CommandInDesktopPackage -PackageFamilyName $packageFamilyName -AppId $packageCliAppId `
            -Command "cmd.exe" -Args "/d /c `"$commandPath`"" -PreventBreakaway
        $deadline = (Get-Date).AddSeconds(30)
        while (-not (Test-Path -LiteralPath $exitPath) -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 250
        }
        if (-not (Test-Path -LiteralPath $exitPath)) {
            throw "Timed out waiting for the packaged wsb CLI. Sign out and back in to refresh the wsb.exe execution alias."
        }
        $exitCode = [int](Get-Content -LiteralPath $exitPath -Raw).Trim()
        $output = if (Test-Path -LiteralPath $outputPath) { (Get-Content -LiteralPath $outputPath -Raw).Trim() } else { "" }
        if ($exitCode -ne 0) {
            throw "wsb $($Arguments -join ' ') failed with exit code $exitCode`: $output"
        }
        return $output
    } finally {
        Remove-Item -LiteralPath $commandPath, $outputPath, $exitPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-WsbState {
    $raw = Invoke-PackagedWsbCli @("list", "--raw")
    if ($null -eq $raw) { return [pscustomobject]@{ available = $false; sessions = @() } }
    if (-not $raw) { return [pscustomobject]@{ available = $true; sessions = @() } }
    $parsed = $raw | ConvertFrom-Json
    return [pscustomobject]@{ available = $true; sessions = @($parsed.WindowsSandboxEnvironments) }
}

function Wait-WsbSessionAbsent([string]$SessionId, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $state = Get-WsbState
        if ($state.available -and -not ($state.sessions.Id -contains $SessionId)) { return $true }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Stop-WsbSession([string]$SessionId, [int]$Seconds, [switch]$AllowForce) {
    $state = Get-WsbState
    if ($state.available) {
        if ($state.sessions.Id -notcontains $SessionId) {
            return [pscustomobject]@{ id = $SessionId; stopped = $true; alreadyAbsent = $true; mode = "wsb-cli" }
        }
        $null = Invoke-PackagedWsbCli @("stop", "--id", $SessionId)
        if (Wait-WsbSessionAbsent $SessionId $Seconds) {
            return [pscustomobject]@{ id = $SessionId; stopped = $true; alreadyAbsent = $false; mode = "wsb-cli" }
        }
        if (-not $AllowForce) { throw "Sandbox $SessionId did not leave the wsb session list within $Seconds seconds." }
    }

    if ($AllowForce) {
        Get-Process WindowsSandboxClient, WindowsSandboxRemoteSession -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
        return [pscustomobject]@{ id = $SessionId; stopped = $true; alreadyAbsent = $false; mode = "forced-client-close" }
    }
    throw "The wsb CLI is unavailable. Close the Sandbox window and confirm the close prompt, or retry with -Force."
}

switch ($Action) {
    "Diagnose" {
        $package = Get-CurrentUserSandboxPackage
        $feature = try {
            Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -ErrorAction Stop
        } catch {
            $null
        }
        $state = try { Get-WsbState } catch { [pscustomobject]@{ available = $false; sessions = @() } }
        $recentCrashes = @(Get-RecentSandboxServerCrashes)
        Write-Result ([pscustomobject]@{
            windowsBuild = [Environment]::OSVersion.Version.ToString()
            optionalFeatureState = if ($feature) { [string]$feature.State } else { "requires-elevation-or-unavailable" }
            currentUserPackageRegistered = [bool]$package
            currentUserPackageVersion = if ($package) { [string]$package.Version } else { "" }
            wsbAliasAvailable = [bool](Get-Command wsb.exe -ErrorAction SilentlyContinue)
            modernCliAvailable = $state.available
            modernSessions = @($state.sessions)
            legacyClientCount = @(Get-Process WindowsSandboxClient -ErrorAction SilentlyContinue).Count
            modernRemoteSessionCount = @(Get-Process WindowsSandboxRemoteSession -ErrorAction SilentlyContinue).Count
            recentServerCrashCount = $recentCrashes.Count
            recentServerCrashLatest = if ($recentCrashes.Count) { $recentCrashes[0].TimeCreated } else { $null }
            recentRpcShutdownFailure = [bool]($recentCrashes | Where-Object RpcShutdownFailure | Select-Object -First 1)
            note = "Use wsb session IDs as the source of truth on modern Sandbox; WindowsSandboxServer is a service host, not an active-session signal."
        })
    }
    "RepairRegistration" {
        if (-not (Test-IsAdministrator)) { throw "RepairRegistration must run in an elevated PowerShell window." }
        $allUsersPackage = Get-AppxPackage -AllUsers -Name $packageName -ErrorAction Stop | Select-Object -First 1
        if (-not $allUsersPackage) { throw "The modern Windows Sandbox AppX package is not installed for any user." }
        $manifest = Join-Path $allUsersPackage.InstallLocation "AppxManifest.xml"
        Add-AppxPackage -DisableDevelopmentMode -Register $manifest
        Write-Result ([pscustomobject]@{
            repaired = $true
            version = [string]$allUsersPackage.Version
            manifest = $manifest
            nextStep = "Sign out and back in if the wsb.exe execution alias is not immediately available."
        })
    }
    "List" {
        $state = Get-WsbState
        if (-not $state.available) {
            Write-Result ([pscustomobject]@{ mode = "legacy"; sessions = @() })
        } else {
            Write-Result ([pscustomobject]@{ mode = "wsb-cli"; sessions = @($state.sessions) })
        }
    }
    "Start" {
        if (-not $ConfigPath) { throw "Start requires -ConfigPath." }
        $config = (Resolve-Path -LiteralPath $ConfigPath).Path
        [xml](Get-Content -LiteralPath $config -Raw) | Out-Null
        $beforeState = Get-WsbState
        $before = @($beforeState.sessions)
        if ($beforeState.available -and $before.Count -gt 0) {
            throw "Windows Sandbox supports one session at a time. Stop the existing session first: $($before.Id -join ', ')"
        }
        $legacyBefore = @(Get-Process WindowsSandboxClient -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        $remoteBefore = @(Get-Process WindowsSandboxRemoteSession -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        $launcher = Start-Process -FilePath "$env:SystemRoot\System32\WindowsSandbox.exe" -ArgumentList @("`"$config`"") -PassThru
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        do {
            Start-Sleep -Seconds 2
            if ($beforeState.available) {
                $currentState = Get-WsbState
                $newSession = @($currentState.sessions | Where-Object { $_.Id -notin $before.Id }) | Select-Object -First 1
                if ($newSession) {
                    Write-Result ([pscustomobject]@{ id = [string]$newSession.Id; started = $true; mode = "wsb-cli"; config = $config })
                    exit 0
                }
            } else {
                $legacy = Get-Process WindowsSandboxClient -ErrorAction SilentlyContinue | Where-Object { $_.Id -notin $legacyBefore } | Select-Object -First 1
                $remote = Get-Process WindowsSandboxRemoteSession -ErrorAction SilentlyContinue | Where-Object { $_.Id -notin $remoteBefore } | Select-Object -First 1
                if ($legacy -or $remote) {
                    Write-Result ([pscustomobject]@{ id = ""; started = $true; mode = "legacy-process"; config = $config })
                    exit 0
                }
            }
        } while ((Get-Date) -lt $deadline)
        $launcher.Refresh()
        throw "Windows Sandbox did not create a session within $TimeoutSeconds seconds. launcherExited=$($launcher.HasExited). Run -Action Diagnose and check Store/Windows Update if the current-user AppX registration is missing."
    }
    "Stop" {
        if (-not $Id) { throw "Stop requires -Id." }
        Write-Result (Stop-WsbSession $Id $TimeoutSeconds -AllowForce:$Force)
    }
    "StopAll" {
        $state = Get-WsbState
        if ($state.available) {
            $results = foreach ($session in $state.sessions) { Stop-WsbSession ([string]$session.Id) $TimeoutSeconds -AllowForce:$Force }
            $remainingState = Get-WsbState
            Write-Result ([pscustomobject]@{ stopped = @($results); remaining = @($remainingState.sessions) })
        } elseif ($Force) {
            Get-Process WindowsSandboxClient, WindowsSandboxRemoteSession -ErrorAction SilentlyContinue |
                Stop-Process -Force -ErrorAction SilentlyContinue
            Write-Result ([pscustomobject]@{ stopped = @(); remaining = @(); mode = "forced-client-close" })
        } else {
            throw "The wsb CLI is unavailable. Retry StopAll with -Force only after confirming no acceptance run is active."
        }
    }
}
