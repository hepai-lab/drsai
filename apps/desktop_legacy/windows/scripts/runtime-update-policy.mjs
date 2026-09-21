import { readFileSync } from "node:fs";

const policyPath = new URL("../resources/update/updater-policy.json", import.meta.url);
export const updaterPolicy = JSON.parse(readFileSync(policyPath, "utf8"));

if (updaterPolicy.schemaVersion !== 1) {
  throw new Error(`Unsupported updater policy schema: ${updaterPolicy.schemaVersion}.`);
}

parseSemver(updaterPolicy.minimumSafeUpdaterVersion);

export function resolveMinimumUpdaterVersion(override) {
  const version = String(override || updaterPolicy.minimumSafeUpdaterVersion).trim();
  parseSemver(version);
  if (compareSemver(version, updaterPolicy.minimumSafeUpdaterVersion) !== 0) {
    throw new Error(
      `minimumUpdaterVersion ${version} must remain at the direct-update baseline ${updaterPolicy.minimumSafeUpdaterVersion}. ` +
      "Change updater-policy.json in a reviewed compatibility migration instead of overriding a release.",
    );
  }
  return version;
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const count = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value));
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}
