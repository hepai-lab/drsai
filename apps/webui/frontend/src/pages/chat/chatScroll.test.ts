import assert from "node:assert/strict";
import {
  generatedMediaShouldKeepFollow,
  isNearBottom,
  isPassiveGrowthFromBottom,
  isUserScrollUp,
  shouldLockAutoScrollOnScroll,
  type ScrollMetrics,
} from "./chatScroll";

function metrics(
  partial: Partial<ScrollMetrics> & Pick<ScrollMetrics, "scrollHeight" | "scrollTop">
): ScrollMetrics {
  return { clientHeight: 500, ...partial };
}

const pinned = metrics({ scrollHeight: 1000, scrollTop: 500 });

assert.equal(isNearBottom(pinned), true);
assert.equal(
  isNearBottom(metrics({ scrollHeight: 1600, scrollTop: 500 })),
  false
);

assert.equal(
  isUserScrollUp(metrics({ scrollHeight: 1000, scrollTop: 200 }), pinned),
  true
);
assert.equal(
  isUserScrollUp(metrics({ scrollHeight: 1600, scrollTop: 500 }), pinned),
  false,
  "image decode grows height; not a user scroll-up"
);
assert.equal(
  isUserScrollUp(metrics({ scrollHeight: 700, scrollTop: 200 }), pinned),
  false,
  "content shrink clamps scrollTop; not a user scroll-up"
);

assert.equal(
  isPassiveGrowthFromBottom(
    metrics({ scrollHeight: 1600, scrollTop: 500 }),
    pinned
  ),
  true
);

assert.equal(
  shouldLockAutoScrollOnScroll(
    metrics({ scrollHeight: 1600, scrollTop: 500 }),
    pinned
  ),
  false,
  "generated image must not lock auto-follow"
);
assert.equal(
  shouldLockAutoScrollOnScroll(
    metrics({ scrollHeight: 700, scrollTop: 200 }),
    pinned
  ),
  false,
  "image remount shrink must not lock auto-follow"
);
assert.equal(
  shouldLockAutoScrollOnScroll(
    metrics({ scrollHeight: 1000, scrollTop: 120 }),
    pinned
  ),
  true,
  "real user scroll-up still locks"
);
assert.equal(
  shouldLockAutoScrollOnScroll(pinned, pinned),
  false,
  "still at bottom stays unlocked"
);

assert.equal(
  generatedMediaShouldKeepFollow(
    false,
    { top: 800, bottom: 1400 },
    { top: 0, bottom: 500 }
  ),
  true
);
assert.equal(
  generatedMediaShouldKeepFollow(
    true,
    { top: 120, bottom: 900 },
    { top: 0, bottom: 500 }
  ),
  true,
  "image in view after decode should keep follow"
);
assert.equal(
  generatedMediaShouldKeepFollow(
    true,
    { top: 1800, bottom: 2400 },
    { top: 0, bottom: 500 }
  ),
  false,
  "user scrolled away; do not yank back"
);

console.log("chatScroll tests passed");
