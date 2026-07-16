param()

$ErrorActionPreference = "Stop"
$Desktop = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Fixture = Join-Path $Desktop "tests\remote-ssh\fixture.ps1"
$FixtureDir = Join-Path $Desktop "tests\remote-ssh"
$Key = Join-Path $FixtureDir "fixture_key"
$Config = Join-Path $FixtureDir "ssh_agent_config"
$Service = Get-Service -Name ssh-agent -ErrorAction SilentlyContinue
if (-not $Service) { throw "Windows system ssh-agent service is unavailable." }
$OriginalStartMode = $Service.StartType
$OriginalState = $Service.Status
$KeyLoaded = $false

try {
  & $Fixture -Action Up
  Set-Service -Name ssh-agent -StartupType Manual
  Start-Service -Name ssh-agent
  (Get-Service ssh-agent).WaitForStatus("Running", [TimeSpan]::FromSeconds(10))
  & ssh-add.exe $Key | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "The temporary SSH key could not be loaded into the Windows system ssh-agent." }
  $KeyLoaded = $true
  @"
Host opendrsai-agent-fixture
  HostName 127.0.0.1
  Port 22222
  User vscode
  IdentitiesOnly no
  StrictHostKeyChecking no
  UserKnownHostsFile NUL
  LogLevel ERROR
"@ | Set-Content -LiteralPath $Config -Encoding ascii
  $Output = & ssh.exe -F $Config -o BatchMode=yes -o ConnectTimeout=10 opendrsai-agent-fixture printf opendrsai-agent-ok
  if ($LASTEXITCODE -ne 0 -or ($Output -join "") -notmatch "opendrsai-agent-ok") { throw "System ssh-agent authentication did not reach the Linux fixture." }
  Write-Host "Windows system ssh-agent authentication verification passed with a temporary Ed25519 key."
}
finally {
  if ($KeyLoaded -and (Test-Path -LiteralPath $Key) -and (Get-Service ssh-agent).Status -eq "Running") { & ssh-add.exe -d $Key | Out-Null }
  Remove-Item -LiteralPath $Config -Force -ErrorAction SilentlyContinue
  if ($OriginalState -ne "Running") { Stop-Service -Name ssh-agent -Force -ErrorAction SilentlyContinue }
  switch ($OriginalStartMode) {
    "Disabled" { Set-Service -Name ssh-agent -StartupType Disabled }
    "Automatic" { Set-Service -Name ssh-agent -StartupType Automatic }
    default { Set-Service -Name ssh-agent -StartupType Manual }
  }
  & $Fixture -Action Down
}
