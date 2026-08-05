# Python/uvicorn intentionally writes startup diagnostics to stderr.  PowerShell
# must not turn that stream into a terminating NativeCommandError.
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$StateRoot = Join-Path $HOME ".drsai"
$TokenPath = Join-Path $StateRoot "runtime\instance-token"
$Diagnostics = Join-Path $Root ".tmp\v4-gateway"

$env:DRSAI_API_HOST = "127.0.0.1"
$env:DRSAI_API_PORT = "18642"
$env:DRSAI_HOME = $StateRoot
$env:OPENDRSAI_GATEWAY_INSTANCE_TOKEN = (Get-Content -Raw $TokenPath).Trim()
$env:OPENDRSAI_RUNTIME_VERSION = "1.5.4"
# V4 real-device acceptance uses the deterministic, read-only Agent plan.  It
# is deliberately opt-in and scoped to this test launcher; production Desktop
# startup never inherits this setting.
$env:DRSAI_RUNTIME_CONTROLLED_MODEL = "1"
$env:PYTHONPATH = Join-Path $Root "cores\python\packages\drsai\src"

New-Item -ItemType Directory -Force $Diagnostics | Out-Null
Set-Location $Root
& (Join-Path $Root ".venv\Scripts\python.exe") -m drsai.backend.gateway `
    1>> (Join-Path $Diagnostics "runtime.stdout.log") `
    2>> (Join-Path $Diagnostics "runtime.stderr.log")
