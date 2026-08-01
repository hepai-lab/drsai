/**
 * heightCache — module-level cache for streaming text part height estimates.
 *
 * During streaming, each 80ms flush grows the last text part's chunks.
 * clipContentParts() calls estimatePartHeight() for every part — but
 * only the LAST part changed between flushes. Without caching, this is
 * O(total_text) per flush → O(n²) over a long answer.
 *
 * The cache is keyed by (partId, chunkCount, cols). When a part's
 * chunk count hasn't changed and the terminal width is the same, the
 * cached row count is returned instantly. Only the growing last part
 * misses the cache on each flush.
 *
 * The Map is cleared when a new turn starts (via clearHeightCache()).
 */

interface HeightCacheEntry {
  chunkCount: number
  cols: number
  rows: number
}

const _heightCache = new Map<string, HeightCacheEntry>()

/** Clear the height cache — called when a new streaming turn begins. */
export function clearHeightCache(): void {
  _heightCache.clear()
}

/** Get a cached height entry, or undefined if not cached / stale. */
export function getCachedHeight(
  partId: string,
  chunkCount: number,
  cols: number,
): number | undefined {
  const cached = _heightCache.get(partId)
  if (cached && cached.chunkCount === chunkCount && cached.cols === cols) {
    return cached.rows
  }
  return undefined
}

/** Store a computed height in the cache. */
export function setCachedHeight(
  partId: string,
  chunkCount: number,
  cols: number,
  rows: number,
): void {
  _heightCache.set(partId, { chunkCount, cols, rows })
}
