package ai.drsai.remote

import ai.drsai.remote.remote.model.TimelineScrollPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TimelineScrollPolicyTest {
    @Test fun `long timeline only follows when viewport remains near bottom`() {
        assertTrue(TimelineScrollPolicy.isAtBottom(lastVisibleIndex = 99, totalItems = 100))
        assertTrue(TimelineScrollPolicy.isAtBottom(lastVisibleIndex = 98, totalItems = 100))
        assertFalse(TimelineScrollPolicy.isAtBottom(lastVisibleIndex = 40, totalItems = 100))
        assertFalse(TimelineScrollPolicy.shouldFollowLatest(userFollowing = false, imeVisible = false))
    }

    @Test fun `keyboard visibility explicitly brings composer and latest content into view`() {
        assertTrue(TimelineScrollPolicy.shouldFollowLatest(userFollowing = false, imeVisible = true))
        assertTrue(TimelineScrollPolicy.shouldFollowLatest(userFollowing = true, imeVisible = false))
    }
}
