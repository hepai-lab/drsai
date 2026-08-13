package ai.drsai.remote

import ai.drsai.remote.remote.data.reduceRemoteTimelineUpdate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteTimelineNavigationTest {
    @Test
    fun new_items_do_not_move_a_reader_who_is_away_from_latest() {
        val update = reduceRemoteTimelineUpdate(100_000, 110_000, false, null)
        assertEquals(100_000, update.unreadStart)
        assertFalse(update.scrollToLatest)
    }

    @Test
    fun following_reader_moves_to_latest_and_clears_unread_boundary() {
        val update = reduceRemoteTimelineUpdate(100, 101, true, 90)
        assertNull(update.unreadStart)
        assertTrue(update.scrollToLatest)
    }

    @Test
    fun search_and_history_restore_never_steal_scroll_position() {
        val search = reduceRemoteTimelineUpdate(100, 105, true, null, searchActive = true)
        assertEquals(100, search.unreadStart)
        assertFalse(search.scrollToLatest)
        val history = reduceRemoteTimelineUpdate(100, 150, true, 99, historyRestored = true)
        assertEquals(99, history.unreadStart)
        assertFalse(history.scrollToLatest)
    }
}
