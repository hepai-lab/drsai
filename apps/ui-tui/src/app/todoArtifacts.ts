/**
 * Filters for TodoWrite tool-result artifacts.
 *
 * TodoWrite is rendered as a dedicated structured tool block. Some agent/model
 * paths may also echo the raw tool result into the assistant text stream, e.g.
 *
 *   Below is the current task list and status...
 *   [x] ...
 *   [>] ...
 *   [ ] ...
 *   (1/3 done)
 *
 * If left in the assistant body this duplicates the structured Todo panel and
 * can be stale while the tool panel shows the latest state. Strip only this
 * recognizable tool-result envelope from assistant text.
 */

const TODO_WRITE_HEADER_RE = /(?:^|\n)Below is the current task list and status[\s\S]*?\n\(\d+\/\d+ done\)\s*/g
const TODO_WRITE_BARE_BLOCK_RE = /(?:^|\n)\s*(?:\[[x> ]\]\s+[^\n]*\n){1,20}\(\d+\/\d+ done\)\s*/gi

export function stripTodoWriteArtifacts(text: string): string {
  if (!text) return text
  return text
    .replace(TODO_WRITE_HEADER_RE, match => (match.startsWith('\n') ? '\n' : ''))
    .replace(TODO_WRITE_BARE_BLOCK_RE, match => (match.startsWith('\n') ? '\n' : ''))
    .replace(/^\s+/, '')
}
