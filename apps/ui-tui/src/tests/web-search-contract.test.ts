import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MANAGED_WEB_SEARCH_MODEL, WEB_SEARCH_CONTRACT_SCHEMA, WEB_SEARCH_ERROR_CODES,
  WEB_SEARCH_FUNCTIONS, WEB_SEARCH_PROVIDER_MODES, webSearchRecovery,
} from '../webSearchContract.js'

const fixturePath = [
  resolve(process.cwd(), 'cores/protocol/web-search/managed-web-search-v1.json'),
  resolve(process.cwd(), '../../cores/protocol/web-search/managed-web-search-v1.json'),
].find(existsSync)
assert.ok(fixturePath, 'managed Web Search fixture is missing')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
assert.equal(WEB_SEARCH_CONTRACT_SCHEMA, fixture.schema)
assert.equal(MANAGED_WEB_SEARCH_MODEL, fixture.model)
assert.deepEqual([...WEB_SEARCH_FUNCTIONS], fixture.functions)
assert.deepEqual([...WEB_SEARCH_PROVIDER_MODES], fixture.provider_modes)
assert.deepEqual([...WEB_SEARCH_ERROR_CODES], fixture.errors.map((item: { code: string }) => item.code))
for (const item of fixture.errors as Array<{ code: string; retryable: boolean; action: string }>) {
  assert.deepEqual(webSearchRecovery(item.code), { retryable: item.retryable, action: item.action })
}
assert.equal(webSearchRecovery('private_internal_error'), null)
console.log(`TUI managed Web Search contract passed (${fixture.errors.length} errors).`)
