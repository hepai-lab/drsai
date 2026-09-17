import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectConversationResources } from '../resourcePresentation.js'
import { conversationResourceStateSemantics } from '../../../../cores/protocol/owop/conversationResourceStateSemantics.js'

const fixturePath = [
  resolve('../../../cores/protocol/oaep/conversation-resources-p1.fixture.json'),
  resolve('../../cores/protocol/oaep/conversation-resources-p1.fixture.json'),
].find(existsSync)
if (!fixturePath) throw new Error('conversation resource P1 fixture was not found')

const resources = projectConversationResources(JSON.parse(readFileSync(fixturePath, 'utf8')))
if (resources.length !== 3) throw new Error(`expected 3 resource associations, got ${resources.length}`)
if (resources[0]?.command !== '/resource file-plan-p1') throw new Error('input resource command drifted')
if (resources[1]?.relation !== 'file_change_target') throw new Error('file change relation was not preserved')
if (resources[2]?.command !== '/artifact artifact-report-p1') throw new Error('artifact command drifted')
if (resources.some((resource) => /[A-Za-z]:[\\/]/.test(resource.label))) throw new Error('host path leaked into TUI')

console.log('TUI conversation resource P1 fixture passed.')

const p2FixturePath = [
  resolve('../../../cores/protocol/oaep/conversation-resources-p2.fixture.json'),
  resolve('../../cores/protocol/oaep/conversation-resources-p2.fixture.json'),
].find(existsSync)
if (!p2FixturePath) throw new Error('conversation resource P2 fixture was not found')
const p2Fixture = JSON.parse(readFileSync(p2FixturePath, 'utf8'))
const p2Resources = projectConversationResources(p2Fixture.snapshot)
if (p2Resources.map((resource) => resource.associationId).join(',') !== p2Fixture.expected_association_ids.join(',')) {
  throw new Error('P2 association order or identity drifted')
}
if (p2Resources[0]?.ref.resource_id !== p2Resources[1]?.ref.resource_id || p2Resources[0]?.associationId === p2Resources[1]?.associationId) {
  throw new Error('same ResourceKey associations were incorrectly deduplicated')
}
if (p2Resources[0]?.command !== '/resource info assoc-plan-first') throw new Error('P2 association command drifted')
if (p2Resources[2]?.association?.operation_id !== 'operation-publish-report') throw new Error('operation identity was lost')
if (p2Resources.some((resource) => /[A-Za-z]:[\\/]/.test(resource.label))) throw new Error('host path leaked into P2 TUI')

console.log('TUI conversation resource P2 fixture passed.')

const stateFixturePath = [
  resolve('../../../cores/protocol/owop/conversation-resource-states-p2.fixture.json'),
  resolve('../../cores/protocol/owop/conversation-resource-states-p2.fixture.json'),
].find(existsSync)
if (!stateFixturePath) throw new Error('conversation resource state fixture was not found')
const stateFixture = JSON.parse(readFileSync(stateFixturePath, 'utf8'))
for (const vector of stateFixture.cases) {
  const actual = conversationResourceStateSemantics(vector.descriptor)
  if (JSON.stringify(actual) !== JSON.stringify(vector.expected)) throw new Error(`TUI resource state semantics drifted: ${vector.id}`)
}
