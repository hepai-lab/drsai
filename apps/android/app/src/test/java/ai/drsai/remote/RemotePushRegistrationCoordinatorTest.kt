package ai.drsai.remote

import ai.drsai.remote.remote.data.ProviderPushToken
import ai.drsai.remote.remote.data.PushRegistrationCheckpoint
import ai.drsai.remote.remote.data.PushRegistrationClient
import ai.drsai.remote.remote.data.PushRegistrationStateStore
import ai.drsai.remote.remote.data.RemotePushRegistration
import ai.drsai.remote.remote.data.RemotePushRegistrationCoordinator
import ai.drsai.remote.remote.model.RuntimeId
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RemotePushRegistrationCoordinatorTest {
    @Test fun `same provider token is replayed idempotently without advancing generation`() = runTest {
        val client = FakeClient()
        val store = MemoryStore()
        val coordinator = RemotePushRegistrationCoordinator(client, store)
        val runtime = RuntimeId("runtime-one")
        val raw = "provider-token-" + "a".repeat(64)

        coordinator.synchronize(listOf(runtime), ProviderPushToken("fcm", raw))
        coordinator.synchronize(listOf(runtime), ProviderPushToken("fcm", raw))

        assertEquals(2, client.upserts.size)
        assertEquals(listOf(1L, 1L), client.upserts.map { it.generation })
        assertEquals(1L, store.read(runtime)?.generation)
        assertFalse(store.toString().contains(raw))
    }

    @Test fun `provider rotation increments generation and commits only after success`() = runTest {
        val client = FakeClient()
        val store = MemoryStore()
        val coordinator = RemotePushRegistrationCoordinator(client, store)
        val runtime = RuntimeId("runtime-one")
        coordinator.synchronize(
            listOf(runtime), ProviderPushToken("fcm", "first-" + "a".repeat(64)),
        )

        client.failNext = true
        var failure: Throwable? = null
        try {
            coordinator.synchronize(
                listOf(runtime), ProviderPushToken("fcm", "second-" + "b".repeat(64)),
            )
        } catch (caught: Throwable) {
            failure = caught
        }
        assertTrue(failure is IllegalStateException)
        assertEquals(1L, store.read(runtime)?.generation)

        coordinator.synchronize(
            listOf(runtime), ProviderPushToken("fcm", "second-" + "b".repeat(64)),
        )
        assertEquals(2L, store.read(runtime)?.generation)
        assertEquals(listOf(1L, 2L, 2L), client.upserts.map { it.generation })
    }

    @Test fun `revoke clears checkpoint only after authoritative confirmation`() = runTest {
        val client = FakeClient()
        val store = MemoryStore()
        val coordinator = RemotePushRegistrationCoordinator(client, store)
        val runtime = RuntimeId("runtime-one")
        coordinator.synchronize(
            listOf(runtime), ProviderPushToken("fcm", "token-" + "c".repeat(64)),
        )

        val revoked = coordinator.revoke(runtime)

        assertEquals("revoked", revoked.status)
        assertNull(store.read(runtime))
    }

    private data class Upload(
        val runtimeId: RuntimeId,
        val provider: String,
        val generation: Long,
    )

    private class FakeClient : PushRegistrationClient {
        val upserts = mutableListOf<Upload>()
        var failNext = false

        override suspend fun upsertPushRegistration(
            runtimeId: RuntimeId,
            provider: String,
            token: String,
            generation: Long,
        ): RemotePushRegistration {
            upserts += Upload(runtimeId, provider, generation)
            if (failNext) {
                failNext = false
                error("provider unavailable")
            }
            return result(runtimeId, provider, generation, "active")
        }

        override suspend fun revokePushRegistration(runtimeId: RuntimeId): RemotePushRegistration =
            result(runtimeId, "fcm", 1, "revoked")

        private fun result(
            runtimeId: RuntimeId,
            provider: String,
            generation: Long,
            status: String,
        ) = RemotePushRegistration(
            runtimeId, "dev_0123456789ab", provider, generation, status, "2026-08-05T00:00:00Z",
        )
    }

    private class MemoryStore : PushRegistrationStateStore {
        private val values = mutableMapOf<RuntimeId, PushRegistrationCheckpoint>()
        override fun read(runtimeId: RuntimeId): PushRegistrationCheckpoint? = values[runtimeId]
        override fun write(runtimeId: RuntimeId, checkpoint: PushRegistrationCheckpoint) {
            values[runtimeId] = checkpoint
        }
        override fun clear(runtimeId: RuntimeId) {
            values.remove(runtimeId)
        }
        override fun toString(): String = values.toString()
    }
}
