#!/usr/bin/env node

import { build } from '../../desktop/node_modules/esbuild/lib/main.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const built = await build({
  entryPoints: [resolve(import.meta.dirname, '../src/tests/oaep-runtime-adapter.test.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  plugins: [{
    name: 'test-websocket-stub',
    setup(builder) {
      builder.onResolve({ filter: /^ws$/ }, () => ({ path: 'ws', namespace: 'test-websocket-stub' }))
      builder.onLoad({ filter: /.*/, namespace: 'test-websocket-stub' }, () => ({
        contents: 'export default class WebSocket { static OPEN = 1 }', loader: 'js',
      }))
    },
  }],
})
const source = built.outputFiles[0]?.text
if (!source) throw new Error('TUI OAEP Runtime resource verifier did not build')
const directory = await mkdtemp(join(tmpdir(), 'opendrsai-tui-oaep-route-'))
try {
  const output = join(directory, 'verify.mjs')
  await writeFile(output, source, 'utf8')
  await import(pathToFileURL(output).href)
} finally {
  await rm(directory, { recursive: true, force: true })
}
