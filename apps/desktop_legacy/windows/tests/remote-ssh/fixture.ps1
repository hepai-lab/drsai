param(
  [ValidateSet("Up", "Down", "Status")]
  [string]$Action = "Up"
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Name = "opendrsai-remote-ssh-fixture"
$NameTwo = "opendrsai-remote-ssh-fixture-two"
$Image = "opendrsai-remote-ssh-fixture:local"
$Port = 22222
$PortTwo = 22223
$Key = Join-Path $Here "fixture_key"
$Pub = "$Key.pub"
$AuthorizedKeys = Join-Path $Here "authorized_keys"
$Config = Join-Path $Here "ssh_config"
$ConfigDirectory = Join-Path $Here "ssh_config.d"
$KnownHosts = Join-Path $Here "known_hosts_fixture"
$TrustedKnownHosts = Join-Path $Here "known_hosts_trusted_fixture"

if ($Action -eq "Down") {
  foreach ($ContainerName in @($Name, $NameTwo)) {
    if (docker ps -a --format "{{.Names}}" | Select-String -SimpleMatch $ContainerName) {
      docker rm -f $ContainerName | Out-Null
    }
  }
  Remove-Item -LiteralPath $Key, $Pub, $AuthorizedKeys, $Config, $KnownHosts, $TrustedKnownHosts -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $ConfigDirectory -Recurse -Force -ErrorAction SilentlyContinue
  exit 0
}
if ($Action -eq "Status") {
  docker inspect -f "{{.State.Status}}" $Name
  exit 0
}

if (-not (Test-Path -LiteralPath $Key)) {
  ssh-keygen.exe -q -t ed25519 -N '""' -C "opendrsai-acceptance-temporary" -f $Key
}
Copy-Item -LiteralPath $Pub -Destination $AuthorizedKeys -Force
New-Item -ItemType File -Force -Path $KnownHosts | Out-Null
New-Item -ItemType File -Force -Path $TrustedKnownHosts | Out-Null
New-Item -ItemType Directory -Force -Path $ConfigDirectory | Out-Null
$IncludePattern = ((Join-Path $ConfigDirectory "*.conf") -replace '\\', '/')
@"
Include $IncludePattern

Host wildcard-*
  HostName ignored.invalid
"@ | Set-Content -LiteralPath $Config -Encoding ascii
$IncludedConfig = Join-Path $ConfigDirectory "fixture.conf"
@"
Host opendrsai-fixture
  HostName 127.0.0.1
  Port $Port
  User vscode
  IdentityFile $Key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $TrustedKnownHosts
  LogLevel ERROR

Host opendrsai-fixture-two
  HostName 127.0.0.1
  Port $PortTwo
  User vscode
  IdentityFile $Key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $TrustedKnownHosts
  LogLevel ERROR

Host opendrsai-metadata
  HostName remote.metadata.example
  Port 2200
  User metadata-user
  IdentityFile $Key
  ProxyJump jump.example

Host opendrsai-auth-failure
  HostName 127.0.0.1
  Port $Port
  User vscode
  IdentityFile C:/opendrsai-missing-key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $TrustedKnownHosts

Host opendrsai-hostkey-failure
  HostName 127.0.0.1
  Port $Port
  User vscode
  IdentityFile $Key
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $KnownHosts

Host opendrsai-refused
  HostName 127.0.0.1
  Port 1
  User vscode

Host opendrsai-dns-failure
  HostName invalid.invalid
  Port 22
  User vscode

Host opendrsai-timeout
  HostName 192.0.2.1
  Port 22
  User vscode
"@ | Set-Content -LiteralPath $IncludedConfig -Encoding ascii
& icacls.exe $IncludedConfig /inheritance:r /grant:r "$env:USERNAME`:(F)" "SYSTEM`:(F)" | Out-Null
& icacls.exe $KnownHosts /inheritance:r /grant:r "$env:USERNAME`:(F)" "SYSTEM`:(F)" | Out-Null
& icacls.exe $TrustedKnownHosts /inheritance:r /grant:r "$env:USERNAME`:(F)" "SYSTEM`:(F)" | Out-Null

docker build -t $Image $Here
if (docker ps -a --format "{{.Names}}" | Select-String -SimpleMatch $Name) {
  docker rm -f $Name | Out-Null
}
docker run -d --name $Name -p "127.0.0.1:${Port}:22" $Image | Out-Null
if (docker ps -a --format "{{.Names}}" | Select-String -SimpleMatch $NameTwo) {
  docker rm -f $NameTwo | Out-Null
}
docker run -d --name $NameTwo -p "127.0.0.1:${PortTwo}:22" $Image | Out-Null

# Explicitly confirm only the disposable acceptance hosts. Product SSH calls keep
# StrictHostKeyChecking=yes and never depend on an implicit trust prompt.
for ($i = 0; $i -lt 30; $i++) {
  ssh.exe -F $Config -o StrictHostKeyChecking=accept-new -o BatchMode=yes opendrsai-fixture "true" 2>$null
  $FirstAccepted = $LASTEXITCODE -eq 0
  ssh.exe -F $Config -o StrictHostKeyChecking=accept-new -o BatchMode=yes opendrsai-fixture-two "true" 2>$null
  $SecondAccepted = $LASTEXITCODE -eq 0
  if ($FirstAccepted -and $SecondAccepted) { break }
  Start-Sleep -Milliseconds 500
}

for ($i = 0; $i -lt 30; $i++) {
  ssh.exe -F $Config -o BatchMode=yes opendrsai-fixture "printf fixture-ready" 2>$null
  $FirstReady = $LASTEXITCODE -eq 0
  ssh.exe -F $Config -o BatchMode=yes opendrsai-fixture-two "printf fixture-two-ready" 2>$null
  $SecondReady = $LASTEXITCODE -eq 0
  if ($FirstReady -and $SecondReady) { exit 0 }
  Start-Sleep -Milliseconds 500
}
throw "SSH fixture did not become ready."
