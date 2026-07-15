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
$allUsers = Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ALLUSERS'"
if ($allUsers) { throw "ALLUSERS must be absent for a non-elevated per-user install, got '$allUsers'." }
Assert-Equal (Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ARPNOREPAIR'") "1" "ARPNOREPAIR"
Assert-Equal (Read-SingleValue $database "SELECT ``Directory_Parent`` FROM ``Directory`` WHERE ``Directory``='INSTALLFOLDER'") "LocalProgramsFolder" "INSTALLFOLDER parent"
Assert-Equal (Read-SingleValue $database "SELECT ``Directory_Parent`` FROM ``Directory`` WHERE ``Directory``='LocalProgramsFolder'") "LocalAppDataFolder" "LocalProgramsFolder parent"
Assert-Equal (Read-SingleValue $database "SELECT ``Root`` FROM ``Registry`` WHERE ``Key``='Software\HepAI\OpenDrSai' AND ``Name``='Installed'") "1" "Installed registry hive"

$productVersion = Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='ProductVersion'"
$runtimeUrl = Read-SingleValue $database "SELECT ``Value`` FROM ``Property`` WHERE ``Property``='RUNTIMEURL'"
$isDevelopmentBuild = $env:OPENDRSAI_RELEASE_TAG -eq "latest" -or $env:OPENDRSAI_UPDATE_CHANNEL -eq "dev"
if ($runtimeUrl -match '/releases/latest/') {
    if (-not $isDevelopmentBuild) {
        throw "Stable RUNTIMEURL must be immutable and must not use releases/latest: $runtimeUrl"
    }
} else {
    $expectedReleaseSegment = "/releases/download/v$productVersion/"
    if (-not $runtimeUrl.Contains($expectedReleaseSegment)) {
        throw "RUNTIMEURL must match ProductVersion $productVersion and contain '$expectedReleaseSegment': $runtimeUrl"
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
    if (($type -band 1024) -eq 0 -or ($type -band 2048) -ne 0) {
        throw "$action must be deferred and impersonate the ordinary user; type=$type."
    }
}

foreach ($setter in @(
    "SetVerifyOpenDrSaiRuntime",
    "SetExtractOpenDrSaiRuntime",
    "SetInstallOpenDrSaiRuntime",
    "SetCompleteOpenDrSaiInstall"
)) {
    $target = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='$setter'"
    if ($target -match '(?i)-MachineInstall') {
        throw "$setter must not force machine installation: $target"
    }
}

$downloadSource = Read-SingleValue $database "SELECT ``Source`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'"
$downloadTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'"
$downloadType = [int](Read-SingleValue $database "SELECT ``Type`` FROM ``CustomAction`` WHERE ``Action``='DownloadOpenDrSaiRuntime'")
Assert-Equal $downloadSource "OpenDrSaiInstallerActions" "Download custom action binary"
Assert-Equal $downloadTarget "DownloadRuntime" "Download custom action entry point"
if (($downloadType -band 63) -ne 1) {
    throw "DownloadOpenDrSaiRuntime must be a DLL custom action; type=$downloadType."
}

$downloadTemplate = Read-SingleValue $database "SELECT ``Template`` FROM ``ActionText`` WHERE ``Action``='DownloadOpenDrSaiRuntime'"
Assert-Equal $downloadTemplate "[1]" "Download progress text template"

$downloadError = Read-SingleValue $database "SELECT ``Message`` FROM ``Error`` WHERE ``Error``=25001"
Assert-Equal $downloadError "OpenDrSai Runtime download failed: [2]" "Runtime download error message"

$startMenuTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``Shortcut`` WHERE ``Shortcut``='StartMenuShortcut'"
$desktopTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``Shortcut`` WHERE ``Shortcut``='DesktopShortcut'"
Assert-Equal $startMenuTarget "[INSTALLFOLDER]app\OpenDrSai.exe" "Start menu shortcut target"
Assert-Equal $desktopTarget "[INSTALLFOLDER]app\OpenDrSai.exe" "Desktop shortcut target"

Write-Host "Windows MSI contract verified for non-elevated per-user LocalAppData installation and ARP uninstall." -ForegroundColor Green
