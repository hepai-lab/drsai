[CmdletBinding()]
param(
    [ValidateSet("Start", "Stop", "Status")]
    [string]$Action = "Start",
    [ValidateRange(1024, 65535)]
    [int]$Port = 22331
)

$ErrorActionPreference = "Stop"
$AppRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $AppRoot "..\..\.."))
$Cache = Join-Path $AppRoot ".cache\remote-workspace-demo"
$Key = Join-Path $Cache "id_ed25519"
$KnownHosts = Join-Path $Cache "known_hosts"
$Config = Join-Path $Cache "ssh_config"
$Container = "opendrsai-remote-workspace-demo"
$Image = "opendrsai-remote-workspace-demo:local"
$Dockerfile = Join-Path $AppRoot "tests\remote-workspace-demo\Dockerfile"

function Test-ContainerExists {
    $names = @(& docker.exe ps -a --format "{{.Names}}")
    return $names -contains $Container
}

if ($Action -eq "Stop") {
    if (Test-ContainerExists) { & docker.exe rm -f $Container | Out-Null }
    if (Test-Path -LiteralPath $Cache) { Remove-Item -LiteralPath $Cache -Recurse -Force }
    [pscustomobject]@{ status = "stopped"; container = $Container; temporaryCredentialsRemoved = $true } | ConvertTo-Json
    exit 0
}

if ($Action -eq "Status") {
    $running = $false
    if (Test-ContainerExists) {
        $running = (& docker.exe inspect -f "{{.State.Running}}" $Container).Trim() -eq "true"
    }
    [pscustomobject]@{ status = if ($running) { "running" } else { "stopped" }; container = $Container; port = $Port; sshConfig = $Config } | ConvertTo-Json
    exit 0
}

& docker.exe info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not ready." }
New-Item -ItemType Directory -Force -Path $Cache | Out-Null
if (-not (Test-Path -LiteralPath $Key)) {
    & ssh-keygen.exe -q -t ed25519 -N '""' -C "opendrsai-demo-temporary-credential" -f $Key
    if ($LASTEXITCODE -ne 0) { throw "Could not generate the temporary SSH key." }
}
& icacls.exe $Key /inheritance:r /grant:r "$env:USERNAME`:(F)" "SYSTEM`:(F)" | Out-Null
$PublicKey = (Get-Content -LiteralPath "$Key.pub" -Raw).Trim()

& docker.exe build -f $Dockerfile -t $Image $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "Could not build the Remote Workspace demo image." }
if (Test-ContainerExists) { & docker.exe rm -f $Container | Out-Null }
& docker.exe run -d --name $Container -p "127.0.0.1:${Port}:22" -e "OPENDRSAI_TEMPORARY_AUTHORIZED_KEY=$PublicKey" $Image | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not start the Remote Workspace demo container." }

New-Item -ItemType File -Force -Path $KnownHosts | Out-Null
$KeyForConfig = $Key.Replace("\", "/")
$KnownHostsForConfig = $KnownHosts.Replace("\", "/")
@"
Host opendrsai-demo
  HostName 127.0.0.1
  Port $Port
  User vscode
  IdentityFile $KeyForConfig
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile $KnownHostsForConfig
  LogLevel ERROR
"@ | Set-Content -LiteralPath $Config -Encoding ascii
foreach ($credentialFile in @($Config, $KnownHosts)) {
    & icacls.exe $credentialFile /inheritance:r /grant:r "$env:USERNAME`:(F)" "SYSTEM`:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not secure temporary SSH file: $credentialFile" }
}

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    & ssh.exe -o BatchMode=yes -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o ConnectTimeout=2 -i $Key -p $Port vscode@127.0.0.1 "printf ready" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw "The Remote Workspace demo SSH server did not become ready." }

[pscustomobject]@{
    status = "running"
    container = $Container
    port = $Port
    sshAlias = "opendrsai-demo"
    workspace = "/home/vscode/workspace"
    secondWorkspace = "/home/vscode/workspace-two"
    sshConfig = $Config
    temporaryCredential = $true
    desktopCommand = "`$env:OPENDRSAI_SSH_CONFIG='$Config'; npm run dev"
} | ConvertTo-Json
