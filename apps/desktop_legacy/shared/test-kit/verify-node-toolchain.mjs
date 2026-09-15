import { strict as assert } from "node:assert";

const [major, minor, patch] = process.versions.node.split(".").map(Number);
assert.equal(major, 22, `OpenDrSai Desktop requires Node 22; received ${process.version}. Run 'nvm use' from the repository root.`);
assert.ok(Number.isInteger(minor) && Number.isInteger(patch), `Invalid Node version: ${process.version}`);
console.log(`Desktop Node toolchain verified: ${process.version}.`);
