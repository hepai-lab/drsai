import { createGatewayEventHandler } from '../app/createGatewayEventHandler.js'
import { $current, setCurrent } from '../app/turnStore.js'
import { newAssistantTurn } from '../app/types.js'
import type { GatewayClient } from '../gatewayClient.js'

setCurrent(newAssistantTurn())
const handler = createGatewayEventHandler({} as GatewayClient)
handler({
  type: 'artifact.created',
  payload: {
    artifact_id: 'artifact-docx',
    name: '短诗_静夜.docx',
    path: 'artifacts/短诗_静夜.docx',
    size: 12,
    previewable: false,
    downloadable: true,
    resource_ref: {
      protocol: 'owop/1',
      workspace_id: 'workspace-tui',
      resource_type: 'file',
      resource_id: 'file-docx',
      relation: 'output_artifact',
      presentation: 'card',
    },
  },
})

const current = $current.get()
const artifact = current?.contentParts[0]
if (!artifact || artifact.kind !== 'artifact') throw new Error('artifact content part was not created')
if (artifact.artifactId !== 'artifact-docx') throw new Error('artifact id was not preserved')
if (artifact.path !== 'artifacts/短诗_静夜.docx') throw new Error('Workspace-relative path was not preserved')
if (artifact.downloadable !== true || artifact.previewable !== false) throw new Error('Artifact capabilities were not preserved')
if (artifact.resourceRef?.resource_id !== 'file-docx') throw new Error('OAEP resource reference was not preserved')

console.log('TUI artifact event projection passed.')
