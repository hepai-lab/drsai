import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const ledger = JSON.parse(readFileSync(resolve(root, "docs/remote_workespace/codex-adapter-p8-feature-ledger.json"), "utf8"));
const rows = Object.entries(ledger.features || {});
if (ledger.total !== 60 || rows.length !== 60 || new Set(rows.map(([id]) => id)).size !== 60) throw new Error("P8 ledger is not one-to-one with 60 features.");
for (const [id, row] of rows) {
  if (!/^M(?:0[1-9]|10)-F0[1-6]$/.test(id) || row.status !== "accepted") throw new Error(`Invalid P8 ledger row: ${id}`);
  const source = resolve(root, row.source);
  const artifact = resolve(root, row.artifact);
  if (!existsSync(source) || !existsSync(artifact)) throw new Error(`${id} evidence is missing: ${row.source} / ${row.artifact}`);
  const result = JSON.parse(readFileSync(artifact, "utf8"));
  if (result.suite !== row.suite || result.status !== 0 || result.executed !== true) throw new Error(`${id} evidence command was not executed successfully.`);
  const digest = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  if (result.artifactDigest && result.artifactDigest !== digest) throw new Error(`${id} artifact self-digest is inconsistent.`);
}
console.log("Codex Adapter P8 feature ledger verified: 60/60 executable evidence bindings.");
