import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const entries = readdirSync(tmpdir(), { withFileTypes: true });
const baseline = parseBaseline(process.env.OPENDRSAI_TEST_TEMP_BASELINE);
const leftovers = entries
  .filter((entry) => entry.isDirectory() && /^opendrsai-[A-Za-z0-9_.-]+$/.test(entry.name))
  .map((entry) => entry.name)
  .filter((name) => !baseline.has(name))
  .sort();

if (leftovers.length) {
  console.error([
    `OpenDrSai test temporary-directory cleanup failed: ${leftovers.length} director${leftovers.length === 1 ? "y" : "ies"} remain in ${tmpdir()}.`,
    ...leftovers.slice(0, 50).map((name) => `- ${name}`),
    ...(leftovers.length > 50 ? [`- ... and ${leftovers.length - 50} more`] : []),
  ].join("\n"));
  process.exit(1);
}

console.log(
  `OpenDrSai test temporary-directory cleanup verified: 0 new directories in ${tmpdir()}`
  + `${baseline.size ? ` (${baseline.size} pre-existing ignored).` : "."}`,
);

function parseBaseline(value) {
  if (!value) return new Set();
  try {
    const parsed = JSON.parse(value);
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    throw new Error("OPENDRSAI_TEST_TEMP_BASELINE must be a JSON string array.");
  }
}
