import { strict as assert } from "node:assert";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

if (process.platform !== "darwin") throw new Error("Update lab feed staging is restricted to the macOS release runner.");
const root = resolve(required("OPENDRSAI_MACOS_UPDATE_LAB_ROOT"));
const base = new URL(required("OPENDRSAI_MACOS_UPDATE_LAB_BASE_URL"));
assert.equal(base.protocol, "https:");
assert.equal(base.username, "");
assert.equal(base.password, "");
const tag = required("GITHUB_REF_NAME");
assert.match(tag, /^v[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/);
const target = resolve(root, tag);
assert.ok(target.startsWith(`${root}${sep}`), "update lab target escaped its configured root");
if (existsSync(target)) assert.equal(readdirSync(target).length, 0, `update lab target already contains files: ${target}`);
else mkdirSync(target, { recursive: true, mode: 0o750 });
const release = resolve(new URL("../release", import.meta.url).pathname);
const metadata = join(release, "latest-mac.yml");
const zips = readdirSync(release).filter((name) => name.endsWith(".zip"));
assert.ok(existsSync(metadata));
assert.equal(zips.length, 1);
copyFileSync(metadata, join(target, "latest-mac.yml"));
copyFileSync(join(release, zips[0]), join(target, basename(zips[0])));
const feed = new URL(`${encodeURIComponent(tag)}/`, base).toString();
const env = required("GITHUB_ENV");
await import("node:fs").then(({ appendFileSync }) => appendFileSync(env, `OPENDRSAI_MACOS_UPDATE_FEED_URL=${feed}\n`, "utf8"));
console.log(`Staged signed update lab feed: ${feed}`);

function required(name) { const value = process.env[name]?.trim(); assert.ok(value, `${name} is required`); return value; }
