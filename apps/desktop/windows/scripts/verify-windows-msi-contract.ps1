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
}

$startMenuTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``Shortcut`` WHERE ``Shortcut``='StartMenuShortcut'"
$desktopTarget = Read-SingleValue $database "SELECT ``Target`` FROM ``Shortcut`` WHERE ``Shortcut``='DesktopShortcut'"
Assert-Equal $startMenuTarget "[INSTALLFOLDER]app\OpenDrSai.exe" "Start menu shortcut target"
Assert-Equal $desktopTarget "[INSTALLFOLDER]app\OpenDrSai.exe" "Desktop shortcut target"

Write-Host "Windows MSI contract verified for per-machine Program Files installation and ARP uninstall." -ForegroundColor Green
