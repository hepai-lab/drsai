import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const desktop = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const repo = resolve(desktop, "../../..");
const output = resolve(process.argv[2] || join(desktop, ".cache", "remote-workspace-sandbox-artifact"));
const python = process.env.OPENDRSAI_TEST_PYTHON || "C:\\Python311\\python.exe";
const publisher = "opendrsai-temporary-sandbox-acceptance";
const version = `sandbox-e2e-${Date.now()}`;

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const wheelOutput = join(output, "wheel");
mkdirSync(wheelOutput, { recursive: true });
run(python, ["-m", "pip", "wheel", "--no-deps", "-w", wheelOutput, "cores/python/packages/drsai"], repo);
const builtWheel = join(wheelOutput, readdirSync(wheelOutput).filter((name) => name.endsWith(".whl")).sort().at(-1));
const wheel = join(output, basename(builtWheel));
copyFileSync(builtWheel, wheel);
const artifact = readFileSync(wheel);
const sha256 = createHash("sha256").update(artifact).digest("hex");
const keys = generateKeyPairSync("ed25519");
const payload = Buffer.from(`opendrsai-runtime-artifact-v1\n${version}\n${sha256}\n`, "utf8");
const signature = sign(null, payload, keys.privateKey).toString("base64");
const trustStore = join(output, "temporary-runtime-publishers.json");
writeFileSync(trustStore, `${JSON.stringify({ [publisher]: keys.publicKey.export({ type: "spki", format: "pem" }) }, null, 2)}\n`, "utf8");
const manifest = { schemaVersion: 1, temporaryCredential: true, publisher, version, sha256, signature, wheel: basename(wheel), trustStore: basename(trustStore) };
writeFileSync(join(output, "runtime-artifact.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Temporary signed Runtime acceptance artifact prepared: ${output}`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
