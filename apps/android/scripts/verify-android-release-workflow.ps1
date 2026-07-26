param(
    [string]$Workflow
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$workflowPath = if (-not $Workflow) {
    Join-Path $repo ".github\workflows\android-release.yml"
} elseif ([IO.Path]::IsPathRooted($Workflow)) {
    $Workflow
} else {
    Join-Path $repo $Workflow
}
$source = Get-Content -LiteralPath $workflowPath -Raw
$buildScript = Get-Content -LiteralPath (Join-Path $PSScriptRoot "build-stage5-release.ps1") -Raw
$generateScript = Get-Content -LiteralPath (Join-Path $PSScriptRoot "generate-android-update-manifests.ps1") -Raw
$publishScript = Get-Content -LiteralPath (Join-Path $PSScriptRoot "publish-android-release.ps1") -Raw

$checks = [ordered]@{
    manual_dispatch = $source.Contains("workflow_dispatch:")
    protected_environment = $source.Contains("android-stable-release") -and $source.Contains("android-beta-release")
    beta_keystore_secret = $source.Contains("ANDROID_BETA_KEYSTORE_BASE64")
    release_keystore_secret = $source.Contains("ANDROID_RELEASE_KEYSTORE_BASE64")
    local_release_verification = $source.Contains("verify-android-release.ps1")
    publish_is_explicit = $source.Contains('if: ${{ inputs.publish }}')
    signing_material_cleanup = $source.Contains("Remove signing material")
    stable_uses_release_variant = $buildScript.Contains('"stable" { "release" }')
    beta_uses_mvp_variant = $buildScript.Contains('"beta" { "mvp" }')
    dual_manifests = $generateScript.Contains("latest-android-cdn.json") -and
        $generateScript.Contains("latest-android-github.json")
    stable_debug_signer_blocked = $generateScript.Contains("Stable Android releases require the organization Release Keystore")
    immutable_version_asset = $publishScript.Contains("--forbid-overwrite")
    channel_manifest_last = $publishScript.IndexOf("ossutil cp channel manifest") -gt
        $publishScript.IndexOf("gh upload immutable APK")
}
$failed = @($checks.GetEnumerator() | Where-Object { -not $_.Value } | ForEach-Object Key)
if ($failed.Count -gt 0) {
    throw "Android release workflow contract failed: $($failed -join ', ')"
}
[ordered]@{
    schemaVersion = 1
    generatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    result = "passed"
    checks = $checks
} | ConvertTo-Json -Depth 5
