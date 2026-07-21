import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const checkOnly = process.argv.includes("--check");
const required = [
  "OPENDRSAI_REMOTE_BOOTSTRAP_ALIAS",
  "OPENDRSAI_REMOTE_HOST_ALIAS",
  "OPENDRSAI_REMOTE_HOST_NAME",
  "OPENDRSAI_REMOTE_HOST_USER",
  "OPENDRSAI_REMOTE_HOST_PORT",
  "OPENDRSAI_REMOTE_HOST_IDENTITY_FILE",
  "OPENDRSAI_REMOTE_HOST_FINGERPRINT",
  "OPENDRSAI_REMOTE_HOST_EVIDENCE",
];

if (checkOnly) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    marker: "Protected remote_3090 acceptance orchestrator is ready.",
    requiredEnvironment: required,
    lifecycle: ["verified temporary Python", "temporary SSH key", "external host smoke", "owned cleanup", "independent evidence verification"],
  }, null, 2));
  process.exit(0);
}

for (const name of required) {
  if (!String(process.env[name] || "").trim()) throw new Error(`${name} is required.`);
}
const bootstrapAlias = assertAlias(process.env.OPENDRSAI_REMOTE_BOOTSTRAP_ALIAS);
const identityFile = resolve(String(process.env.OPENDRSAI_REMOTE_HOST_IDENTITY_FILE));
if (!existsSync(identityFile) || !existsSync(`${identityFile}.pub`)) throw new Error("The temporary acceptance keypair is missing.");
const publicKey = readFileSync(`${identityFile}.pub`, "utf8").trim();
if (!/^ssh-ed25519 [A-Za-z0-9+/=]+ opendrsai-temporary-remote-3090-acceptance$/.test(publicKey)) {
  throw new Error("The temporary acceptance public key has an invalid type or label.");
}
const publicKeyBase64 = Buffer.from(publicKey, "utf8").toString("base64");
const prerequisiteScript = readFileSync(resolve(root, "scripts", "remote-host-acceptance-prerequisite.sh"), "utf8").replace(/\r\n/g, "\n");
const runToken = randomUUID().replaceAll("-", "");
const evidencePath = resolve(String(process.env.OPENDRSAI_REMOTE_HOST_EVIDENCE));
let provisionAttempted = false;
let acceptanceError = null;
let cleanupError = null;

try {
  provisionAttempted = true;
  const provision = runRemotePrerequisite("provision");
  const line = provision.split(/\r?\n/).findLast((value) => value.startsWith("OPENDRSAI_PYTHON_PATH="));
  if (!line) throw new Error("Temporary Python provisioning did not return its path.");
  const remotePython = line.slice("OPENDRSAI_PYTHON_PATH=".length);
  const expectedPython = `/home/${process.env.OPENDRSAI_REMOTE_HOST_USER}/.cache/opendrsai/acceptance-python-${runToken}/python3`;
  if (remotePython !== expectedPython) throw new Error(`Unexpected temporary Python path: ${remotePython}`);
  process.env.OPENDRSAI_REMOTE_PYTHON = remotePython;
  run(process.execPath, ["scripts/verify-external-remote-host.mjs"], root);
} catch (error) {
  acceptanceError = error;
} finally {
  if (provisionAttempted) {
    try {
      runRemotePrerequisite("cleanup");
    } catch (error) {
      cleanupError = error;
    }
  }
}

if (cleanupError) {
  throw new AggregateError(
    [acceptanceError, cleanupError].filter(Boolean),
    "remote_3090 acceptance or prerequisite cleanup failed.",
  );
}
if (acceptanceError) throw acceptanceError;
if (!existsSync(evidencePath)) throw new Error("remote_3090 acceptance did not produce evidence.");
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
evidence.temporaryPrerequisites = {
  userLevelPython: true,
  uvVersion: "0.11.29",
  sha256Verified: true,
  temporarySshKey: true,
  cleaned: true,
};
writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
run(process.execPath, ["scripts/verify-external-remote-host-evidence.mjs"], root);
console.log(`Protected remote_3090 acceptance passed with prerequisite cleanup. Evidence: ${evidencePath}`);

function runRemotePrerequisite(mode) {
  const result = spawnSync("ssh.exe", [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=15",
    bootstrapAlias,
    "sh", "-s", "--", mode, runToken, publicKeyBase64,
  ], {
    cwd: root,
    input: prerequisiteScript,
    encoding: "utf8",
    windowsHide: true,
    timeout: mode === "provision" ? 600_000 : 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Remote prerequisite ${mode} failed with exit code ${result.status}.`);
  return result.stdout || "";
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit", windowsHide: true, timeout: 1_200_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}.`);
}

function assertAlias(value) {
  const alias = String(value || "").trim();
  if (!/^[A-Za-z0-9_.@-]{1,128}$/.test(alias)) throw new Error("OPENDRSAI_REMOTE_BOOTSTRAP_ALIAS is invalid.");
  return alias;
}
