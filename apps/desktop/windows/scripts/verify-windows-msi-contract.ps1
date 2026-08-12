param(
    [string]$MsiPath = "$PSScriptRoot\..\release\bootstrapper\OpenDrSai-Windows-Installer-x64.msi"
)

$ErrorActionPreference = "Stop"

function Assert-Equal([string]$Actual, [string]$Expected, [string]$Label) {
    if ($Actual -ne $Expected) {
        throw "$Label must be '$Expected', got '$Actual'."
    }
}

function Read-SingleValue($Database, [string]$Query, [int]$Field = 1) {
    $view = $Database.OpenView($Query)
    try {
        $null = $view.Execute()
        $record = $view.Fetch()
        if (-not $record) { return $null }
        [string]$value = $record.StringData($Field)
        return $value.Trim()
    } finally {
        $null = $view.Close()
    }
}

$msi = (Resolve-Path $MsiPath).Path
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase($msi, 0)

Assert-Equal (Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ProductName'") "OpenDrSai" "ProductName"
Assert-Equal (Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ALLUSERS'") "1" "ALLUSERS"
if (Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ARPNOREPAIR'") {
    throw "ARPNOREPAIR must not disable Runtime repair."
}
$arpSizeText = Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ARPSIZE'"
if (-not $arpSizeText -or $arpSizeText -notmatch '^\d+$') {
    throw "ARPSIZE must be authored as an integer number of KiB, got '$arpSizeText'."
}
$arpSizeKB = [Int64]$arpSizeText
$runtimeSizeBytes = [Int64](Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='RUNTIMESIZEBYTES'")
$minimumRuntimeSizeKB = [Int64][Math]::Ceiling($runtimeSizeBytes / 1KB)
if ($arpSizeKB -lt $minimumRuntimeSizeKB) {
    throw "ARPSIZE must include at least the downloaded Runtime archive: $arpSizeKB KiB < $minimumRuntimeSizeKB KiB."
}
$runtimeArchive = Join-Path (Split-Path -Parent $msi) "OpenDrSai-Windows-v$((Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json).version)-x64.zip"
if (Test-Path -LiteralPath $runtimeArchive -PathType Leaf) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveItem = Get-Item -LiteralPath $runtimeArchive
    $archive = [System.IO.Compression.ZipFile]::OpenRead($archiveItem.FullName)
    try {
        [Int64]$expandedBytes = 0
        foreach ($entry in $archive.Entries) { $expandedBytes += [Int64]$entry.Length }
    } finally {
        $archive.Dispose()
    }
    [Int64]$supportBytes = 0
    foreach ($name in @("install-opendrsai.ps1", "uninstall-opendrsai.ps1", "run-opendrsai-install.vbs", "run-opendrsai-uninstall.vbs")) {
        $supportBytes += [Int64](Get-Item -LiteralPath (Join-Path $PSScriptRoot "..\installer\$name")).Length
    }
    $expectedArpSizeKB = [Int64][Math]::Ceiling(($expandedBytes + [Int64]$archiveItem.Length + $supportBytes) / 1KB)
    if ($arpSizeKB -ne $expectedArpSizeKB) {
        throw "ARPSIZE must equal the retained archive plus expanded Runtime and support files: $arpSizeKB KiB != $expectedArpSizeKB KiB."
    }
}
Assert-Equal (Read-SingleValue $database "SELECT ``Directory_Parent`` FROM ``Directory`` WHERE ``Directory``='INSTALLFOLDER'") "ProgramFiles64Folder" "INSTALLFOLDER parent"
Assert-Equal (Read-SingleValue $database "SELECT ``Root`` FROM ``Registry`` WHERE ``Key``='Software\HepAI\OpenDrSai' AND ``Name``='Installed'") "2" "Installed registry hive"
$sameVersionUpgradeAttributes = [int](Read-SingleValue $database "SELECT ``Attributes`` FROM ``Upgrade`` WHERE ``ActionProperty``='WIX_UPGRADE_DETECTED'")
if (($sameVersionUpgradeAttributes -band 512) -eq 0) {
    throw "MajorUpgrade must include the current product version so a repaired MSI can replace the same published version; attributes=$sameVersionUpgradeAttributes."
}

$productVersion = Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ProductVersion'"
$runtimeUrl = Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='RUNTIMEURL'"
$packageVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot "..\package.json") -Raw | ConvertFrom-Json).version
$expectedProductVersion = if ($packageVersion -match '^(\d+\.\d+\.\d+)') { $Matches[1] } else { $packageVersion }
Assert-Equal $productVersion $expectedProductVersion "ProductVersion"
$isDevelopmentBuild = $env:OPENDRSAI_RELEASE_TAG -eq "latest" -or $env:OPENDRSAI_UPDATE_CHANNEL -eq "dev"
if ($runtimeUrl -match '/releases/latest/') {
    if (-not $isDevelopmentBuild) {
        throw "Stable RUNTIMEURL must be immutable and must not use releases/latest: $runtimeUrl"
    }
} else {
    $expectedRuntimeUrl = "https://download-opendrsai.ihep.ac.cn/releases/v$packageVersion/windows/OpenDrSai-Windows-v$packageVersion-x64.zip"
    Assert-Equal $runtimeUrl $expectedRuntimeUrl "RUNTIMEURL"
}

foreach ($action in @(
    "DownloadOpenDrSaiRuntime",
    "VerifyOpenDrSaiRuntime",
    "ExtractOpenDrSaiRuntime",
    "InstallOpenDrSaiRuntime",
    "CompleteOpenDrSaiInstall",
    "RunOpenDrSaiUninstaller"
)) {
    $typeText = Read-SingleValue $database "SELECT ``Type`` FROM ``CustomAction`` WHERE ``Action``='$action'"
    if (-not $typeText) { throw "MSI is missing custom action $action." }
    $type = [int]$typeText
    if (($type -band 1024) -eq 0 -or ($type -band 2048) -eq 0) {
        throw "$action must be deferred and run without impersonation; type=$type."
    }
    $entryPoint = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='$action'"
    if ($action -in @("VerifyOpenDrSaiRuntime", "ExtractOpenDrSaiRuntime", "InstallOpenDrSaiRuntime", "CompleteOpenDrSaiInstall") -and $entryPoint -ne "RunInstallerStage") {
        throw "$action must use the managed real-time stage progress bridge: $entryPoint"
    }
    if ($action -eq "RunOpenDrSaiUninstaller" -and $entryPoint -notmatch '(?i)^powershell\.exe ') {
        throw "$action must invoke the hidden uninstall script directly: $entryPoint"
    }
}
$rollbackType = [int](Read-SingleValue $database "SELECT ``Type`` FROM ``CustomAction`` WHERE ``Action``='RollbackOpenDrSaiInstall'")
if (($rollbackType -band 256) -eq 0 -or ($rollbackType -band 2048) -eq 0) {
    throw "RollbackOpenDrSaiInstall must be a non-impersonated rollback custom action; type=$rollbackType."
}
$rollbackData = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='SetRollbackOpenDrSaiInstall'"
foreach ($requiredData in @('-Stage Rollback', '-InstallSessionId "[ProductCode]"', '-InstallRoot "[INSTALLFOLDER]."')) {
    if ($rollbackData -notmatch [regex]::Escape($requiredData)) {
        throw "Rollback custom action data is missing '$requiredData': $rollbackData"
    }
}
$rollbackCondition = Read-SingleValue $database "SELECT ``Condition`` FROM ``InstallExecuteSequence`` WHERE ``Action``='RollbackOpenDrSaiInstall'"
Assert-Equal $rollbackCondition 'NOT REMOVE~="ALL"' "Runtime rollback scheduling condition"

$progressMilestones = @{
    VerifyOpenDrSaiRuntime = "Ticks=50"
    ExtractOpenDrSaiRuntime = "Ticks=200"
    InstallOpenDrSaiRuntime = "Ticks=120"
    CompleteOpenDrSaiInstall = "Ticks=30"
}
foreach ($action in $progressMilestones.Keys) {
    $data = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='Set$action'"
    if ($data -notmatch [regex]::Escape($progressMilestones[$action])) {
        throw "$action must reserve $($progressMilestones[$action]) and report it incrementally: $data"
    }
    foreach ($requiredData in @("ProgressFile=[INSTALLFOLDER]cache", "InstallSessionId=[ProductCode]", "ScriptPath=[INSTALLFOLDER]install-opendrsai.ps1")) {
        if ($data -notmatch [regex]::Escape($requiredData)) {
            throw "$action custom action data is missing '$requiredData': $data"
        }
    }
}

foreach ($setter in @(
    "SetVerifyOpenDrSaiRuntime",
    "SetExtractOpenDrSaiRuntime",
    "SetInstallOpenDrSaiRuntime",
    "SetCompleteOpenDrSaiInstall",
    "SetRunOpenDrSaiUninstaller"
)) {
    $target = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='$setter'"
    if ($setter -ne "SetRunOpenDrSaiUninstaller" -and $target -notmatch '(?i)InstallRoot=\[INSTALLFOLDER\]\.') {
        throw "$setter must pass the selected INSTALLFOLDER to the stage bridge: $target"
    }
    if ($setter -eq "SetRunOpenDrSaiUninstaller" -and $target -notmatch '(?i)-InstallRoot\s+"\[INSTALLFOLDER\]\."') {
        throw "$setter must pass the selected INSTALLFOLDER with a trailing dot that safely terminates quoted paths: $target"
    }
}

$downloadSource = Read-SingleValue $database "SELECT ``Source`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'"
$downloadTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'"
$downloadType = [int](Read-SingleValue $database "SELECT ``Type`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'")
$downloadData = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='SetDownloadOpenDrSaiRuntime'"
Assert-Equal $downloadSource "OpenDrSaiInstallerActions" "Download custom action binary"
Assert-Equal $downloadTarget "DownloadRuntime" "Download custom action entry point"
if ($downloadData -notmatch [regex]::Escape("SourcePath=[OriginalDatabase]")) {
    throw "Download custom action must prefer the versioned OpenDrSai Runtime ZIP beside Setup: $downloadData"
}
if ($downloadData -notmatch [regex]::Escape("OpenDrSai-Windows-v[BOOTSTRAPPERVERSION]-x64.zip")) {
    throw "Download custom action cache path must use the versioned OpenDrSai Runtime ZIP name: $downloadData"
}
if (($downloadType -band 63) -ne 1) {
    throw "DownloadOpenDrSaiRuntime must be a DLL custom action; type=$downloadType."
}

$downloadTemplate = Read-SingleValue $database "SELECT ``Template`` FROM ``ActionText`` WHERE ``Action``='DownloadOpenDrSaiRuntime'"
Assert-Equal $downloadTemplate "[1]" "Download progress text template"

$stageControl = Read-SingleValue $database "SELECT ``Control_`` FROM ``EventMapping`` WHERE ``Dialog_``='ProgressDlg' AND ``Control_``='ActionText' AND ``Event``='ActionText' AND ``Attribute``='Text'"
Assert-Equal $stageControl "ActionText" "Visible install stage ActionText binding"
$incorrectSharedBinding = Read-SingleValue $database "SELECT ``Control_`` FROM ``EventMapping`` WHERE ``Dialog_``='ProgressDlg' AND ``Control_``='ActionText' AND ``Event``='ActionData'"
if ($incorrectSharedBinding) {
    throw "Download details must not overwrite the visible install stage control."
}
$downloadDetailsType = Read-SingleValue $database "SELECT ``Type`` FROM ``Control`` WHERE ``Dialog_``='ProgressDlg' AND ``Control``='DownloadDetails'"
Assert-Equal $downloadDetailsType "Text" "Download details control type"
$downloadProgressControl = Read-SingleValue $database "SELECT ``Control_`` FROM ``EventMapping`` WHERE ``Dialog_``='ProgressDlg' AND ``Control_``='DownloadDetails' AND ``Event``='ActionData' AND ``Attribute``='Text'"
Assert-Equal $downloadProgressControl "DownloadDetails" "Visible download progress ActionData binding"

$stageDescriptions = @{
    DownloadOpenDrSaiRuntime = "Downloading OpenDrSai Runtime..."
    VerifyOpenDrSaiRuntime = "Verifying the downloaded package..."
    ExtractOpenDrSaiRuntime = "Extracting OpenDrSai Runtime..."
    InstallOpenDrSaiRuntime = "Installing OpenDrSai..."
    CompleteOpenDrSaiInstall = "Finishing OpenDrSai installation..."
}
foreach ($stage in $stageDescriptions.Keys) {
    $description = Read-SingleValue $database "SELECT ``Description`` FROM ``ActionText`` WHERE ``Action``='$stage'"
    Assert-Equal $description $stageDescriptions[$stage] "$stage progress text"
}

foreach ($action in @("DownloadOpenDrSaiRuntime", "VerifyOpenDrSaiRuntime", "ExtractOpenDrSaiRuntime", "InstallOpenDrSaiRuntime", "CompleteOpenDrSaiInstall")) {
    $condition = Read-SingleValue $database "SELECT ``Condition`` FROM ``InstallExecuteSequence`` WHERE ``Action``='$action'"
    Assert-Equal $condition 'NOT REMOVE~="ALL"' "$action repair/install condition"
}

Assert-Equal (Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='WIXUI_EXITDIALOGOPTIONALCHECKBOXTEXT'") "Launch OpenDrSai" "Finish-page launch checkbox text"
Assert-Equal (Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='WIXUI_EXITDIALOGOPTIONALCHECKBOX'") "1" "Finish-page launch checkbox default"
Assert-Equal (Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='LaunchOpenDrSai'") '"[INSTALLFOLDER]app\OpenDrSai.exe"' "Finish-page launch command"
$launchCondition = Read-SingleValue $database "SELECT ``Condition`` FROM ``ControlEvent`` WHERE ``Dialog_``='ExitDialog' AND ``Control_``='Finish' AND ``Argument``='LaunchOpenDrSai'"
if ($launchCondition -notmatch 'WIXUI_EXITDIALOGOPTIONALCHECKBOX' -or $launchCondition -notmatch 'NOT Installed') {
    throw "Finish must launch only when the checkbox is selected after a first-time install: $launchCondition"
}

$downloadError = Read-SingleValue $database "SELECT ``Message`` FROM ``Error`` WHERE ``Error``=25001"
Assert-Equal $downloadError "OpenDrSai Runtime download failed: [2]" "Runtime download error message"

$startMenuTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``Shortcut`` WHERE ``Shortcut``='StartMenuShortcut'"
$desktopTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``Shortcut`` WHERE ``Shortcut``='DesktopShortcut'"
Assert-Equal $startMenuTarget "[INSTALLFOLDER]app\OpenDrSai.exe" "Start menu shortcut target"
Assert-Equal $desktopTarget "[INSTALLFOLDER]app\OpenDrSai.exe" "Desktop shortcut target"

Write-Host "Windows MSI contract verified for elevated per-machine Program Files installation and ARP uninstall." -ForegroundColor Green
