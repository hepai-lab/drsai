export type ScrollMetrics = {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
};

export function isNearBottom(
  metrics: ScrollMetrics,
  threshold = 32
): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <=
    threshold
  );
}

/** True when the user actively scrolled up (not layout clamp from images). */
export function isUserScrollUp(
  container: ScrollMetrics,
  prev: ScrollMetrics
): boolean {
  if (prev.scrollHeight <= 0) return false;
  // Image remount/reload shrinks content; the browser clamps scrollTop down.
  if (Math.abs(container.scrollHeight - prev.scrollHeight) > 2) return false;
  return container.scrollTop < prev.scrollTop - 2;
}

/** True when content grew while the view was pinned to the bottom (streaming/images). */
export function isPassiveGrowthFromBottom(
  container: ScrollMetrics,
  prev: ScrollMetrics
): boolean {
  if (prev.scrollHeight <= 0) return false;
  const wasPinned =
    prev.scrollTop >= prev.scrollHeight - prev.clientHeight - 48;
  return wasPinned && container.scrollHeight > prev.scrollHeight;
}

/**
 * Layout changes (markdown images decoding, streaming text) move scrollHeight
 * and sometimes scrollTop. That is not a user gesture and must not lock follow.
 */
export function shouldLockAutoScrollOnScroll(
  container: ScrollMetrics,
  prev: ScrollMetrics
): boolean {
  if (isNearBottom(container)) return false;
  if (prev.scrollHeight > 0 && Math.abs(container.scrollHeight - prev.scrollHeight) > 2) {
    return false;
  }
  if (isPassiveGrowthFromBottom(container, prev)) return false;
  return true;
}

/** Image is still on screen (or just below). Keep following after decode. */
export function generatedMediaShouldKeepFollow(
  locked: boolean,
  image: { top: number; bottom: number },
  viewport: { top: number; bottom: number }
): boolean {
  if (!locked) return true;
  return image.top < viewport.bottom + 64 && image.bottom > viewport.top;
}
