$ErrorActionPreference = "Continue"
$profileRoot = "C:\P3\profile"
$evidencePath = "C:\P3\evidence\sandbox-dev-log-tail.txt"

function Redact-Line([string] $line) {
    $line -replace '(?i)(authorization|access[_-]?token|refresh[_-]?token|api[_-]?key)\s*[:=]\s*[^\s,;]+', '$1=[REDACTED]'
}

$lines = New-Object Collections.Generic.List[string]
$lines.Add("Collected UTC: $([DateTime]::UtcNow.ToString('o'))")
$lines.Add("===== installers =====")
Get-ChildItem -LiteralPath "C:\P3\installers" -File -ErrorAction SilentlyContinue |
    ForEach-Object { $lines.Add("$($_.Name) $($_.Length) bytes $($_.LastWriteTimeUtc.ToString('o'))") }
$lines.Add("===== provisioning processes =====")
Get-Process -Name curl,msiexec,python,setup -ErrorAction SilentlyContinue |
    ForEach-Object { $lines.Add("$($_.ProcessName) pid=$($_.Id) started=$($_.StartTime.ToUniversalTime().ToString('o'))") }
Get-CimInstance Win32_Process -Filter "Name = 'msiexec.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object { $lines.Add("msiexec command=$($_.CommandLine)") }
$files = Get-ChildItem -LiteralPath (Join-Path $profileRoot "logs") -Recurse -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc
foreach ($file in $files) {
    $lines.Add("===== $($file.FullName) =====")
    Get-Content -LiteralPath $file.FullName -Tail 100 -ErrorAction SilentlyContinue |
        ForEach-Object { $lines.Add((Redact-Line $_)) }
}
if ($files.Count -eq 0) { $lines.Add("No developer logs were created.") }
$lines | Set-Content -LiteralPath $evidencePath -Encoding UTF8
