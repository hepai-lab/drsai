#!/usr/bin/env pwsh
# Local Windows packaging environment preflight for OpenDrSai.
#
# Read-only: inspects the machine and reports what is missing or misconfigured
# before `npm run build:win` is attempted. Never modifies the system.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\check-packaging-env.ps1
#
# Exit code 0 when every required check passes, 1 otherwise.

[CmdletBinding()]
param(
    [switch]$Quiet
)

$ErrorActionPreference = "Continue"

$windowsRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = (Resolve-Path (Join-Path $windowsRoot "..\..\..")).Path

$script:failures = [System.Collections.Generic.List[string]]::new()
$script:warnings = [System.Collections.Generic.List[string]]::new()

function Write-Section([string]$Title) {
    if (-not $Quiet) { Write-Host ""; Write-Host $Title -ForegroundColor Cyan }
}

function Write-Check([string]$Label, [bool]$Ok, [string]$Detail, [string]$Fix) {
    $mark = if ($Ok) { "OK  " } else { "FAIL" }
    $color = if ($Ok) { "Green" } else { "Red" }
    if (-not $Quiet) {
        Write-Host ("  [{0}] {1,-34} {2}" -f $mark, $Label, $Detail) -ForegroundColor $color
        if (-not $Ok -and $Fix) {
            Write-Host ("         -> {0}" -f $Fix) -ForegroundColor Yellow
        }
    }
    if (-not $Ok) { $script:failures.Add($Label) }
}

function Write-Warn([string]$Label, [string]$Detail, [string]$Fix) {
    if (-not $Quiet) {
        Write-Host ("  [WARN] {0,-34} {1}" -f $Label, $Detail) -ForegroundColor Yellow
        if ($Fix) { Write-Host ("         -> {0}" -f $Fix) -ForegroundColor Yellow }
    }
    $script:warnings.Add($Label)
}

function Resolve-Exe([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

# ---------------------------------------------------------------------------
Write-Section "1. Running processes"
# ---------------------------------------------------------------------------
# A live Desktop maps native modules out of node_modules, so `npm ci` cannot
# unlink them (EPERM). It also holds venv file handles during the runtime build.
$electron = @(Get-CimInstance Win32_Process -Filter "Name='electron.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -like '*\apps\desktop\*' })
Write-Check "No running OpenDrSai Desktop" ($electron.Count -eq 0) `
    "$($electron.Count) electron.exe process(es)" `
    "Stop them: Get-Process electron | Stop-Process -Force   (see docs 0.1)"

$agentPython = @(Get-CimInstance Win32_Process -Filter "Name='python.exe' or Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -like '*bootstrapper-msi3*' -or $_.ExecutablePath -like '*opendrsai-runtime-work*' })
Write-Check "No python holding the agent venv" ($agentPython.Count -eq 0) `
    "$($agentPython.Count) process(es)" `
    "Stop the build agent python processes before packaging."

# ---------------------------------------------------------------------------
Write-Section "2. Python interpreter"
# ---------------------------------------------------------------------------
# The runtime builder needs a standard CPython install: it copies Lib/DLLs/tcl
# and relies on the interpreter honouring <version>._pth. conda launchers and
# Microsoft Store alias stubs both fail here.
$stdPython = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
$stdOk = Test-Path -LiteralPath $stdPython
Write-Check "Standard CPython 3.12 present" $stdOk `
    $(if ($stdOk) { "$stdPython" } else { "not found" }) `
    "winget install --exact --id Python.Python.3.12"

if ($stdOk) {
    $ver = (& $stdPython -V 2>&1 | Out-String).Trim()
    $verOk = $ver -match '^Python 3\.12\.'
    Write-Check "CPython 3.12 version" $verOk $ver "Install CPython 3.12."
    foreach ($dir in @("Lib", "DLLs", "libs", "tcl")) {
        $p = Join-Path (Split-Path -Parent $stdPython) $dir
        Write-Check "CPython layout: $dir" (Test-Path $p) `
            $(if (Test-Path $p) { "present" } else { "missing" }) `
            "A standard CPython install must contain $dir."
    }
    $dll = Join-Path (Split-Path -Parent $stdPython) "python312.dll"
    Write-Check "python312.dll" (Test-Path $dll) `
        $(if (Test-Path $dll) { "present" } else { "missing" }) `
        "Runtime launcher copies this DLL into venv\Scripts."
}

$onPath = Resolve-Exe "python"
if ($onPath) {
    # A venv's python.exe forwards to its base interpreter, so resolve the real
    # base prefix instead of trusting the launcher path that PATH happens to hit.
    $resolved = (& $onPath -c "import sys; print(sys.base_prefix)" 2>&1 | Out-String).Trim()
    $isConda = $resolved -match 'conda|miniconda|anaconda|miniforge'
    $isStore = $resolved -match 'WindowsApps\\PythonSoftwareFoundation'
    $isVenv = $onPath -match '\\venv\\Scripts\\python\.exe$'
    if ($isConda -or $isStore) {
        $kind = if ($isConda) { "conda" } else { "Microsoft Store alias" }
        Write-Warn "PATH python is usable" "$resolved ($kind)" `
            "Always pass -Python explicitly (see docs 3.2). $kind Python cannot build the runtime."
    } elseif ($isVenv) {
        Write-Warn "PATH python is usable" "$onPath (a venv; base: $resolved)" `
            "Pass -Python explicitly when preparing the agent so the base interpreter is unambiguous."
    } else {
        Write-Check "PATH python is standard CPython" $true "$onPath (base: $resolved)" ""
    }
} else {
    Write-Warn "PATH python" "not found" "Pass -Python explicitly when preparing the agent."
}

# An agent built by conda/Store Python yields ModuleNotFoundError: drsai.
$agentVenv = Join-Path $windowsRoot ".tmp\bootstrapper-msi3\.drsai\drsai-agent\venv"
$cfg = Join-Path $agentVenv "pyvenv.cfg"
if (Test-Path -LiteralPath $cfg) {
    $homeLine = (Get-Content -LiteralPath $cfg | Where-Object { $_ -match '^home\s*=' } | Select-Object -First 1)
    # NOTE: $HOME is a read-only PowerShell variable; use a different name.
    $baseHome = if ($homeLine) { ($homeLine -split '=', 2)[1].Trim() } else { "" }
    $badAgent = ($baseHome -match 'conda|WindowsApps')
    Write-Check "Existing agent uses standard CPython" (-not $badAgent) $baseHome `
        "Remove-Item -Recurse -Force '.tmp\bootstrapper-msi3' then re-run prepare-ci-python-agent with -Python."
} else {
    Write-Warn "Existing agent venv" "not prepared yet" "npm run prepare-ci-python-agent -- -Python <standard python>"
}

# ---------------------------------------------------------------------------
Write-Section "3. Long path support"
# ---------------------------------------------------------------------------
# site-packages paths exceed MAX_PATH (260). With LongPathsEnabled=0 the cache
# cleanup cannot delete deep .pyc files and the build aborts.
$longPaths = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
    -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled
Write-Check "LongPathsEnabled = 1" ($longPaths -eq 1) "value: $longPaths" `
    "Admin: New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force  (then reopen the shell)"

$repoLen = $repoRoot.Length
if ($repoLen -gt 40) {
    Write-Warn "Repository path depth" "$repoRoot ($repoLen chars)" `
        "A shorter checkout root (e.g. D:\drsai) reduces deep site-packages path length."
}

# ---------------------------------------------------------------------------
Write-Section "4. WiX Toolset (MSI build)"
# ---------------------------------------------------------------------------
# build-msi.ps1 resolves candle/light from PATH (or -WixDir), then derives the
# SDK directory from the parent of the bin directory it found.
$candle = Resolve-Exe "candle.exe"
$light = Resolve-Exe "light.exe"
Write-Check "candle.exe on PATH" ([bool]$candle) `
    $(if ($candle) { $candle } else { "not found" }) `
    "choco install wixtoolset -y --no-progress  (then reopen the shell)"
Write-Check "light.exe on PATH" ([bool]$light) `
    $(if ($light) { $light } else { "not found" }) `
    "choco install wixtoolset -y --no-progress  (then reopen the shell)"

if ($candle) {
    $wixBin = Split-Path -Parent $candle
    $wixHome = Split-Path -Parent $wixBin
    $sdkCandidates = @(
        (Join-Path $wixBin "sdk"),
        (Join-Path $wixHome "sdk")
    )
    $sdkDir = $sdkCandidates |
        Where-Object { Test-Path (Join-Path $_ "Microsoft.Deployment.WindowsInstaller.dll") } |
        Select-Object -First 1
    Write-Check "WiX SDK discoverable" ([bool]$sdkDir) `
        $(if ($sdkDir) { $sdkDir } else { "checked: $($sdkCandidates -join ', ')" }) `
        "Install the full WiX Toolset, not just portable binaries."
    if ($sdkDir) {
        foreach ($tool in @("Microsoft.Deployment.WindowsInstaller.dll", "MakeSfxCA.exe", "x64\sfxca.dll")) {
            $p = Join-Path $sdkDir $tool
            Write-Check "WiX SDK: $tool" (Test-Path $p) `
                $(if (Test-Path $p) { "present" } else { "missing" }) `
                "Repair the WiX Toolset installation."
        }
    }
} else {
    Write-Warn "WiX SDK" "skipped (candle.exe not resolved)" ""
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
Write-Check ".NET Framework csc.exe" (Test-Path $csc) `
    $(if (Test-Path $csc) { "present" } else { "missing" }) `
    "Enable .NET Framework 4.x (compiles the MSI custom action)."

# ---------------------------------------------------------------------------
Write-Section "5. Node.js"
# ---------------------------------------------------------------------------
$node = Resolve-Exe "node"
if ($node) {
    $nodeVer = (& $node -v 2>&1 | Out-String).Trim()
    $nodeOk = $nodeVer -match '^v22\.'
    Write-Check "node v22.x" $nodeOk $nodeVer "winget install --exact --id OpenJS.NodeJS.LTS"
} else {
    Write-Check "node" $false "not found" "winget install --exact --id OpenJS.NodeJS.LTS"
}

# ---------------------------------------------------------------------------
Write-Section "6. OSS publishing (only needed to upload)"
# ---------------------------------------------------------------------------
$ossutil = Resolve-Exe "ossutil.exe"
if ($ossutil) {
    Write-Check "ossutil" $true $ossutil ""
} else {
    Write-Warn "ossutil" "not found" "Only required for publishing: winget install Aliyun.ossutil"
}
if (-not $env:OSSUTIL_PATH) {
    Write-Warn "OSSUTIL_PATH" "not set in this shell" "Set it before running publish-windows-release-to-oss.ps1 (see docs 2.5)."
}
if (-not $env:OSSUTIL_CONFIG) {
    Write-Warn "OSSUTIL_CONFIG" "not set in this shell" "Set it before running publish-windows-release-to-oss.ps1 (see docs 2.5)."
}

# ---------------------------------------------------------------------------
Write-Section "Summary"
# ---------------------------------------------------------------------------
if ($script:failures.Count -eq 0) {
    Write-Host "  All required checks passed." -ForegroundColor Green
    if ($script:warnings.Count -gt 0) {
        Write-Host "  $($script:warnings.Count) warning(s) - review before publishing." -ForegroundColor Yellow
    }
    exit 0
}
Write-Host "  $($script:failures.Count) required check(s) failed:" -ForegroundColor Red
foreach ($f in $script:failures) { Write-Host "    - $f" -ForegroundColor Red }
exit 1
