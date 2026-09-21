$ErrorActionPreference = "Stop"
$controller = Join-Path $PSScriptRoot "windows-sandbox-session.ps1"
$evidenceDir = Join-Path $PSScriptRoot "..\release\product-evidence\remote-workspace"
$resultPath = Join-Path $evidenceDir "sandbox-registration-repair.json"
New-Item -ItemType Directory -Force -Path $evidenceDir | Out-Null
try {
    $result = & $controller -Action RepairRegistration -AsJson
    if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Registration controller exited with code $LASTEXITCODE." }
    [IO.File]::WriteAllText($resultPath, (($result | Out-String).Trim() + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    exit 0
} catch {
    $failure = [ordered]@{
        repaired = $false
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        error = $_.Exception.Message
        temporaryDiagnostic = $true
    }
    [IO.File]::WriteAllText($resultPath, (($failure | ConvertTo-Json -Depth 4) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    exit 1
}
