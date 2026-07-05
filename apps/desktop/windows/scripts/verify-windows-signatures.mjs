import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseDir = join(root, "release");
const requireSigned = process.env.REQUIRE_SIGNED_WINDOWS_ARTIFACTS === "1";
const expectedThumbprint = normalizeThumbprint(process.env.EXPECTED_WINDOWS_SIGNER_THUMBPRINT || "");
const expectedSubject = (process.env.EXPECTED_WINDOWS_SIGNER_SUBJECT || "").trim();
const artifacts = [
  join(releaseDir, `OpenDrSai-${readPackageVersion()}-setup.exe`),
  join(releaseDir, "bootstrapper", "OpenDrSai Installer.exe"),
];

const failures = [];
if (requireSigned && !expectedThumbprint) {
  failures.push("EXPECTED_WINDOWS_SIGNER_THUMBPRINT is required when REQUIRE_SIGNED_WINDOWS_ARTIFACTS=1.");
}
for (const artifact of artifacts) {
  if (!existsSync(artifact)) {
    failures.push(`${artifact}: missing`);
    continue;
  }
  const signature = getSignatureInfo(artifact);
  if (signature.status !== "Valid") {
    failures.push(`${artifact}: ${signature.status}`);
    continue;
  }
  if (expectedThumbprint && normalizeThumbprint(signature.thumbprint) !== expectedThumbprint) {
    failures.push(`${artifact}: signer thumbprint ${signature.thumbprint || "<missing>"} does not match EXPECTED_WINDOWS_SIGNER_THUMBPRINT`);
  }
  if (expectedSubject && !signature.subject.includes(expectedSubject)) {
    failures.push(`${artifact}: signer subject ${signature.subject || "<missing>"} does not include EXPECTED_WINDOWS_SIGNER_SUBJECT`);
  }
}

if (failures.length) {
  const message = [
    "Windows signature verification did not pass:",
    ...failures.map((failure) => `- ${failure}`),
  ].join("\n");
  if (requireSigned) {
    console.error(message);
    process.exit(1);
  }
  console.warn(message);
  console.warn("Continuing because REQUIRE_SIGNED_WINDOWS_ARTIFACTS is not 1.");
} else {
  console.log("Windows signatures verified.");
}

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return packageJson.version;
}

function getSignatureInfo(path) {
  if (process.platform !== "win32") {
    return { status: "SkippedNonWindows", thumbprint: "", subject: "" };
  }
  const command = [
    `$sig = Get-AuthenticodeSignature -LiteralPath ${quotePowerShellString(path)}`,
    "$thumbprint = if ($sig.SignerCertificate) { $sig.SignerCertificate.Thumbprint } else { '' }",
    "$subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { '' }",
    "[pscustomobject]@{ Status = [string]$sig.Status; Thumbprint = $thumbprint; Subject = $subject } | ConvertTo-Json -Compress",
  ].join("; ");
  try {
    const output = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        command,
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const parsed = JSON.parse(output);
    return {
      status: String(parsed.Status || ""),
      thumbprint: String(parsed.Thumbprint || ""),
      subject: String(parsed.Subject || ""),
    };
  } catch (error) {
    return {
      status: error instanceof Error ? error.message : String(error),
      thumbprint: "",
      subject: "",
    };
  }
}

function normalizeThumbprint(value) {
  return value.replace(/[^0-9a-f]/gi, "").toUpperCase();
}

function quotePowerShellString(value) {
  return `'${value.replace(/'/g, "''")}'`;
}
