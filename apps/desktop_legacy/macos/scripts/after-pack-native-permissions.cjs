const { chmodSync, realpathSync, statSync } = require("node:fs");
const { join, relative, sep } = require("node:path");

module.exports = async function normalizeNativePermissions(context) {
  if (process.platform !== "darwin") return;
  const outputRoot = realpathSync(context.appOutDir);
  const app = realpathSync(join(outputRoot, `${context.packager.appInfo.productFilename}.app`));
  const helper = join(app, "Contents", "Resources", "app.asar.unpacked", "node_modules", "node-pty", "prebuilds", "darwin-arm64", "spawn-helper");
  const relation = relative(app, helper);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`)) throw new Error("node-pty spawn helper escaped the packaged App.");
  const info = statSync(helper);
  if (!info.isFile()) throw new Error("Packaged node-pty spawn helper is missing.");
  chmodSync(helper, 0o755);
  if ((statSync(helper).mode & 0o111) === 0) throw new Error("Packaged node-pty spawn helper is not executable.");
};
