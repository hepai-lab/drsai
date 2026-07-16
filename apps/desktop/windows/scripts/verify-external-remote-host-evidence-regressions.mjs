import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = process.env.OPENDRSAI_REMOTE_HOST_EVIDENCE
  || join(root, "release", "product-evidence", "remote-workspace", "remote_3090-final.json");
const evidence = JSON.parse(readFileSync(source, "utf8"));
if (evidence.hostAlias !== "remote_3090") throw new Error("The regression suite requires real remote_3090 evidence.");
const temporaryRoot = mkdtempSync(join(tmpdir(), "opendrsai-remote-evidence-regression-"));

try {
  verify(evidence, true);
  const missing = structuredClone(evidence);
  delete missing.temporaryPrerequisites;
  verify(missing, false, /temporary prerequisite evidence is missing/);
  const unverified = structuredClone(evidence);
  unverified.temporaryPrerequisites.sha256Verified = false;
  verify(unverified, false, /SHA-256 verification is missing/);
  const uncleaned = structuredClone(evidence);
  uncleaned.temporaryPrerequisites.cleaned = false;
  verify(uncleaned, false, /temporary prerequisites were not cleaned/);
  console.log("remote_3090 evidence prerequisite regressions passed (valid + missing + unverified + uncleaned).");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function verify(candidate, shouldPass, expectedFailure) {
  const path = join(temporaryRoot, `${shouldPass ? "valid" : crypto.randomUUID()}.json`);
  writeFileSync(path, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
  const result = spawnSync(process.execPath, ["scripts/verify-external-remote-host-evidence.mjs"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      OPENDRSAI_REMOTE_HOST_EVIDENCE: path,
      OPENDRSAI_EXPECTED_REMOTE_HOST_ALIAS: "remote_3090",
      OPENDRSAI_EXPECTED_REMOTE_HOST_USER: evidence.nonRootUser,
      OPENDRSAI_EXPECTED_REMOTE_HOST_FINGERPRINT: evidence.hostKeyFingerprint,
    },
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (result.error) throw result.error;
  if (shouldPass && result.status !== 0) throw new Error(`Valid remote_3090 evidence was rejected: ${output}`);
  if (!shouldPass && (result.status === 0 || !expectedFailure.test(output))) {
    throw new Error(`Invalid remote_3090 evidence was not rejected as expected: ${output}`);
  }
}
