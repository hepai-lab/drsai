param(
    [string]$EvidenceDir = "C:\OpenDrSaiEvidence",
    [string]$SecretDir = "C:\OpenDrSaiTemporarySecrets",
    [int]$SshPort = 22224,
    [string]$HostAddress = "",
    [string]$RunId = "remote-workspace-sandbox-probe",
    [switch]$ShutdownOnComplete
)

$ErrorActionPreference = "Stop"
$results = [Collections.Generic.List[object]]::new()

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail = "") {
    $results.Add([pscustomobject]@{
        name = $Name
        status = $(if ($Passed) { "PASS" } else { "FAIL" })
        detail = $Detail
    }) | Out-Null
    Write-Host "[$(if ($Passed) { 'PASS' } else { 'FAIL' })] $Name $Detail"
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
    $commandLine = (($Arguments | ForEach-Object {
        $argument = [string]$_
        if ($argument -match '[\s"]') { '"' + ($argument -replace '"', '\"') + '"' } else { $argument }
    }) -join ' ')
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $FilePath
    $startInfo.Arguments = $commandLine
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw "Failed to start $FilePath" }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        return [pscustomobject]@{
            exitCode = $process.ExitCode
            output = [string]$stdout.Result
            error = [string]$stderr.Result
        }
    } finally {
        $process.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$startedAt = (Get-Date).ToUniversalTime()
$evidencePath = Join-Path $EvidenceDir "remote-workspace-sandbox-probe.json"
$keyPath = Join-Path $SecretDir "opendrsai-acceptance-temporary"
$localKeyPath = Join-Path $env:TEMP "opendrsai-acceptance-temporary"
$knownHostsPath = Join-Path $EvidenceDir "known_hosts.temporary"
$configPath = Join-Path $EvidenceDir "ssh_config.temporary"

try {
    Add-Check "Windows Sandbox identity" ($env:USERNAME -eq "WDAGUtilityAccount") $env:USERNAME
    $packageWriteProbe = "C:\OpenDrSaiPackage\.opendrsai-write-probe"
    $packageReadOnly = $false
    try { [IO.File]::WriteAllText($packageWriteProbe, "must-not-write"); Remove-Item -LiteralPath $packageWriteProbe -Force -ErrorAction SilentlyContinue } catch { $packageReadOnly = $true }
    Add-Check "Package mapping is read-only" $packageReadOnly $packageWriteProbe
    $secretWriteProbe = Join-Path $SecretDir ".opendrsai-write-probe"
    $secretReadOnly = $false
    try { [IO.File]::WriteAllText($secretWriteProbe, "must-not-write"); Remove-Item -LiteralPath $secretWriteProbe -Force -ErrorAction SilentlyContinue } catch { $secretReadOnly = $true }
    Add-Check "Temporary credential mapping is read-only" $secretReadOnly $secretWriteProbe
    $evidenceWriteProbe = Join-Path $EvidenceDir ".opendrsai-write-probe"
    $evidenceWritable = $false
    try { [IO.File]::WriteAllText($evidenceWriteProbe, "evidence-write-ok"); $evidenceWritable = (Get-Content -LiteralPath $evidenceWriteProbe -Raw) -eq "evidence-write-ok" } finally { Remove-Item -LiteralPath $evidenceWriteProbe -Force -ErrorAction SilentlyContinue }
    Add-Check "Evidence mapping is writable" $evidenceWritable $evidenceWriteProbe
    Add-Check "Temporary private key exists" (Test-Path -LiteralPath $keyPath) $keyPath
    Copy-Item -LiteralPath $keyPath -Destination $localKeyPath -Force
    & icacls.exe $localKeyPath /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null
    Add-Check "Temporary private key copied with local ACL" ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $localKeyPath)) $localKeyPath
    $ssh = Join-Path $env:OPENDRSAI_PORTABLE_OPENSSH_DIR "ssh.exe"
    $sshKeyscan = Join-Path $env:OPENDRSAI_PORTABLE_OPENSSH_DIR "ssh-keyscan.exe"
    Add-Check "Portable OpenSSH client" (Test-Path -LiteralPath $ssh) $ssh
    Add-Check "Portable OpenSSH key scanner" (Test-Path -LiteralPath $sshKeyscan) $sshKeyscan
    if (-not (Test-Path -LiteralPath $ssh) -or -not (Test-Path -LiteralPath $sshKeyscan)) { throw "Portable OpenSSH client is missing." }
    $sshVersion = Invoke-Native $ssh @("-V")
    Add-Check "Portable OpenSSH executable starts" ($sshVersion.exitCode -eq 0 -and "$($sshVersion.output) $($sshVersion.error)" -match "OpenSSH") "exit=$($sshVersion.exitCode) $($sshVersion.output) $($sshVersion.error)"

    $route = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
        Sort-Object RouteMetric, InterfaceMetric |
        Select-Object -First 1
    $gatewayAddress = [string]$route.NextHop
    Add-Check "Sandbox host gateway discovered" ($gatewayAddress -match '^\d+\.\d+\.\d+\.\d+$') $gatewayAddress
    $candidateAddresses = @($HostAddress, $gatewayAddress) | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -Unique
    $keyScan = $null
    $hostAddress = ""
    $attemptDetails = [Collections.Generic.List[string]]::new()
    foreach ($candidate in $candidateAddresses) {
        $tcp = [Net.Sockets.TcpClient]::new()
        try {
            $connect = $tcp.ConnectAsync($candidate, $SshPort)
            $tcpConnected = $connect.Wait(5000) -and $tcp.Connected
        } catch { $tcpConnected = $false } finally { $tcp.Dispose() }
        Add-Check "Raw TCP reachability $candidate`:$SshPort" $tcpConnected "source=sandbox"
        $attempt = Invoke-Native $sshKeyscan @("-p", [string]$SshPort, "-T", "10", $candidate)
        $attemptDetails.Add("$candidate exit=$($attempt.exitCode) output=$($attempt.output) error=$($attempt.error)") | Out-Null
        if ($attempt.exitCode -eq 0 -and $attempt.output) { $keyScan = $attempt; $hostAddress = $candidate; break }
    }
    Add-Check "Linux SSH host key discovered" ([bool]$keyScan) "candidates=$($candidateAddresses -join ',') selected=$hostAddress port=$SshPort attempts=$($attemptDetails -join ' | ')"
    if (-not $keyScan) { throw "ssh-keyscan could not reach the Docker Linux target." }
    [IO.File]::WriteAllText($knownHostsPath, $keyScan.output + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

    $config = @"
Host opendrsai-acceptance-temporary
  HostName $hostAddress
  Port $SshPort
  User opendrsai
  IdentityFile $localKeyPath
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $knownHostsPath
  ConnectTimeout 10
  LogLevel ERROR
"@
    [IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))

    $probe = Invoke-Native $ssh @("-F", $configPath, "opendrsai-acceptance-temporary", "printf 'REMOTE_WORKSPACE_SSH_OK'; test -d /workspaces/alpha; test -d /workspaces/beta")
    Add-Check "Sandbox to Docker SSH" ($probe.exitCode -eq 0 -and $probe.output -match "REMOTE_WORKSPACE_SSH_OK") "exit=$($probe.exitCode) output=$($probe.output) error=$($probe.error)"
    if ($probe.exitCode -ne 0) { throw "Sandbox could not authenticate to the Docker Linux target." }

    $paths = Invoke-Native $ssh @("-F", $configPath, "opendrsai-acceptance-temporary", "readlink -f /workspaces/alpha; readlink -f /workspaces/beta")
    Add-Check "Remote workspace canonical paths" ($paths.exitCode -eq 0 -and $paths.output -match "/workspaces/alpha" -and $paths.output -match "/workspaces/beta") $paths.output
} catch {
    Add-Check "Probe execution" $false $_.Exception.Message
} finally {
    Remove-Item -LiteralPath $localKeyPath -Force -ErrorAction SilentlyContinue
    $failed = @($results | Where-Object status -eq "FAIL")
    $evidence = [ordered]@{
        schemaVersion = 1
        runId = $RunId
        generatedAt = (Get-Date).ToUniversalTime().ToString("o")
        durationSeconds = [math]::Round(((Get-Date).ToUniversalTime() - $startedAt).TotalSeconds, 2)
        temporaryCredential = $true
        passed = ($failed.Count -eq 0)
        checks = $results
    }
    [IO.File]::WriteAllText($evidencePath, (($evidence | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    if ($ShutdownOnComplete) { Start-Process shutdown.exe -ArgumentList @("/s", "/t", "0") -WindowStyle Hidden }
    if ($failed.Count -gt 0) { exit 1 }
}
