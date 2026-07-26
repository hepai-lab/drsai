param(
    [Parameter(Mandatory = $true)][string]$OldApk,
    [Parameter(Mandatory = $true)][string]$NewApk,
    [Parameter(Mandatory = $true)][string]$ManifestUrl,
    [Parameter(Mandatory = $true)][string]$TestBridgeApk,
    [string]$Serial = "emulator-5556",
    [string]$SeedTest = "ai.drsai.remote.UpdateAcceptanceSeedTest",
    [string]$PackageName = "ai.drsai.remote",
    [int]$TimeoutSeconds = 600,
    [string]$Report = "update-e2e-report.json"
)

$ErrorActionPreference = "Stop"
$sdkRoot = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA "Android\Sdk" }
$adb = Join-Path $sdkRoot "platform-tools\adb.exe"
if (-not (Test-Path -LiteralPath $adb)) { throw "adb not found: $adb" }
$oldApkPath = (Resolve-Path -LiteralPath $OldApk).Path
$newApkPath = (Resolve-Path -LiteralPath $NewApk).Path
$bridgePath = (Resolve-Path -LiteralPath $TestBridgeApk).Path

function Invoke-Adb([string[]]$CommandArgs) {
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & $adb -s $Serial @CommandArgs 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorPreference
    if ($exitCode -ne 0) { throw "adb $($CommandArgs -join ' ') failed: $output" }
    return ($output -join "`n")
}

function Get-PackageDump { Invoke-Adb @("shell", "dumpsys", "package", $PackageName) }
function Get-PackageVersion {
    $match = [regex]::Match((Get-PackageDump), "versionCode=(\d+)")
    if (-not $match.Success) { return $null }
    return [int64]$match.Groups[1].Value
}
function Get-UiXml {
    $deadline = (Get-Date).AddSeconds(15)
    do {
        try {
            Invoke-Adb @("shell", "uiautomator", "dump", "/sdcard/opendrsai-update-e2e.xml") | Out-Null
            return [xml](Invoke-Adb @("shell", "cat", "/sdcard/opendrsai-update-e2e.xml"))
        } catch {
            if ((Get-Date) -ge $deadline) { throw }
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for Android UI hierarchy"
}
function Click-UiNode([System.Xml.XmlElement]$Node) {
    while ($null -ne $Node -and $Node.GetAttribute("clickable") -ne "true") { $Node = $Node.ParentNode }
    if ($null -eq $Node) { throw "No clickable ancestor found" }
    $match = [regex]::Match($Node.GetAttribute("bounds"), "\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
    if (-not $match.Success) { throw "Invalid UI bounds" }
    $x = ([int]$match.Groups[1].Value + [int]$match.Groups[3].Value) / 2
    $y = ([int]$match.Groups[2].Value + [int]$match.Groups[4].Value) / 2
    Invoke-Adb @("shell", "input", "tap", [string][int]$x, [string][int]$y) | Out-Null
}
function Click-UiLabel([string]$Label, [int]$WaitSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        $ui = Get-UiXml
        $node = @($ui.SelectNodes("//node") | Where-Object {
            $_.GetAttribute("text") -eq $Label -or $_.GetAttribute("content-desc") -eq $Label
        })[0]
        if ($null -ne $node) { Click-UiNode $node; return }
        Start-Sleep -Seconds 1
    }
    throw "UI label not found: $Label"
}
function Wait-UiLabel([string]$Label, [int]$WaitSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        $ui = Get-UiXml
        $node = @($ui.SelectNodes("//node") | Where-Object {
            $_.GetAttribute("text") -eq $Label -or $_.GetAttribute("content-desc") -eq $Label
        })[0]
        if ($null -ne $node) { return }
        Start-Sleep -Milliseconds 500
    }
    throw "UI label not found: $Label"
}
function Try-Click-UiLabel([string]$Label, [int]$WaitSeconds = 5) {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        $ui = Get-UiXml
        $node = @($ui.SelectNodes("//node") | Where-Object {
            $_.GetAttribute("text") -eq $Label -or $_.GetAttribute("content-desc") -eq $Label
        })[0]
        if ($null -ne $node) {
            Click-UiNode $node
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
function Click-UiContainingAnyLabel([string[]]$Labels, [int]$WaitSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    while ((Get-Date) -lt $deadline) {
        $ui = Get-UiXml
        $node = @($ui.SelectNodes("//node") | Where-Object {
            $text = $_.GetAttribute("text")
            $description = $_.GetAttribute("content-desc")
            @($Labels | Where-Object {
                ($text -and $text.Contains($_)) -or
                ($description -and $description.Contains($_))
            }).Count -gt 0
        })[0]
        if ($null -ne $node) {
            Click-UiNode $node
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "No matching UI action found: $($Labels -join ', ')"
}
function Assert-DeviceUnlocked {
    Invoke-Adb @("shell", "input", "keyevent", "KEYCODE_WAKEUP") | Out-Null
    Invoke-Adb @("shell", "wm", "dismiss-keyguard") | Out-Null
    Start-Sleep -Milliseconds 750
    $windowDump = Invoke-Adb @("shell", "dumpsys", "window")
    if ($windowDump -match "mCurrentFocus=Window\{[^\r\n]*\s(?:Bouncer|Keyguard)" -or
        $windowDump -match "mDreamingLockscreen=true") {
        throw "The Android device is locked. Unlock it manually, keep the screen on, and rerun the acceptance test."
    }
}
function Get-FirstInstallTime([string]$Dump) {
    [regex]::Match($Dump, "firstInstallTime=([^\r\n]+)").Groups[1].Value.Trim()
}
function Get-AuthHash {
    $output = Invoke-Adb @(
        "shell", "run-as", $PackageName,
        "sha256sum", "shared_prefs/opendrsai_auth.xml"
    )
    return $output.Split(" ")[0]
}

$steps = [System.Collections.Generic.List[object]]::new()
# Keep the script executable under Windows PowerShell 5, which reads UTF-8 files
# without a BOM using the active ANSI code page.
$openSidebarLabel = -join (0x5C55, 0x5F00, 0x4FA7, 0x680F | ForEach-Object { [char]$_ })
$checkAndUpdateLabel = -join (0x68C0, 0x67E5, 0x5E76, 0x66F4, 0x65B0 | ForEach-Object { [char]$_ })
$downloadAndInstallLabel = -join (0x4E0B, 0x8F7D, 0x5E76, 0x5B89, 0x88C5 | ForEach-Object { [char]$_ })
$continueInstallLabel = -join (0x7EE7, 0x7EED, 0x5B89, 0x88C5 | ForEach-Object { [char]$_ })
$retryLabel = -join (0x91CD, 0x8BD5 | ForEach-Object { [char]$_ })
$installerLabels = @("INSTALL", "Install", "UPDATE", "Update") + @(
    -join (0x5B89, 0x88C5 | ForEach-Object { [char]$_ }),
    -join (0x66F4, 0x65B0 | ForEach-Object { [char]$_ }),
    -join (0x7EE7, 0x7EED, 0x5B89, 0x88C5 | ForEach-Object { [char]$_ }),
    -join (0x5141, 0x8BB8 | ForEach-Object { [char]$_ }),
    -join (0x8F6F, 0x4EF6, 0x5305, 0x5B89, 0x88C5, 0x7A0B, 0x5E8F | ForEach-Object { [char]$_ }),
    -join (0x4EC5, 0x6B64, 0x4E00, 0x6B21 | ForEach-Object { [char]$_ }),
    -join (0x59CB, 0x7EC8 | ForEach-Object { [char]$_ })
)
function Step([string]$Name, [scriptblock]$Action) {
    $begin = Get-Date
    try {
        & $Action
        $steps.Add([ordered]@{ name = $Name; status = "passed"; durationMs = [int]((Get-Date) - $begin).TotalMilliseconds })
    } catch {
        $steps.Add([ordered]@{ name = $Name; status = "failed"; error = $_.Exception.Message; durationMs = [int]((Get-Date) - $begin).TotalMilliseconds })
        throw
    }
}

$manifestUri = [Uri]$ManifestUrl
if ($manifestUri.Host -in @("127.0.0.1", "localhost")) {
    Step "configure-local-update-feed" {
        Invoke-Adb @("reverse", "tcp:$($manifestUri.Port)", "tcp:$($manifestUri.Port)") | Out-Null
    }
}

Step "prepare-unlocked-device" {
    Invoke-Adb @("shell", "svc", "power", "stayon", "usb") | Out-Null
    Assert-DeviceUnlocked
}
Step "clean-install-old" {
    Invoke-Adb @("shell", "am", "force-stop", "com.google.android.packageinstaller") | Out-Null
    & $adb -s $Serial uninstall "$PackageName.test" 2>$null | Out-Null
    & $adb -s $Serial uninstall $PackageName 2>$null | Out-Null
    Invoke-Adb @("install", $oldApkPath) | Out-Null
    Invoke-Adb @("install", $bridgePath) | Out-Null
}
Step "seed-simulated-login" {
    $result = Invoke-Adb @("shell", "am", "instrument", "-w", "-r", "-e", "class", $SeedTest, "$PackageName.test/androidx.test.runner.AndroidJUnitRunner")
    if ($result -notmatch "OK \(1 test\)") { throw "Seed test failed: $result" }
}
Step "grant-installer-and-launch" {
    # Changing this app-op kills the process, so it must happen before launch.
    Invoke-Adb @("shell", "appops", "set", $PackageName, "REQUEST_INSTALL_PACKAGES", "allow") | Out-Null
    Invoke-Adb @("shell", "am", "start", "-W", "-n", "$PackageName/ai.drsai.remote.MainActivity") | Out-Null
    # Tablets keep the navigation rail open. Phones require opening the modal
    # drawer first; probing the account avoids accidentally closing a tablet rail.
    if (-not (Try-Click-UiLabel "Stage 5 Update Acceptance" 10)) {
        Click-UiLabel $openSidebarLabel
        Click-UiLabel "Stage 5 Update Acceptance"
    }
    Wait-UiLabel (-join (0x4E2A, 0x4EBA, 0x4E2D, 0x5FC3 | ForEach-Object { [char]$_ }))
}

$beforeDump = Get-PackageDump
$oldCode = Get-PackageVersion
$firstInstallBefore = Get-FirstInstallTime $beforeDump
$authHashBefore = Get-AuthHash
$installerActions = [System.Collections.Generic.List[string]]::new()
Step "click-check-and-update" {
    Click-UiContainingAnyLabel @(
        $checkAndUpdateLabel,
        $downloadAndInstallLabel,
        $continueInstallLabel,
        $retryLabel
    )
}
Step "download-verify-and-install" {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $currentCode = Get-PackageVersion
        if ($currentCode -gt $oldCode) { return }
        $ui = Get-UiXml
        $candidate = @($ui.SelectNodes("//node") | Where-Object {
            $installerLabels -contains $_.GetAttribute("text") -or
            $installerLabels -contains $_.GetAttribute("content-desc")
        })[0]
        if ($null -ne $candidate) {
            $label = if ($candidate.GetAttribute("text")) { $candidate.GetAttribute("text") } else { $candidate.GetAttribute("content-desc") }
            Click-UiNode $candidate
            $installerActions.Add($label)
        }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for application update"
}

$newCode = Get-PackageVersion
$afterDump = Get-PackageDump
$firstInstallAfter = Get-FirstInstallTime $afterDump
$authHashAfter = Get-AuthHash
Step "launch-updated-app" { Invoke-Adb @("shell", "am", "start", "-W", "-n", "$PackageName/ai.drsai.remote.MainActivity") | Out-Null }

$passed = $newCode -gt $oldCode -and $firstInstallBefore -eq $firstInstallAfter -and $authHashBefore -eq $authHashAfter
$result = [ordered]@{
    schemaVersion = 2
    generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    result = if ($passed) { "passed" } else { "failed" }
    device = $Serial
    packageName = $PackageName
    oldApk = $oldApkPath
    newApk = $newApkPath
    manifestUrl = $ManifestUrl
    oldVersionCode = $oldCode
    newVersionCode = $newCode
    firstInstallTimeBefore = $firstInstallBefore
    firstInstallTimeAfter = $firstInstallAfter
    encryptedAuthSha256Before = $authHashBefore
    encryptedAuthSha256After = $authHashAfter
    installerActions = @($installerActions)
    steps = @($steps)
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding UTF8
if (-not $passed) { throw "Automatic update acceptance failed" }
$result | ConvertTo-Json -Depth 8
