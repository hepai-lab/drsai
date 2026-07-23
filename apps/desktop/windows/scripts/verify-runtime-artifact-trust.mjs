import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const app = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const temp = await mkdtemp(join(tmpdir(), "opendrsai-artifact-trust-"));
try {
  const bundle = join(temp, "runtimeArtifactTrust.mjs");
  await build({ entryPoints: [join(app, "../shared/main/runtimeArtifactTrust.ts")], outfile: bundle, bundle: true, platform: "node", format: "esm", target: "node22" });
  const trust = await import(pathToFileURL(bundle).href);
  const trusted = generateKeyPairSync("ed25519");
  const wrong = generateKeyPairSync("ed25519");
  const publicKey = trusted.publicKey.export({ type: "spki", format: "pem" });
  const artifact = Buffer.from("signed-runtime-artifact");
  const sha256 = (await import("node:crypto")).createHash("sha256").update(artifact).digest("hex");
  const declaration = { version: "1.2.3", expectedSha256: sha256, publisher: "opendrsai-release", signature: sign(null, trust.runtimeArtifactSignaturePayload("1.2.3", sha256), trusted.privateKey).toString("base64") };
  assert.deepEqual(trust.verifyRuntimeArtifactTrust(artifact, declaration, { "opendrsai-release": publicKey }), { sha256, publisher: "opendrsai-release" });
  assert.throws(() => trust.verifyRuntimeArtifactTrust(Buffer.from("tampered"), declaration, { "opendrsai-release": publicKey }), /SHA-256/);
  const wrongSignature = sign(null, trust.runtimeArtifactSignaturePayload("1.2.3", sha256), wrong.privateKey).toString("base64");
  assert.throws(() => trust.verifyRuntimeArtifactTrust(artifact, { ...declaration, signature: wrongSignature }, { "opendrsai-release": publicKey }), /signature verification/);
  assert.throws(() => trust.verifyRuntimeArtifactTrust(artifact, { ...declaration, publisher: "unknown" }, { "opendrsai-release": publicKey }), /not trusted/);
  console.log("Runtime artifact digest, signature and trusted-publisher verification passed.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
