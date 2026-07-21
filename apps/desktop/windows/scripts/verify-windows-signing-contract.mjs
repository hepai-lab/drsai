import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const releaseSigner = readFileSync(join(root, "scripts", "sign-windows-release.ps1"), "utf8");
const ciSigner = readFileSync(join(root, "scripts", "sign-windows-bootstrapper.ps1"), "utf8");
const evidenceGenerator = readFileSync(join(root, "scripts", "generate-windows-signing-evidence.mjs"), "utf8");
const remoteWorkspaceFinal = readFileSync(join(root, "scripts", "verify-remote-workspace-final.mjs"), "utf8");
const internalReadiness = readFileSync(join(root, "scripts", "verify-internal-release-readiness.mjs"), "utf8");
const publicRelease = readFileSync(join(root, "scripts", "verify-windows-public-release.mjs"), "utf8");
const artifactVerifier = readFileSync(join(root, "scripts", "verify-windows-artifacts.mjs"), "utf8");
const workflow = readFileSync(resolve(root, "../../..", ".github", "workflows", "windows-desktop.yml"), "utf8");
const promotionWorkflow = readFileSync(resolve(root, "../../..", ".github", "workflows", "windows-release-promote.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const failures = [];
const ciParameterBlock = ciSigner.slice(0, ciSigner.indexOf("$ErrorActionPreference"));

assert(releaseSigner.includes('DefaultParameterSetName = "Pfx"'), "release signer does not define mutually exclusive certificate sources");
assert(releaseSigner.includes('ParameterSetName = "Store"'), "release signer omits certificate-store mode");
assert(releaseSigner.includes('ValidateSet("CurrentUser", "LocalMachine")'), "release signer omits CurrentUser/LocalMachine validation");
assert(releaseSigner.includes("Import-PfxCertificate") && releaseSigner.includes("-Exportable:$false"), "release signer does not import PFX keys non-exportably");
assert(releaseSigner.includes("$probe.HasPrivateKey"), "release signer omits private-key validation");
assert(releaseSigner.includes('1.3.6.1.5.5.7.3.3'), "release signer omits Code Signing EKU validation");
assert(releaseSigner.includes("$probe.NotBefore") && releaseSigner.includes("$probe.NotAfter"), "release signer omits certificate validity validation");
assert(releaseSigner.includes('Invoke-Checked $signtool.FullName @("verify", "/pa", $Path)'), "release signer omits immediate Authenticode verification");
assert(releaseSigner.includes("$signature.TimeStamperCertificate") && releaseSigner.includes("timestampVerified = $true"), "release signer does not verify and record the actual RFC 3161 timestamp");
assert(releaseSigner.includes("EXPECTED_WINDOWS_SIGNER_THUMBPRINT") && releaseSigner.includes("EXPECTED_WINDOWS_SIGNER_SUBJECT"), "release signer omits strict final signer identity verification");
assert(releaseSigner.includes("passwordPersisted = $false"), "release signer evidence omits password persistence invariant");
assert(releaseSigner.includes("versionConsistencyVerified = $true"), "release signer evidence omits package/manifest/summary version consistency");
assert(releaseSigner.includes("Get-FileHash -LiteralPath $desktopExecutable -Algorithm SHA256"), "release signer evidence omits the signed Desktop executable digest");
assert(releaseSigner.includes("Get-FileHash -LiteralPath $runtimeZip -Algorithm SHA256"), "release signer evidence omits the Runtime ZIP digest");
assert(releaseSigner.includes("Get-FileHash -LiteralPath $msi -Algorithm SHA256"), "release signer evidence omits the signed MSI digest");
assert(releaseSigner.includes("containsSignedDesktopExecutable = $true"), "release signer evidence does not bind the Runtime ZIP to its signed executable");
assert(releaseSigner.includes("manifestDigestVerified = $true"), "release signer evidence does not record Runtime manifest digest verification");
assert(releaseSigner.includes("codeSigningEku = $true") && releaseSigner.includes("immediateAuthenticodeVerification = $true"), "release signer evidence omits certificate/signature verification flags");
assert(releaseSigner.includes('Invoke-Checked "npm.cmd" @("run", "verify:signing-evidence")'), "release signer does not independently verify its final evidence");

assert(ciSigner.includes("$CertificateBase64 = $env:WINDOWS_CERTIFICATE"), "CI signer does not source PFX material from a secret environment variable");
assert(ciSigner.includes("$CertificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD"), "CI signer does not source the password from a secret environment variable");
assert(!/Certificate(Base64|Password)/i.test(ciParameterBlock), "CI signer accepts certificate secrets as command-line parameters");
assert(ciSigner.includes("Import-PfxCertificate") && ciSigner.includes("-Exportable:$false"), "CI signer does not import its key non-exportably");
assert(ciSigner.includes("Remove-Item -LiteralPath $pfx -Force"), "CI signer does not remove its temporary PFX before signing");
assert(ciSigner.indexOf("Remove-Item -LiteralPath $pfx -Force") < ciSigner.indexOf("& $signtool sign"), "CI signer starts signtool before deleting the temporary PFX");
assert(!/\s\/p\s/i.test(ciSigner), "CI signer exposes the PFX password through signtool /p");
assert(!/\s\/f\s+\$pfx/i.test(ciSigner), "CI signer passes the PFX path to signtool instead of using the certificate store");
assert(ciSigner.includes("$ExpectedThumbprint") && ciSigner.includes("$ExpectedSubject"), "CI signer omits expected signer identity validation");
assert(ciSigner.includes("passwordInChildProcess = $false"), "CI ValidateOnly evidence omits child-process password isolation");
assert(ciSigner.includes("& $signtool verify /pa $Bootstrapper"), "CI signer omits immediate MSI verification");
assert(ciSigner.includes("$signature.TimeStamperCertificate"), "CI signer does not verify the MSI RFC 3161 timestamp");
assert(evidenceGenerator.includes("Runtime ZIP does not contain the exact signed Desktop executable"), "CI evidence generator does not bind the embedded Runtime executable byte-for-byte");
assert(evidenceGenerator.includes('REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "1"'), "CI evidence generator does not invoke strict Authenticode verification");
assert(evidenceGenerator.includes("EXPECTED_WINDOWS_SIGNER_THUMBPRINT is required"), "CI evidence generator accepts an unpinned signer identity");
assert(evidenceGenerator.includes("manifest.runtime?.sha256 === sha256(runtimeZip)"), "CI evidence generator does not bind the Runtime ZIP to the update manifest");
assert(evidenceGenerator.includes("lacks a verifiable RFC 3161 timestamp") && evidenceGenerator.includes("timestampVerified: true"), "CI evidence generator does not verify and record the actual timestamp");

assert(packageJson.scripts?.["sign:bootstrapper"]?.includes("sign-windows-bootstrapper.ps1"), "package sign:bootstrapper is not wired to the hardened signer");
assert(packageJson.scripts?.["sign:win"]?.includes("sign-windows-release.ps1"), "package sign:win is not wired to the hardened release signer");
assert(packageJson.scripts?.["verify:signing-evidence"]?.includes("verify-windows-signing-evidence.mjs"), "package signing evidence verifier is not registered");
assert(packageJson.scripts?.["generate:signing-evidence"]?.includes("generate-windows-signing-evidence.mjs"), "package signing evidence generator is not registered");
assert(packageJson.scripts?.["verify:signing-timestamp-contract"]?.includes("verify-windows-signing-timestamp.ps1"), "package real timestamp contract verifier is not registered");
assert(packageJson.scripts?.["verify:signing-evidence-regressions"]?.includes("verify-windows-signing-evidence-regressions.mjs"), "package signing evidence negative regressions are not registered");
assert(packageJson.scripts?.["verify:internal-release-ready"]?.includes("verify-internal-release-readiness.mjs"), "package internal release gate is not registered");
assert(packageJson.scripts?.["verify:windows-public-release"]?.includes("verify-windows-public-release.mjs"), "package public release gate is not registered");
assert(internalReadiness.includes('REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "0"') && internalReadiness.includes('SKIP_PUBLIC_RELEASE_CHECK: "1"'), "internal readiness does not explicitly classify signing and publishing as external gates");
assert(remoteWorkspaceFinal.includes('REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "0"') && remoteWorkspaceFinal.includes("verify-windows-signing-contract.mjs"), "Remote Workspace completion does not enforce unsigned-internal/signing-ready separation");
assert(!remoteWorkspaceFinal.includes('run(process.execPath, ["scripts/verify-windows-signing-evidence.mjs"])'), "Remote Workspace completion still requires organization signing evidence");
assert(publicRelease.includes('REQUIRE_SIGNED_WINDOWS_ARTIFACTS: "1"') && publicRelease.includes('SKIP_PUBLIC_RELEASE_CHECK: "0"'), "public release gate does not require trusted signatures and published assets");
assert(publicRelease.includes("verify-windows-signing-evidence.mjs"), "public release gate omits independently verified signing evidence");
assert(!artifactVerifier.includes('process.env.REQUIRE_RELEASE_READY === "1"'), "artifact integrity verifier incorrectly treats strict internal readiness as public distribution");
assert(artifactVerifier.includes('process.env.REQUIRE_SIGNED_WINDOWS_ARTIFACTS === "1"'), "artifact verifier does not enforce public-distribution policy for signed releases");
assert(workflow.includes("WINDOWS_CERTIFICATE: ${{ secrets.WINDOWS_CERTIFICATE }}"), "Windows workflow does not inject the certificate from GitHub Secrets");
assert(workflow.includes("WINDOWS_CERTIFICATE_PASSWORD: ${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}"), "Windows workflow does not inject the certificate password from GitHub Secrets");
assert(workflow.includes("EXPECTED_WINDOWS_SIGNER_THUMBPRINT"), "Windows workflow omits expected signer thumbprint verification");
assert(workflow.includes("npm run sign:bootstrapper"), "Windows workflow does not invoke the hardened bootstrapper signer");
assert(workflow.includes("npm run verify:signing-contract"), "Windows build workflow does not run the signing contract before release");
assert(workflow.includes("npm run generate:signing-evidence") && workflow.includes("windows-signatures.json"), "Windows build workflow does not generate and publish signing evidence");
assert(promotionWorkflow.includes("npm run verify:signing-contract"), "Windows promotion workflow does not run the signing contract");
assert(promotionWorkflow.includes('pattern "windows-signatures.json"') && promotionWorkflow.includes("npm run verify:signing-evidence"), "Windows promotion workflow does not download and verify signing evidence");

if (failures.length) {
  console.error(["Windows signing contract verification failed:", ...failures.map((failure) => `- ${failure}`)].join("\n"));
  process.exit(1);
}
console.log("Windows signing contract verified: PFX/store/HSM preflight, secret isolation, immediate verification and CI wiring are enforced.");

function assert(condition, message) {
  if (!condition) failures.push(message);
}
