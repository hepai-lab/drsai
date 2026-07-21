param(
    [string]$MsiPath = "$PSScriptRoot\..\release\bootstrapper\OpenDrSaiSetup-win-x64.msi"
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
Assert-Equal (Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ARPNOREPAIR'") "1" "ARPNOREPAIR"
Assert-Equal (Read-SingleValue $database "SELECT ``Directory_Parent`` FROM ``Directory`` WHERE ``Directory``='INSTALLFOLDER'") "ProgramFiles64Folder" "INSTALLFOLDER parent"
Assert-Equal (Read-SingleValue $database "SELECT ``Root`` FROM ``Registry`` WHERE ``Key``='Software\HepAI\OpenDrSai' AND ``Name``='Installed'") "2" "Installed registry hive"

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
    $expectedReleaseSegment = "/releases/download/v$packageVersion/"
    if (-not $runtimeUrl.Contains($expectedReleaseSegment)) {
        throw "RUNTIMEURL must match package version $packageVersion and contain '$expectedReleaseSegment': $runtimeUrl"
    }
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
    $command = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='$action'"
    if ($action -ne "DownloadOpenDrSaiRuntime" -and $command -notmatch '(?i)^powershell\.exe ') {
        throw "$action must invoke PowerShell directly without a WScript/VBS wrapper: $command"
    }
}

$progressMilestones = @{
    AdvanceVerifyProgress = "Ticks=50"
    AdvanceExtractProgress = "Ticks=200"
    AdvanceInstallProgress = "Ticks=120"
    AdvanceCompleteProgress = "Ticks=30"
}
foreach ($action in $progressMilestones.Keys) {
    $entryPoint = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='$action'"
    Assert-Equal $entryPoint "AdvanceProgress" "$action managed entry point"
    $type = [int](Read-SingleValue $database "SELECT ``Type`` FROM ``CustomAction`` WHERE ``Action``='$action'")
    if (($type -band 1024) -eq 0 -or ($type -band 2048) -eq 0) {
        throw "$action must be deferred and run without impersonation; type=$type."
    }
    $data = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='Set$action'"
    Assert-Equal $data $progressMilestones[$action] "$action progress allocation"
}

foreach ($setter in @(
    "SetVerifyOpenDrSaiRuntime",
    "SetExtractOpenDrSaiRuntime",
    "SetInstallOpenDrSaiRuntime",
    "SetCompleteOpenDrSaiInstall"
)) {
    $target = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='$setter'"
    if ($target -notmatch '(?i)-MachineInstall') {
        throw "$setter must force machine installation: $target"
    }
    if ($target -match '(?i)-InstallRoot\s+"\[INSTALLFOLDER\]"') {
        throw "$setter must not quote INSTALLFOLDER as a command argument because MSI directory values end with a backslash: $target"
    }
}

$downloadSource = Read-SingleValue $database "SELECT ``Source`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'"
$downloadTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'"
$downloadType = [int](Read-SingleValue $database "SELECT ``Type`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'")
$downloadData = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='SetDownloadOpenDrSaiRuntime'"
Assert-Equal $downloadSource "OpenDrSaiInstallerActions" "Download custom action binary"
Assert-Equal $downloadTarget "DownloadRuntime" "Download custom action entry point"
if ($downloadData -notmatch [regex]::Escape("SourcePath=[OriginalDatabase]")) {
    throw "Download custom action must prefer OpenDrSaiRuntime-win-x64.zip beside Setup: $downloadData"
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

$downloadError = Read-SingleValue $database "SELECT ``Message`` FROM ``Error`` WHERE ``Error``=25001"
Assert-Equal $downloadError "OpenDrSai Runtime download failed: [2]" "Runtime download error message"

$startMenuTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``Shortcut`` WHERE ``Shortcut``='StartMenuShortcut'"
$desktopTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``Shortcut`` WHERE ``Shortcut``='DesktopShortcut'"
Assert-Equal $startMenuTarget "[INSTALLFOLDER]app\OpenDrSai.exe" "Start menu shortcut target"
Assert-Equal $desktopTarget "[INSTALLFOLDER]app\OpenDrSai.exe" "Desktop shortcut target"

Write-Host "Windows MSI contract verified for elevated per-machine Program Files installation and ARP uninstall." -ForegroundColor Green
