param(
  [ValidateSet("Up", "Down", "Status")]
  [string]$Action = "Up"
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Name = "opendrsai-remote-ssh-fixture"
$Image = "opendrsai-remote-ssh-fixture:local"
$Port = 22222
$Key = Join-Path $Here "fixture_key"
$Pub = "$Key.pub"
$AuthorizedKeys = Join-Path $Here "authorized_keys"
$Config = Join-Path $Here "ssh_config"

if ($Action -eq "Down") {
  if (docker ps -a --format "{{.Names}}" | Select-String -SimpleMatch $Name) {
    docker rm -f $Name | Out-Null
  }
  exit 0
}
if ($Action -eq "Status") {
  docker inspect -f "{{.State.Status}}" $Name
  exit 0
}

if (-not (Test-Path -LiteralPath $Key)) {
  ssh-keygen.exe -q -t ed25519 -N '""' -f $Key
}
Copy-Item -LiteralPath $Pub -Destination $AuthorizedKeys -Force
@"
Host opendrsai-fixture
  HostName 127.0.0.1
  Port $Port
  User vscode
  IdentityFile $Key
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile NUL
  LogLevel ERROR
"@ | Set-Content -LiteralPath $Config -Encoding ascii

docker build -t $Image $Here
if (docker ps -a --format "{{.Names}}" | Select-String -SimpleMatch $Name) {
  docker rm -f $Name | Out-Null
}
docker run -d --name $Name -p "127.0.0.1:${Port}:22" $Image | Out-Null

for ($i = 0; $i -lt 30; $i++) {
  ssh.exe -F $Config -o BatchMode=yes opendrsai-fixture "printf fixture-ready" 2>$null
  if ($LASTEXITCODE -eq 0) { exit 0 }
  Start-Sleep -Milliseconds 500
}
throw "SSH fixture did not become ready."
