[CmdletBinding()]
param(
    [string]$BaseUrl = "https://ai-dev.ihep.ac.cn/apiv2/v1",
    [Parameter(Mandatory = $true)][string]$AccessTokenFile,
    [string]$Query = "HEPiX 2026",
    [ValidateRange(0, 20)][int]$StabilityRuns = 0,
    [switch]$IncludeExtract,
    [switch]$AllowBillableTests,
    [string]$EvidencePath
)

$ErrorActionPreference = "Stop"
$model = "hepai/tavily-web-search-v1"
$token = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $AccessTokenFile)).Trim()
if (-not $token -or $token.Contains("`n") -or $token.Contains("`r")) {
    throw "The access-token file must contain exactly one non-empty token."
}
if (($IncludeExtract -or $StabilityRuns -gt 0) -and -not $AllowBillableTests) {
    throw "Extract and stability checks require -AllowBillableTests."
}

$root = $BaseUrl.TrimEnd('/')
$headers = @{ Authorization = "Bearer $token" }

function Invoke-P3Json {
    param([string]$Method, [string]$Path, [hashtable]$Body, [string]$IdempotencyKey)
    $requestHeaders = @{} + $headers
    if ($IdempotencyKey) { $requestHeaders["Idempotency-Key"] = $IdempotencyKey }
    try {
        $parameters = @{
            Uri = "$root/tools/web-search/$Path"
            Method = $Method
            Headers = $requestHeaders
            ContentType = "application/json"
        }
        if ($Body) { $parameters.Body = $Body | ConvertTo-Json -Depth 8 -Compress }
        return Invoke-RestMethod @parameters
    } catch {
        $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
        $code = "transport_failure"
        try {
            $errorPayload = $_.ErrorDetails.Message | ConvertFrom-Json
            if ($errorPayload.error.code) { $code = [string]$errorPayload.error.code }
        } catch { }
        throw "P3 request failed safely: HTTP=$status code=$code"
    }
}

$capability = Invoke-P3Json -Method GET -Path "capabilities"
if ($capability.object -ne "list" -or $capability.status -ne "available" -or $capability.data.Count -ne 1) {
    $status = if ($capability.status) { [string]$capability.status } else { "invalid_response" }
    throw "Managed Web Search is not available: status=$status"
}
$resource = $capability.data[0]
if ($resource.id -ne $model -or @($resource.functions) -notcontains "search" -or @($resource.functions) -notcontains "extract") {
    throw "Managed Web Search capability contract does not match v1."
}

function Invoke-LowCostSearch {
    param([string]$RequestKey)
    $body = @{
        model = $model
        arguments = @{
            query = $Query
            max_results = 3
            search_depth = "basic"
            include_answer = $false
            include_raw_content = $false
            include_images = $false
            auto_parameters = $false
        }
    }
    $response = Invoke-P3Json -Method POST -Path "search" -Body $body -IdempotencyKey $RequestKey
    if ($response.object -ne "web_search.response" -or $response.model -ne $model -or $response.function -ne "search") {
        throw "Search returned an invalid P3 envelope."
    }
    if (-not $response.request_id -or -not $response.trace_id -or @($response.data.results).Count -lt 1) {
        throw "Search did not provide traceable results."
    }
    return $response
}

$first = Invoke-LowCostSearch -RequestKey "opendrsai-p3-live-$([guid]::NewGuid().ToString('N'))"
$requestIds = [System.Collections.Generic.List[string]]::new()
$requestIds.Add([string]$first.request_id)
$sourceDomains = @($first.data.results | ForEach-Object { ([uri]$_.url).DnsSafeHost } | Sort-Object -Unique)
$extractRequestId = $null

if ($IncludeExtract) {
    $firstUrl = [string]$first.data.results[0].url
    $extractBody = @{
        model = $model
        arguments = @{ url = $firstUrl; extract_depth = "basic"; format = "markdown"; include_images = $false }
    }
    $extract = Invoke-P3Json -Method POST -Path "extract" -Body $extractBody -IdempotencyKey "opendrsai-p3-extract-$([guid]::NewGuid().ToString('N'))"
    if ($extract.object -ne "web_search.response" -or $extract.function -ne "extract" -or @($extract.data.results).Count -lt 1) {
        throw "Extract returned an invalid P3 envelope."
    }
    $extractRequestId = [string]$extract.request_id
}

for ($index = 0; $index -lt $StabilityRuns; $index++) {
    $run = Invoke-LowCostSearch -RequestKey "opendrsai-p3-stability-$index-$([guid]::NewGuid().ToString('N'))"
    $requestIds.Add([string]$run.request_id)
}
if (($requestIds | Sort-Object -Unique).Count -ne $requestIds.Count) {
    throw "Stability checks returned duplicate request IDs."
}

$summary = [ordered]@{
    schema = "opendrsai.tavily-p3-live-acceptance/1"
    checked_at = [DateTimeOffset]::UtcNow.ToString("o")
    base_host = ([uri]$root).DnsSafeHost
    capability_status = [string]$capability.status
    model = $model
    functions = @($resource.functions)
    initial_result_count = @($first.data.results).Count
    source_domains = $sourceDomains
    extract_completed = [bool]$extractRequestId
    request_count = $requestIds.Count + $(if ($extractRequestId) { 1 } else { 0 })
    unique_request_ids = ($requestIds | Sort-Object -Unique).Count + $(if ($extractRequestId) { 1 } else { 0 })
    stability_runs = $StabilityRuns
    secret_fields_present = $false
}

$json = $summary | ConvertTo-Json -Depth 6
if ($EvidencePath) {
    $target = [System.IO.Path]::GetFullPath($EvidencePath)
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
    [System.IO.File]::WriteAllText($target, $json, [System.Text.UTF8Encoding]::new($false))
}
$json
Remove-Variable token -ErrorAction SilentlyContinue
