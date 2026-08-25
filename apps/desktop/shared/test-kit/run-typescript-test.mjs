/**
 * Run a TypeScript test with no build step and no dependencies.
 *
 *     node shared/test-kit/run-typescript-test.mjs shared/test-kit/verify-desktop-surface.mts
 *
 * `run-bundled-test.mjs` is the established runner and remains the one CI uses;
 * it needs `esbuild` from the desktop workspace's `node_modules`.  This one needs
 * nothing but Node 22.18+ (type stripping is on by default there and in 24), so a
 * checkout that has never run `npm install` -- a fresh clone, a Python-side
 * developer, a CI job that only touches the backend -- can still verify the
 * desktop contract against a live Runtime.
 *
 * Two Node features do the work:
 *
 * - **Type stripping** erases annotations in place without type checking.  That
 *   is the right trade here: `npm run typecheck` is what checks types, and a
 *   runner that also type-checked would fail on unrelated errors elsewhere in the
 *   tree and block a contract test that is otherwise fine.
 * - **`module.registerHooks`** resolves the extensionless relative specifiers the
 *   desktop tree uses (`from "../api/desktopGateway"`).  Native ESM requires an
 *   extension; the bundler does not, so without this hook the same source would
 *   have to be written two ways.
 *
 * Stripping cannot handle `enum`, `namespace`, parameter properties, or anything
 * else that emits code from a type.  Nothing under `shared/main/desktopGateway/` uses
 * them, and that is a constraint worth keeping: it is also what makes the tree
 * loadable by every other tool that only strips.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATE_EXTENSIONS = [".ts", ".mts", ".tsx", ".js", ".mjs"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Only relative specifiers: a bare name is a package, and guessing a file
    // extension for one would mask a genuinely missing dependency.
    if (specifier.startsWith(".") && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      if (!existsSync(fileURLToPath(base))) {
        for (const extension of CANDIDATE_EXTENSIONS) {
          const candidate = new URL(`${specifier}${extension}`, context.parentURL);
          if (existsSync(fileURLToPath(candidate))) {
            return { url: candidate.href, shortCircuit: true };
          }
        }
        for (const extension of CANDIDATE_EXTENSIONS) {
          const candidate = new URL(`${specifier}/index${extension}`, context.parentURL);
          if (existsSync(fileURLToPath(candidate))) {
            return { url: candidate.href, shortCircuit: true };
          }
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const entry = process.argv[2];
if (!entry) {
  process.stderr.write("Usage: node run-typescript-test.mjs <entry.mts>\n");
  process.exit(2);
}
if (!existsSync(entry)) {
  process.stderr.write(`No such test entry: ${entry}\n`);
  process.exit(2);
}

await import(pathToFileURL(entry).href);
