import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const checkOnly = process.argv.includes("--check");
const root = resolve(import.meta.dirname, "../../../..");
const evidenceRoot = join(root, "docs/desktop/evidence");
const ledgerPath = join(evidenceRoot, "opendrsai-windows-phase3-acceptance-ledger.json");
const manifestPath = join(evidenceRoot, "opendrsai-windows-phase3-release-manifest.json");
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const windowsPackage = JSON.parse(readFileSync(join(root, "apps/desktop/windows/package.json"), "utf8"));

const features = ledger.features.map((feature) => {
  const implementation = bindPaths(feature.implementation ?? []);
  const tests = bindPaths(feature.tests ?? []);
  const evidence = bindPaths(feature.evidence ?? []);
  const missing = [
    ...(feature.status === "accepted" && !implementation.length ? ["implementation"] : []),
    ...(feature.status === "accepted" && !tests.length ? ["tests"] : []),
    ...(feature.status === "accepted" && !evidence.length ? ["evidence"] : []),
    ...[...implementation, ...tests, ...evidence].filter((item) => item.missing).map((item) => item.path),
  ];
  return {
    id: feature.id,
    status: feature.status,
    profile: feature.profile,
    implementation,
    tests,
    evidence,
    acceptance_passed: feature.acceptance?.passed === true,
    missing,
  };
});
const accepted = features.filter((feature) => feature.status === "accepted" && feature.acceptance_passed && feature.missing.length === 0).length;
const modelEvidence = Array.from({ length: 8 }, (_, index) => bindFile(`docs/desktop/evidence/opendrsai-windows-phase3-model-convergence-mc${String(index + 1).padStart(2, "0")}.json`));
const rendererBundles = readdirSync(join(root, "apps/desktop/windows/out/renderer/assets"))
  .filter((name) => /^index-.*\.js$/.test(name))
  .map((name) => `apps/desktop/windows/out/renderer/assets/${name}`);
const buildArtifacts = bindPaths([
  "apps/desktop/windows/resources/backend/backend-source.json",
  "apps/desktop/windows/out/main/index.js",
  "apps/desktop/windows/out/preload/index.js",
  ...rendererBundles,
  "apps/desktop/windows/release/win-unpacked/resources/app.asar",
  "apps/desktop/windows/release/win-unpacked/OpenDrSai.exe",
]);
const externalGates = {
  real_hai_discovery_text_vision_generation_editing: false,
  macos_signed_notarized_artifact: false,
  windows_clean_standard_account_matrix_10_of_10: false,
  product_tracker_93_of_93: false,
};
const blockingGates = [
  ...(accepted === 50 ? [] : [`fixed_phase3_ledger_${accepted}_of_50`]),
  ...Object.entries(externalGates).filter(([, passed]) => !passed).map(([name]) => name),
  ...(features.some((feature) => feature.missing.length) ? ["feature_bindings_missing"] : []),
  ...(buildArtifacts.some((item) => item.missing) ? ["build_artifacts_missing"] : []),
  ...(modelEvidence.some((item) => item.missing) ? ["model_evidence_missing"] : []),
];
const manifest = {
  schema_version: "opendrsai.windows.phase3.release-manifest/1",
  captured_at: new Date().toISOString(),
  product: { name: "OpenDrSai Windows Desktop", version: windowsPackage.version, architecture: process.arch },
  release_ready: blockingGates.length === 0,
  blocking_gates: blockingGates,
  progress: { accepted, total: 50, percent: Math.floor((accepted * 10000) / 50) / 100 },
  external_gates: externalGates,
  plan: bindFile("docs/desktop/opendrsai-windows-full-agent-runtime-phase3-product-completion-plan.md"),
  ledger: bindFile("docs/desktop/evidence/opendrsai-windows-phase3-acceptance-ledger.json"),
  model_evidence: modelEvidence,
  build_artifacts: buildArtifacts,
  features,
  manifest_revision: "",
};
manifest.manifest_revision = `sha256:${digest(Buffer.from(canonicalManifest(manifest)))}`;

if (checkOnly) {
  if (!existsSync(manifestPath)) fail("release manifest is missing; run generate:opendrsai-phase3-release-manifest");
  const stored = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (stored.schema_version !== manifest.schema_version) fail("release manifest schema is invalid");
  if (stored.manifest_revision !== manifest.manifest_revision) fail("release manifest is stale relative to source, tests, evidence, ledger or package artifacts");
  if (stored.release_ready !== manifest.release_ready || JSON.stringify(stored.blocking_gates) !== JSON.stringify(manifest.blocking_gates)) fail("release readiness is not fail-closed");
  console.log(`OpenDrSai P3 release manifest verified: ${accepted}/50 accepted; release_ready=${manifest.release_ready}; ${blockingGates.length} blocking gates.`);
} else {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`OpenDrSai P3 release manifest generated: ${relative(root, manifestPath)} (${accepted}/50; release_ready=${manifest.release_ready}).`);
}

function bindPaths(paths) { return paths.map(bindFile); }
function bindFile(path) {
  const absolute = join(root, path);
  if (resolve(absolute) === resolve(manifestPath)) return { path: path.replaceAll("\\", "/"), binding: "self_manifest_revision" };
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return { path: path.replaceAll("\\", "/"), missing: true };
  const content = readFileSync(absolute);
  return { path: path.replaceAll("\\", "/"), bytes: content.length, sha256: `sha256:${digest(content)}` };
}
function canonicalManifest(value) { return JSON.stringify({ ...value, captured_at: null, manifest_revision: null }); }
function digest(content) { return createHash("sha256").update(content).digest("hex"); }
function fail(message) { console.error(`OpenDrSai P3 release manifest verification failed: ${message}`); process.exit(1); }
