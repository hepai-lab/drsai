param(
    [Parameter(Mandatory=$true)][string[]]$ObjectUrls,
    [Parameter(Mandatory=$true)][string]$OssutilConfig
)

$ErrorActionPreference = "Stop"

function Read-IniValue([string]$Path, [string]$Name) {
    $line = Get-Content -LiteralPath $Path -Encoding UTF8 |
        Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
        Select-Object -First 1
    if (-not $line) { throw "Missing $Name in ossutil config." }
    return ($line -split "=", 2)[1].Trim()
}

function Escape-Rfc3986([string]$Value) {
    return [Uri]::EscapeDataString($Value).Replace("%7E", "~")
}

$accessKeyId = Read-IniValue $OssutilConfig "accessKeyID"
$accessKeySecret = Read-IniValue $OssutilConfig "accessKeySecret"
$parameters = [ordered]@{
    AccessKeyId = $accessKeyId
    Action = "RefreshObjectCaches"
    Format = "JSON"
    ObjectPath = (($ObjectUrls | ForEach-Object { $_.Trim() }) -join "`n")
    ObjectType = "File"
    SignatureMethod = "HMAC-SHA1"
    SignatureNonce = [guid]::NewGuid().ToString()
    SignatureVersion = "1.0"
    Timestamp = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    Version = "2018-05-10"
}
$canonical = ($parameters.GetEnumerator() | Sort-Object Key | ForEach-Object {
    "$(Escape-Rfc3986 ([string]$_.Key))=$(Escape-Rfc3986 ([string]$_.Value))"
}) -join "&"
$stringToSign = "GET&%2F&$(Escape-Rfc3986 $canonical)"
$hmac = [Security.Cryptography.HMACSHA1]::new([Text.Encoding]::UTF8.GetBytes("$accessKeySecret&"))
try { $signature = [Convert]::ToBase64String($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($stringToSign))) }
finally { $hmac.Dispose() }
$query = "$canonical&Signature=$(Escape-Rfc3986 $signature)"
$result = Invoke-RestMethod -Method Get -Uri "https://cdn.aliyuncs.com/?$query" -TimeoutSec 30
$result | ConvertTo-Json -Depth 5
