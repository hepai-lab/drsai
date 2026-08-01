/**
 * Test: Streaming contentParts ordering with various scenarios.
 *
 * Simulates gateway events and verifies that contentParts maintain
 * the correct interleaving order of text segments and tool calls.
 *
 * Scenarios:
 *   1. Text → Tool → Text → Tool → Text (standard interleaving)
 *   2. Subagent output (subagent.thinking with visual markers)
 *   3. Subagent tool calls (subagent.tool)
 *   4. Tool result updates (tool.complete)
 *   5. Multiple subagent blocks within one turn
 *   6. Empty text between tools
 *   7. Text accumulation within a single segment
 */

import { createGatewayEventHandler } from '../app/createGatewayEventHandler.js'
import { $current, setCurrent } from '../app/turnStore.js'
import { getPartText, newAssistantTurn, type ContentPart, type AssistantTurn, type TextContentPart } from '../app/types.js'
import type { GatewayEvent } from '../gatewayTypes.js'
import type { GatewayClient } from '../gatewayClient.js'

// ── Helpers ──────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  const aStr = JSON.stringify(actual)
  const eStr = JSON.stringify(expected)
  if (aStr === eStr) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
    console.error(`    expected: ${eStr}`)
    console.error(`    actual:   ${aStr}`)
  }
}

/** Build a fake GatewayClient — the event handler doesn't use it directly
 *  except as a type, so a minimal stub suffices. */
const fakeGw = {} as GatewayClient

/** Build a minimal fake TurnController that just tracks finalize calls. */
let finalizeCount = 0
const fakeController = {
  submit: () => {},
  finalize: () => { finalizeCount++ },
  interrupt: () => {},
} as never

/** Derive the full text from contentParts (used during streaming
 *  when turn.text is not yet materialised). */
function getFullText(turn: AssistantTurn): string {
  if (turn.text) return turn.text
  return turn.contentParts
    .filter((p): p is ContentPart & { kind: 'text' } => p.kind === 'text')
    .map(p => getPartText(p))
    .join('')
}

/** Reset state before each test. */
function reset(): void {
  setCurrent(newAssistantTurn())
  finalizeCount = 0
}

/** Get the current contentParts as a summary array for easy assertion. */
function contentPartSummary(parts: ContentPart[]): string[] {
  return parts.map(p => {
    if (p.kind === 'text') {
      const text = getPartText(p)
      const preview = text.length > 40 ? text.slice(0, 37) + '...' : text
      return `text:"${preview}"`
    }
    return `tool:${p.toolId}`
  })
}

// ── Build event helpers ───────────────────────────────────────────────

function ev(type: string, payload: Record<string, unknown>): GatewayEvent {
  return { type, payload } as GatewayEvent
}

function msgDelta(text: string): GatewayEvent {
  return ev('message.delta', { text })
}

function toolStart(toolId: string, name: string, args: Record<string, unknown> = {}): GatewayEvent {
  return ev('tool.start', { tool_id: toolId, name, args })
}

function toolComplete(toolId: string, name: string, result: string, durationMs = 100): GatewayEvent {
  return ev('tool.complete', { tool_id: toolId, name, args: {}, result, duration_ms: durationMs })
}

function msgComplete(usage?: Record<string, unknown>): GatewayEvent {
  return ev('message.complete', {
    text: '',
    usage: usage || { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300, model: 'test-model', status: 'complete' },
    status: 'complete',
  })
}

function subagentThinking(source: string, text: string): GatewayEvent {
  return ev('subagent.thinking', { source, text })
}

function subagentTool(source: string, toolId: string, name: string, result?: string, status?: string): GatewayEvent {
  return ev('subagent.tool', {
    source,
    tool_id: toolId,
    name,
    args: {},
    result,
    status,
  })
}

function subagentStart(source: string, goal: string): GatewayEvent {
  return ev('subagent.start', { source, goal })
}

function subagentComplete(source: string, text?: string): GatewayEvent {
  return ev('subagent.complete', { source, text })
}

// ── Create the event handler ──────────────────────────────────────────

const handler = createGatewayEventHandler(fakeGw, fakeController)

// Flush helper — the handler throttles with setTimeout(80ms), so we need
// to flush pending timers synchronously for tests.
function flushTimers(): void {
  // Force any pending setTimeout callbacks to run
  // Node.js doesn't have a synchronous flush, but we can advance time
  // by calling the timer manually. Since scheduleFlush uses setTimeout,
  // we need to trigger it.
  // We'll use a small trick: wait a tiny bit then check.
}

// Actually, for tests we can set DRSAI_TUI_FLUSH_MS=0 so timers fire immediately
// But the env is already set at module load time. Let's just manually flush
// by accessing the store directly.

// Since the handler buffers internally and flushes on a timer, we need to
// either (a) wait for the timer, or (b) trigger a flush ourselves.
// The simplest approach: send a message.complete which calls flushBuffers()
// internally. But that also finalizes the turn.
//
// Alternative: we can use a very short flush interval by setting the env
// var BEFORE importing. Let's restart with env override.

// Actually, the simplest way: we can directly check the store state after
// each event by waiting for the next tick. Let's make this async.

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ═══════════════════════════════════════════════════════════════════════
// TEST SCENARIOS
// ═══════════════════════════════════════════════════════════════════════

async function runTests(): Promise<void> {
  console.log('\n═══ TUI Streaming ContentParts Ordering Tests ═══\n')

  // ── Test 1: Standard text → tool → text → tool → text ─────────────
  console.log('─ Test 1: Text → Tool → Text → Tool → Text (standard interleaving)')

  reset()
  // Send message.delta events to build up text segment 1
  handler(msgDelta('Let me search for the file.'))
  await wait(120)  // wait for flush timer

  let cur = $current.get()
  assert(cur !== null, 'Turn is created after first delta')
  assertEqual(cur!.contentParts.length, 1, 'One content part (text) after first delta')
  assertEqual(cur!.contentParts[0].kind, 'text', 'First part is text')
  assertEqual(cur!.contentParts[0].kind === 'text' ? getPartText(cur!.contentParts[0] as TextContentPart) : '', 'Let me search for the file.', 'Text segment 1 content correct')

  // Send tool.start — should flush text first, then add tool part
  handler(toolStart('tool-1', 'grep', { pattern: 'import' }))
  await wait(10)  // tool.start calls flushBuffers() synchronously

  cur = $current.get()
  assertEqual(cur!.contentParts.length, 2, 'Two content parts (text + tool) after tool.start')
  assertEqual(cur!.contentParts[0].kind, 'text', 'First part is still text')
  assertEqual(cur!.contentParts[1].kind, 'tool', 'Second part is tool')

  // Send more text — should create a NEW text segment (not append to first)
  handler(msgDelta('Found it! Now let me read the file.'))
  await wait(120)

  cur = $current.get()
  assertEqual(cur!.contentParts.length, 3, 'Three content parts (text + tool + text) after second text')
  assertEqual(cur!.contentParts[1].kind, 'tool', 'Second part is still tool (text after tool is new segment)')
  assertEqual(cur!.contentParts[2].kind, 'text', 'Third part is new text segment')

  // Send second tool
  handler(toolStart('tool-2', 'read_file', { path: '/tmp/test.ts' }))
  await wait(10)

  cur = $current.get()
  assertEqual(cur!.contentParts.length, 4, 'Four content parts after second tool')

  // Send final text
  handler(msgDelta('Done! The file looks good.'))
  await wait(120)

  cur = $current.get()
  assertEqual(cur!.contentParts.length, 5, 'Five content parts after final text')

  // Verify full ordering
  const order1 = contentPartSummary(cur!.contentParts)
  console.log('  Content order:', order1)
  assertEqual(order1, ['text:"Let me search for the file."', 'tool:tool-1', 'text:"Found it! Now let me read the file."', 'tool:tool-2', 'text:"Done! The file looks good."'], 'Full interleaving order correct')

  // Verify text field has all text concatenated (only materialised at finalize;
  // during streaming we derive from contentParts)
  const fullText = cur!.contentParts
    .filter((p): p is ContentPart & { kind: 'text' } => p.kind === 'text')
    .map(p => getPartText(p))
    .join('')
  assertEqual(fullText, 'Let me search for the file.Found it! Now let me read the file.Done! The file looks good.', 'Legacy text field has all text concatenated')

  // Finalize
  handler(msgComplete())
  assertEqual(finalizeCount, 1, 'Turn finalized after message.complete')

  // ── Test 2: Subagent thinking output ──────────────────────────────
  console.log('\n─ Test 2: Subagent thinking output')

  reset()
  handler(msgDelta('I will delegate this to a subagent.'))
  await wait(120)

  // Subagent starts streaming
  handler(subagentStart('sub:researcher', 'Research the codebase'))
  handler(subagentThinking('sub:researcher', 'Analyzing files...'))
  await wait(120)

  cur = $current.get()
  console.log('  Content parts after subagent.thinking:', contentPartSummary(cur!.contentParts))

  // Subagent thinking should add text with visual markers
  assert(cur!.contentParts.length >= 1, 'Has content parts after subagent thinking')
  assert(getFullText(cur!).includes('Analyzing files...'), 'Text includes subagent output')
  assert(getFullText(cur!).includes('🤖'), 'Text includes subagent visual marker')

  // Main agent resumes
  handler(msgDelta('The subagent found useful results.'))
  await wait(120)

  cur = $current.get()
  console.log('  Content parts after main agent resumes:', contentPartSummary(cur!.contentParts))
  assert(getFullText(cur!).includes('The subagent found useful results.'), 'Text includes post-subagent text')
  assert(getFullText(cur!).includes('└'), 'Text includes subagent closing marker')

  // ── Test 3: Subagent tool calls ────────────────────────────────────
  console.log('\n─ Test 3: Subagent tool calls (subagent.tool)')

  reset()
  handler(msgDelta('Starting subagent task.'))
  await wait(120)

  // Subagent tool call (new tool)
  handler(subagentTool('sub:explorer', 'sub-tool-1', 'grep', undefined, undefined))
  await wait(10)

  cur = $current.get()
  assertEqual(cur!.contentParts.length, 2, 'Two content parts (text + sub-tool) after subagent.tool')
  assertEqual(cur!.contentParts[1].kind, 'tool', 'Second part is sub-tool')
  assertEqual(cur!.contentParts[1].kind === 'tool' ? cur!.contentParts[1].toolId : '', 'sub-tool-1', 'Sub-tool has correct toolId')

  // Subagent tool completes
  handler(subagentTool('sub:explorer', 'sub-tool-1', 'grep', 'Found 5 matches', 'complete'))
  await wait(10)

  cur = $current.get()
  const subTool = cur!.tools.find(t => t.id === 'sub-tool-1')
  assert(!!subTool, 'Sub-tool exists in tools array')
  assertEqual(subTool!.status, 'complete', 'Sub-tool is complete after subagent.tool update')
  assertEqual(subTool!.result, 'Found 5 matches', 'Sub-tool result is correct')

  // Verify tool is still referenced in contentParts
  assertEqual(cur!.contentParts.length, 2, 'Content parts unchanged after sub-tool completes (no new part)')

  // ── Test 4: Tool result updates (tool.complete) ────────────────────
  console.log('\n─ Test 4: Tool result updates (tool.complete)')

  reset()
  handler(msgDelta('Running a tool.'))
  await wait(120)
  handler(toolStart('tool-x', 'bash', { cmd: 'ls' }))
  await wait(10)

  cur = $current.get()
  const toolBefore = cur!.tools.find(t => t.id === 'tool-x')
  assertEqual(toolBefore!.status, 'running', 'Tool is running before complete')

  // The contentParts reference should still point to tool-x
  const toolPart = cur!.contentParts.find(p => p.kind === 'tool')
  assertEqual(toolPart!.kind === 'tool' ? toolPart!.toolId : '', 'tool-x', 'Content part references tool-x')

  handler(toolComplete('tool-x', 'bash', 'file1.txt\nfile2.txt', 50))
  await wait(10)

  cur = $current.get()
  const toolAfter = cur!.tools.find(t => t.id === 'tool-x')
  assertEqual(toolAfter!.status, 'complete', 'Tool is complete after tool.complete')
  assertEqual(toolAfter!.result, 'file1.txt\nfile2.txt', 'Tool result is correct')
  assertEqual(toolAfter!.durationMs, 50, 'Tool duration is correct')

  // Content parts should still have same structure
  assertEqual(cur!.contentParts.length, 2, 'Content parts count unchanged after tool.complete')

  // ── Test 5: Multiple subagent blocks in one turn ──────────────────
  console.log('\n─ Test 5: Multiple subagent blocks in one turn')

  reset()
  handler(msgDelta('First, I will use subagent A.'))
  await wait(120)
  handler(subagentThinking('sub:A', 'Subagent A working...'))
  await wait(120)
  // Subagent A completes
  handler(subagentComplete('sub:A', 'Subagent A done.'))
  await wait(120)
  // Main agent text
  handler(msgDelta('Now using subagent B.'))
  await wait(120)
  handler(subagentThinking('sub:B', 'Subagent B working...'))
  await wait(120)
  handler(subagentComplete('sub:B', 'Subagent B done.'))
  await wait(120)
  // Final main agent text
  handler(msgDelta('All done!'))
  await wait(120)

  cur = $current.get()
  console.log('  Full text:', getFullText(cur!).replace(/\n/g, '\\n').slice(0, 200))
  assert(getFullText(cur!).includes('Subagent A working...'), 'Text includes subagent A output')
  assert(getFullText(cur!).includes('Subagent B working...'), 'Text includes subagent B output')
  assert(getFullText(cur!).includes('All done!'), 'Text includes final text')

  // ── Test 6: Empty text between tools ──────────────────────────────
  console.log('\n─ Test 6: Consecutive tools (no text between)')

  reset()
  handler(toolStart('tool-a', 'read_file', { path: 'a.ts' }))
  await wait(10)
  handler(toolStart('tool-b', 'read_file', { path: 'b.ts' }))
  await wait(10)

  cur = $current.get()
  assertEqual(cur!.contentParts.length, 2, 'Two content parts (both tools) with no text')
  assertEqual(cur!.contentParts[0].kind, 'tool', 'First part is tool-a')
  assertEqual(cur!.contentParts[1].kind, 'tool', 'Second part is tool-b')
  assertEqual(cur!.contentParts[0].kind === 'tool' ? cur!.contentParts[0].toolId : '', 'tool-a', 'First tool is tool-a')
  assertEqual(cur!.contentParts[1].kind === 'tool' ? cur!.contentParts[1].toolId : '', 'tool-b', 'Second tool is tool-b')

  // ── Test 7: Text accumulation within a single segment ─────────────
  console.log('\n─ Test 7: Text accumulation within a single segment')

  reset()
  // Send multiple deltas rapidly — they should all accumulate in one text part
  handler(msgDelta('Hello'))
  handler(msgDelta(' '))
  handler(msgDelta('world'))
  handler(msgDelta('!'))
  await wait(120)  // Wait for flush timer

  cur = $current.get()
  assertEqual(cur!.contentParts.length, 1, 'One content part (single text segment)')
  assertEqual(cur!.contentParts[0].kind, 'text', 'Part is text')
  assertEqual(cur!.contentParts[0].kind === 'text' ? getPartText(cur!.contentParts[0] as TextContentPart) : '', 'Hello world!', 'Text accumulated correctly')

  // ── Test 8: Verify tools array is still maintained ────────────────
  console.log('\n─ Test 8: Legacy tools array maintained alongside contentParts')

  reset()
  handler(msgDelta('Using tools.'))
  await wait(120)
  handler(toolStart('t1', 'grep', { pattern: 'test' }))
  await wait(10)
  handler(toolStart('t2', 'bash', { cmd: 'echo hi' }))
  await wait(10)
  handler(toolComplete('t1', 'grep', 'match1', 30))
  await wait(10)

  cur = $current.get()
  assertEqual(cur!.tools.length, 2, 'Two tools in legacy tools array')
  assertEqual(cur!.contentParts.length, 3, 'Three content parts (text + tool + tool)')
  assert(!!cur!.tools.find(t => t.id === 't1' && t.status === 'complete'), 'Tool t1 is complete in tools array')
  assert(!!cur!.tools.find(t => t.id === 't2' && t.status === 'running'), 'Tool t2 is running in tools array')

  // ── Summary ────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════')
  console.log(`  Passed: ${passed}  Failed: ${failed}`)
  console.log('══════════════════════════════════════════════════\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Test runner error:', err)
  process.exit(1)
})
