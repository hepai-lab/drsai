package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RemoteConnectionState
import ai.drsai.remote.remote.model.RemoteRunStatus
import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteSessionUiAuthorityTest {
    @Test fun ten_thousand_random_transitions_have_no_conflicting_flags() {
        val reducer = RemoteSessionUiAuthorityReducer()
        val random = Random(260813)
        val connections = RemoteConnectionState.entries
        val runs = listOf<RemoteRunStatus?>(null) + RemoteRunStatus.entries
        repeat(10_000) { generation ->
            val state = reducer.accept(RemoteSessionUiAuthorityEvent.Snapshot(
                generation.toLong(), connections.random(random), random.nextBoolean(), runs.random(random),
            ))
            assertFalse(state.running && state.canRetry)
            assertEquals(state.connectionState == RemoteConnectionState.ONLINE, state.online)
            assertEquals(remoteLifecycleState(
                state.connectionState, state.lifecycleState == RemoteLifecycleState.STALE,
            ), state.lifecycleState)
        }
    }

    @Test fun stale_generation_cannot_overwrite_new_state() {
        val reducer = RemoteSessionUiAuthorityReducer()
        val latest = reducer.accept(RemoteSessionUiAuthorityEvent.Snapshot(
            20, RemoteConnectionState.ONLINE, true, RemoteRunStatus.RUNNING,
        ))
        val stale = reducer.accept(RemoteSessionUiAuthorityEvent.Snapshot(
            19, RemoteConnectionState.OFFLINE, false, RemoteRunStatus.FAILED,
        ))
        assertEquals(latest, stale)
        assertTrue(stale.online)
        assertTrue(stale.running)
        assertFalse(stale.canRetry)
    }
}
