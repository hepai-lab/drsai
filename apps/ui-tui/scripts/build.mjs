#!/usr/bin/env node
/**
 * build.mjs — bundle ui-tui into a single dist/entry.js for PyPI distribution.
 *
 * Output:
 *   dist/entry.js          (CJS bundle, ~2-3 MB, runs with `node dist/entry.js`)
 *
 * Run via:
 *   pnpm build
 */

import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
mkdirSync(resolve(root, 'dist'), { recursive: true })

await build({
  entryPoints: [resolve(root, 'src/entry.tsx')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: resolve(root, 'dist/entry.mjs'),
  // No external: pull every dep into the bundle so PyPI users don't need npm.
  // The one tricky case is `react-devtools-core` which Ink lazily imports
  // only in DEV mode — we shim it with an empty module.
  plugins: [
    {
      name: 'stub-devtools',
      setup(b) {
        b.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core',
          namespace: 'stub-devtools',
        }))
        b.onLoad({ filter: /.*/, namespace: 'stub-devtools' }, () => ({
          contents: 'export function connectToDevTools() {}\nexport default { connectToDevTools() {} };',
          loader: 'js',
        }))
      },
    },
  ],
  loader: { '.js': 'jsx' },
  jsx: 'automatic',
  minify: false,
  sourcemap: 'inline',
  logLevel: 'info',
  banner: {
    js: 'import { createRequire as topLevelCreateRequire } from \'module\';\nconst require = topLevelCreateRequire(import.meta.url);\n',
  },
})

console.log('✓ Built dist/entry.mjs')
