param(
    [string]$WindowsAppDir = "$PSScriptRoot\..\..\windows",
    [string]$OutDir = "$PSScriptRoot\..\..\windows\release\win-unpacked"
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$Path) {
    if (Test-Path $Path) {
        return (Resolve-Path $Path).Path
    }
    return [System.IO.Path]::GetFullPath($Path)
}

$windowsAppDir = Resolve-FullPath $WindowsAppDir
$outDir = Resolve-FullPath $OutDir
$electronDist = Join-Path $windowsAppDir "node_modules\electron\dist"
$builtOut = Join-Path $windowsAppDir "out"
$resourcesDir = Join-Path $windowsAppDir "resources"
$packageJson = Join-Path $windowsAppDir "package.json"
$installScript = Resolve-FullPath (Join-Path $windowsAppDir "..\..\..\scripts\install.ps1")

if (-not (Test-Path (Join-Path $electronDist "electron.exe"))) {
    throw "Electron runtime was not found. Run npm install in apps\desktop\windows first."
}
if (-not (Test-Path (Join-Path $builtOut "main\index.js"))) {
    throw "Built app output was not found. Run npm run build in apps\desktop\windows first."
}

Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $outDir
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Copy-Item -Path (Join-Path $electronDist "*") -Destination $outDir -Recurse -Force
Move-Item -LiteralPath (Join-Path $outDir "electron.exe") -Destination (Join-Path $outDir "OpenDrSai.exe") -Force

$appDir = Join-Path $outDir "resources\app"
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item -LiteralPath $builtOut -Destination (Join-Path $appDir "out") -Recurse -Force
Copy-Item -LiteralPath $resourcesDir -Destination (Join-Path $appDir "resources") -Recurse -Force
Copy-Item -LiteralPath $packageJson -Destination (Join-Path $appDir "package.json") -Force

$installDir = Join-Path $outDir "resources\install"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Copy-Item -LiteralPath $installScript -Destination (Join-Path $installDir "install.ps1") -Force

$nodeModulesDir = Join-Path $appDir "node_modules"
New-Item -ItemType Directory -Force -Path $nodeModulesDir | Out-Null
foreach ($module in @(
    "@electron-toolkit",
    "node-pty"
)) {
    $source = Join-Path $windowsAppDir "node_modules\$module"
    if (Test-Path $source) {
        $destination = Join-Path $nodeModulesDir $module
        Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
    }
}

Write-Host "Created unpacked desktop app: $(Join-Path $outDir "OpenDrSai.exe")" -ForegroundColor Green
