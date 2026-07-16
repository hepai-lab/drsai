import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const entries = readdirSync(tmpdir(), { withFileTypes: true });
const leftovers = entries
  .filter((entry) => entry.isDirectory() && /^opendrsai-[A-Za-z0-9_.-]+$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

if (leftovers.length) {
  console.error([
    `OpenDrSai test temporary-directory cleanup failed: ${leftovers.length} director${leftovers.length === 1 ? "y" : "ies"} remain in ${tmpdir()}.`,
    ...leftovers.slice(0, 50).map((name) => `- ${name}`),
    ...(leftovers.length > 50 ? [`- ... and ${leftovers.length - 50} more`] : []),
  ].join("\n"));
  process.exit(1);
}

console.log(`OpenDrSai test temporary-directory cleanup verified: 0 directories in ${tmpdir()}.`);
