package ai.drsai.remote

import ai.drsai.remote.remote.data.EventDecision
import ai.drsai.remote.remote.data.RelayRemoteRepository
import ai.drsai.remote.remote.data.RelayStreamEvent
import ai.drsai.remote.remote.data.RemoteSequenceSynchronizer
import ai.drsai.remote.remote.data.SequenceSyncResult
import ai.drsai.remote.remote.model.*
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class RemoteSequenceSynchronizerTest {
    private lateinit var server: MockWebServer
    private lateinit var repository: RelayRemoteRepository
    private val identity = RemoteRunIdentity(
        RuntimeId("rt"), WorkspaceId("ws"), SessionId("session"), RunId("run"), "opendrsai",
    )

    @Before fun start() {
        server = MockWebServer().also { it.start() }
        repository = RelayRemoteRepository(server.url("/").toString(), { "token" })
    }

    @After fun stop() = server.shutdown()

    @Test fun `duplicate sequence and event id are never projected twice`() = runTest {
        val committed = mutableListOf<Long>()
        val seen = mutableSetOf<String>()
        val sync = RemoteSequenceSynchronizer(
            0,
            fetchPage = { ai.drsai.remote.remote.data.Page(emptyList(), null) },
            commit = {
                if (!seen.add(it.event.eventId.value)) EventDecision.DUPLICATE
                else if (it.event.sequence <= committed.lastOrNull().orZero()) EventDecision.OUT_OF_ORDER
                else EventDecision.APPLY.also { _ -> committed += it.event.sequence }
            },
            replaceFromSnapshot = { error("unexpected snapshot") },
        )

        assertEquals(SequenceSyncResult.APPLIED, sync.accept(event(1, "e1")))
        assertEquals(SequenceSyncResult.DUPLICATE, sync.accept(event(1, "e1")))
        assertEquals(listOf(1L), committed)
        assertEquals(1L, sync.lastSequence)
    }

    @Test fun `SSE gap pauses projection and fills REST pages before incoming event`() = runTest {
        server.enqueue(MockResponse().setBody(page(eventJson(2, "e2"), next = "2")))
        server.enqueue(MockResponse().setBody(page(eventJson(3, "e3"), next = null)))
        val committed = mutableListOf<Long>()
        val sync = synchronizer(initial = 1, committed = committed)

        assertEquals(SequenceSyncResult.APPLIED, sync.accept(event(4, "e4")))
        assertEquals(listOf(2L, 3L, 4L), committed)
        assertEquals(4L, sync.lastSequence)
        assertEquals("1", server.takeRequest().requestUrl?.queryParameter("after_sequence"))
        assertEquals("2", server.takeRequest().requestUrl?.queryParameter("after_sequence"))
    }

    @Test fun `expired cursor atomically replaces projection`() = runTest {
        server.enqueue(MockResponse().setResponseCode(410)
            .setBody("""{"detail":{"code":"cursor_expired","correlation_id":"redacted"}}"""))
        var rebuilt = 0
        val sync = RemoteSequenceSynchronizer(
            5,
            fetchPage = { repository.events(identity, it) },
            commit = { EventDecision.APPLY },
            replaceFromSnapshot = { rebuilt += 1; 12 },
        )

        assertEquals(SequenceSyncResult.REBUILT, sync.reconcile())
        assertEquals(1, rebuilt)
        assertEquals(12L, sync.lastSequence)
    }

    @Test fun `persisted sequence resumes process without replaying prior projection`() = runTest {
        val committed = mutableListOf<Long>()
        val sync = RemoteSequenceSynchronizer(
            7,
            fetchPage = { ai.drsai.remote.remote.data.Page(emptyList(), null) },
            commit = {
                if (it.event.sequence <= 7) EventDecision.OUT_OF_ORDER
                else EventDecision.APPLY.also { _ -> committed += it.event.sequence }
            },
            replaceFromSnapshot = { error("unexpected snapshot") },
        )

        assertEquals(SequenceSyncResult.DUPLICATE, sync.accept(event(7, "old")))
        assertEquals(SequenceSyncResult.APPLIED, sync.accept(event(8, "new")))
        assertEquals(listOf(8L), committed)
        assertEquals(8L, sync.lastSequence)
    }

    @Test fun `event id collision at next sequence rebuilds without advancing cursor`() = runTest {
        var rebuilt = 0
        val sync = RemoteSequenceSynchronizer(
            1,
            fetchPage = { ai.drsai.remote.remote.data.Page(emptyList(), null) },
            commit = { EventDecision.DUPLICATE },
            replaceFromSnapshot = { rebuilt += 1; 1 },
        )

        assertEquals(SequenceSyncResult.REBUILT, sync.accept(event(2, "existing-id")))
        assertEquals(1, rebuilt)
        assertEquals(1L, sync.lastSequence)
    }

    @Test fun `cross scope event fails closed without advancing cursor`() = runTest {
        val sync = RemoteSequenceSynchronizer(
            0,
            fetchPage = { ai.drsai.remote.remote.data.Page(emptyList(), null) },
            commit = { EventDecision.CROSS_SCOPE },
            replaceFromSnapshot = { error("unexpected snapshot") },
        )

        val failure = runCatching { sync.accept(event(1, "foreign")) }.exceptionOrNull()
        assertEquals("remote_event_scope_mismatch", failure?.message)
        assertEquals(0L, sync.lastSequence)
    }

    private fun synchronizer(initial: Long, committed: MutableList<Long>) =
        RemoteSequenceSynchronizer(
            initial,
            fetchPage = { repository.events(identity, it) },
            commit = { committed += it.event.sequence; EventDecision.APPLY },
            replaceFromSnapshot = { error("unexpected snapshot") },
        )

    private fun event(sequence: Long, id: String) = RelayStreamEvent(
        RemoteRuntimeEvent(
            EventId(id), identity, sequence, "message.delta", "now", RemoteRunStatus.RUNNING,
        ),
        JSONObject().put("delta", sequence.toString()),
    )

    private fun eventJson(sequence: Long, id: String) =
        """{"event_id":"$id","sequence":$sequence,"runtime_id":"rt","workspace_id":"ws","session_id":"session","run_id":"run","kind":"message.delta","timestamp":"now","payload":{"delta":"$sequence"}}"""

    private fun page(vararg events: String, next: String?) =
        """{"items":[${events.joinToString(",")}],"next_cursor":${next?.let { "\"$it\"" } ?: "null"}}"""

    private fun Long?.orZero() = this ?: 0L
}
