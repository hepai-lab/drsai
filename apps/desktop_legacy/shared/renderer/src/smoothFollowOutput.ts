export type FollowOutputScrollBehavior = "auto" | "smooth";

interface SmoothFollowOutputOptions {
  scrollToBottom: (behavior: FollowOutputScrollBehavior) => void;
  stopScrolling?: (scrollTop: number) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  getScrollBehavior?: () => FollowOutputScrollBehavior;
}

const SCROLL_DIRECTION_TOLERANCE = 0.5;
const HEIGHT_CHANGE_TOLERANCE = 0.5;
const AT_BOTTOM_TOLERANCE = 4;

export function createSmoothFollowOutputController({
  scrollToBottom,
  stopScrolling,
  requestFrame = window.requestAnimationFrame.bind(window),
  cancelFrame = window.cancelAnimationFrame.bind(window),
  getScrollBehavior = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
}: SmoothFollowOutputOptions) {
  let following = true;
  let pausedByUser = false;
  let lastScrollTop: number | undefined;
  let lastMaxScrollTop: number | undefined;
  let lastHeight: number | undefined;
  let pendingFrame: number | undefined;
  let programmaticScrollActive = false;

  const pause = (): void => {
    following = false;
    if (pendingFrame !== undefined) {
      cancelFrame(pendingFrame);
      pendingFrame = undefined;
    }
  };

  const resume = (): void => {
    following = true;
    pausedByUser = false;
  };

  const handleUserScrollIntent = (scrollTop: number): void => {
    const shouldStopScrolling = following || programmaticScrollActive;
    pause();
    pausedByUser = true;
    programmaticScrollActive = false;
    if (shouldStopScrolling) stopScrolling?.(scrollTop);
  };

  const handleScroll = (scrollTop: number, maxScrollTop: number): boolean => {
    const movedUp = lastScrollTop !== undefined && scrollTop < lastScrollTop - SCROLL_DIRECTION_TOLERANCE;
    const movedDown = lastScrollTop !== undefined && scrollTop > lastScrollTop + SCROLL_DIRECTION_TOLERANCE;
    const layoutShrank = lastMaxScrollTop !== undefined && maxScrollTop < lastMaxScrollTop - HEIGHT_CHANGE_TOLERANCE;
    lastScrollTop = scrollTop;
    lastMaxScrollTop = maxScrollTop;
    if (movedUp && !layoutShrank && !programmaticScrollActive) {
      const stopActiveScroll = following;
      pause();
      pausedByUser = true;
      if (stopActiveScroll) stopScrolling?.(scrollTop);
      return true;
    }
    if (maxScrollTop - scrollTop <= AT_BOTTOM_TOLERANCE) {
      programmaticScrollActive = false;
      if (movedDown && pausedByUser) resume();
    }
    return false;
  };

  const handleHeightChange = (height: number): void => {
    const grew = lastHeight !== undefined && height > lastHeight + HEIGHT_CHANGE_TOLERANCE;
    lastHeight = height;
    if (!grew || !following || pendingFrame !== undefined) return;
    pendingFrame = requestFrame(() => {
      pendingFrame = undefined;
      if (following) {
        programmaticScrollActive = true;
        scrollToBottom(getScrollBehavior());
      }
    });
  };

  const dispose = (): void => {
    if (pendingFrame !== undefined) cancelFrame(pendingFrame);
    pendingFrame = undefined;
  };

  return { dispose, handleHeightChange, handleScroll, handleUserScrollIntent, isFollowing: () => following, pause, resume };
}
