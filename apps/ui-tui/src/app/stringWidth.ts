/**
 * stringWidth — display-width-aware text measurement for terminal rendering.
 *
 * In a terminal, not all characters occupy the same number of columns:
 *   - ASCII / Latin letters / digits  → 1 cell
 *   - CJK (Chinese, Japanese, Korean) → 2 cells (East Asian Wide)
 *   - Full-width variants / emoji      → 2 cells
 *   - Combining marks / control chars  → 0 cells
 *
 * JavaScript's ``String.length`` counts UTF-16 code units, which is
 * wrong for both display width AND Unicode code point counting.
 * This module provides:
 *   - ``charWidth(code)``   — width of a single Unicode code point
 *   - ``stringWidth(s)``    — total display width of a string
 *   - ``takeByWidth(s, n)`` — take characters that fit in ``n`` cells
 *
 * The ranges cover East Asian Wide (W) and Fullwidth (F) categories
 * from the Unicode standard, plus common emoji ranges.  This is NOT
 * a complete implementation of UAX #11 — it covers the ranges that
 * matter in practice for CJK users.
 */

// ── East Asian Wide / Fullwidth ranges (Unicode blocks) ──────────────
// Each entry: [start, end, width]
// Width 2 = wide/fullwidth, Width 1 = narrow/halfwidth.
const WIDE_RANGES: Array<[number, number]> = [
  // CJK Radicals Supplement
  [0x2E80, 0x2EFF],
  // Kangxi Radicals
  [0x2F00, 0x2FDF],
  // CJK Symbols and Punctuation
  [0x3000, 0x303F],
  // Hiragana
  [0x3040, 0x309F],
  // Katakana
  [0x30A0, 0x30FF],
  // Bopomofo
  [0x3100, 0x312F],
  // Hangul Compatibility Jamo
  [0x3130, 0x318F],
  // Bopomofo Extended
  [0x31A0, 0x31BF],
  // CJK Strokes
  [0x31C0, 0x31EF],
  // Katakana Phonetic Extensions
  [0x31F0, 0x31FF],
  // Enclosed CJK Letters and Months
  [0x3200, 0x32FF],
  // CJK Compatibility
  [0x3300, 0x33FF],
  // CJK Unified Ideographs Extension A
  [0x3400, 0x4DBF],
  // Yijing Hexagram Symbols
  [0x4DC0, 0x4DFF],
  // CJK Unified Ideographs (common Chinese/Japanese/Korean characters)
  [0x4E00, 0x9FFF],
  // Yi Syllables
  [0xA000, 0xA48F],
  // Yi Radicals
  [0xA490, 0xA4CF],
  // CJK Unified Ideographs Extension B-F (rare characters)
  [0x20000, 0x3FFFD],
  // Halfwidth and Fullwidth Forms (fullwidth variants)
  [0xFF00, 0xFF60],
  [0xFFE0, 0xFFE6],
  // Emoji and Symbol ranges (common ones, 2-cell wide)
  [0x1F300, 0x1F5FF],  // Miscellaneous Symbols and Pictographs
  [0x1F600, 0x1F64F],  // Emoticons
  [0x1F680, 0x1F6FF],  // Transport and Map Symbols
  [0x1F700, 0x1F77F],  // Alchemical Symbols
  [0x1F780, 0x1F7FF],  // Geometric Shapes Extended
  [0x1F800, 0x1F8FF],  // Supplemental Arrows-C
  [0x1F900, 0x1F9FF],  // Supplemental Symbols and Pictographs
  [0x1FA00, 0x1FA6F],  // Chess Symbols
  [0x1FA70, 0x1FAFF],  // Symbols and Pictographs Extended-A
  [0x2600, 0x26FF],    // Miscellaneous Symbols (many are wide)
  [0x2700, 0x27BF],    // Dingbats (many are wide)
]

// Zero-width ranges (combining marks, control chars, etc.)
const ZERO_WIDTH_RANGES: Array<[number, number]> = [
  [0x0300, 0x036F],   // Combining Diacritical Marks
  [0x0483, 0x0489],   // Cyrillic combining
  [0x0591, 0x05BD],   // Hebrew combining
  [0x05BF, 0x05BF],
  [0x05C1, 0x05C2],
  [0x05C4, 0x05C5],
  [0x05C7, 0x05C7],
  [0x0610, 0x061A],   // Arabic combining
  [0x064B, 0x065F],
  [0x0670, 0x0670],
  [0x06D6, 0x06DC],
  [0x06DF, 0x06E4],
  [0x06E7, 0x06E8],
  [0x06EA, 0x06ED],
  [0x0711, 0x0711],
  [0x0730, 0x074A],
  [0x200B, 0x200F],   // Zero-width space, joiner, non-joiner
  [0xFE00, 0xFE0F],   // Variation Selectors
  [0xFE20, 0xFE2F],   // Combining Half Marks
  [0xE0100, 0xE01EF], // Variation Selectors Supplement
]

// Control characters (0x00-0x1F, 0x7F-0x9F) are zero-width
// in terminal rendering context.

/**
 * Determine the display width (in terminal cells) of a single Unicode
 * code point.
 *
 * Returns:
 *   0 — zero-width (combining marks, control chars, zero-width spaces)
 *   1 — narrow (ASCII, Latin, most symbols)
 *   2 — wide (CJK ideographs, fullwidth, emoji)
 */
export function charWidth(code: number): number {
  // Control characters
  if (code < 0x20 || (code >= 0x7F && code < 0xA0)) return 0

  // Check zero-width ranges
  for (const [start, end] of ZERO_WIDTH_RANGES) {
    if (code >= start && code <= end) return 0
  }

  // Check wide ranges
  for (const [start, end] of WIDE_RANGES) {
    if (code >= start && code <= end) return 2
  }

  // Default: narrow (1 cell)
  return 1
}

/**
 * Iterate over a string yielding [codePoint, charStr, width] tuples.
 * Properly handles surrogate pairs (emoji, astral plane characters).
 *
 * This is the foundation for all width-aware operations: instead of
 * ``str[i]`` (which accesses UTF-16 code units and can split surrogate
 * pairs), use this iterator to get complete Unicode code points.
 */
export function* iterateChars(s: string): Generator<[number, string, number]> {
  for (const charStr of s) {
    const code = charStr.codePointAt(0) ?? 0
    const w = charWidth(code)
    yield [code, charStr, w]
  }
}

/**
 * Calculate the total display width of a string in terminal cells.
 * Handles CJK double-width, emoji, combining marks, and surrogate pairs.
 */
export function stringWidth(s: string): number {
  let width = 0
  for (const [, , w] of iterateChars(s)) {
    width += w
  }
  return width
}

/**
 * Take characters from the start of a string that fit within ``maxWidth``
 * terminal cells. Returns the substring and the actual width consumed.
 *
 * If a wide character would overflow, it is NOT included (we don't split
 * CJK characters across lines in terminals — they can't be half-rendered).
 *
 * Example: takeByWidth("你好world", 7) → ["你好wor", 7]
 *          (你好=4 cells, wor=3 cells, total 7, 'l' would overflow)
 */
export function takeByWidth(
  s: string,
  maxWidth: number,
): { text: string; width: number } {
  let result = ''
  let width = 0
  for (const [, charStr, w] of iterateChars(s)) {
    if (width + w > maxWidth) break
    result += charStr
    width += w
  }
  return { text: result, width }
}

/**
 * Wrap a string into visual lines, each at most ``maxCols`` cells wide.
 *
 * Wrapping strategy:
 *   1. Break at the last whitespace before exceeding ``maxCols`` (word
 *      boundary) if possible — prevents splitting English words.
 *   2. If a single word (or CJK text with no spaces) exceeds ``maxCols``,
 *      break at the ``maxCols`` boundary. For CJK text this is fine
 *      because each character is a self-contained unit.
 *   3. Wide characters are never split — if a 2-cell character would
 *      overflow, it moves to the next line.
 *
 * Returns an array of visual line strings. Each line's stringWidth is
 * <= maxCols.
 *
 * @param line     The logical line to wrap (no ``\n``).
 * @param maxCols  Maximum display width per visual line (in cells).
 */
export function softWrapWide(line: string, maxCols: number): string[] {
  if (maxCols <= 0) return [line]
  if (stringWidth(line) <= maxCols) return [line]

  const result: string[] = []
  let remaining = line

  while (remaining.length > 0) {
    const w = stringWidth(remaining)
    if (w <= maxCols) {
      result.push(remaining)
      break
    }

    // Take as many chars as fit within maxCols
    const { text: taken, width: takenWidth } = takeByWidth(remaining, maxCols)

    // Try to break at the last whitespace within the taken text
    // (word-boundary wrapping for English/Latin text).
    let breakAt = taken.length
    if (taken.length < remaining.length) {
      // Only look for word breaks if there IS more text to come
      const lastSpace = taken.lastIndexOf(' ')
      // Only break at space if it's not at position 0 (which would
      // create an empty line) and the space is reasonably positioned
      // (at least 25% of the way through, to avoid very short lines).
      if (lastSpace > 0 && lastSpace >= Math.floor(maxCols * 0.25)) {
        breakAt = lastSpace + 1  // Include the space in the current line
      }
    }

    const chunk = remaining.slice(0, breakAt)
    result.push(chunk)
    remaining = remaining.slice(breakAt)

    // Handle consecutive spaces — skip leading spaces on continuation
    // lines (common in indented text or code).
    if (remaining.length > 0 && remaining[0] === ' ' && result.length > 0) {
      // Don't skip ALL leading spaces — keep at least the indent.
      // But skip ONE space (the one we broke at, if it was included).
    }

    // Safety: prevent infinite loop if something goes wrong
    if (chunk.length === 0) {
      // Fallback: take at least 1 character
      const fallback = remaining.slice(0, 1)
      result.push(fallback)
      remaining = remaining.slice(1)
    }
  }

  return result.length > 0 ? result : ['']
}

/**
 * Map a character offset (position in the string) to a
 * [visualLineIdx, visualCol] pair, given a set of soft-wrapped lines.
 *
 * @param wrappedLines  The result of ``softWrapWide(line, maxCols)``.
 * @param charOffset    The character offset within the original line.
 * @returns             [visualLineIndex, displayColumnInCells]
 */
export function charOffsetToVisualPos(
  wrappedLines: string[],
  charOffset: number,
): { lineIdx: number; col: number } {
  let remaining = charOffset
  for (let i = 0; i < wrappedLines.length; i++) {
    const lineLen = wrappedLines[i].length
    if (remaining <= lineLen) {
      // Cursor is on this visual line.
      // The display column is the stringWidth of the text before cursor.
      return {
        lineIdx: i,
        col: stringWidth(wrappedLines[i].slice(0, remaining)),
      }
    }
    remaining -= lineLen
  }
  // Cursor is past the end — return last line, end position
  const lastIdx = wrappedLines.length - 1
  return {
    lineIdx: Math.max(0, lastIdx),
    col: stringWidth(wrappedLines[lastIdx] ?? ''),
  }
}
