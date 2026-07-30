package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.model.RuntimeId
import java.io.IOException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DevicePresenceControllerTest {
    @Test
    fun `foreground sends immediately then every product interval and background stops`() = runTest {
        val source = FakeHostSource(mutableListOf(RuntimeId("a")))
        val sent = mutableListOf<Pair<String, Boolean>>()
        val controller = controller(source) { runtime, accessing ->
            sent += runtime.value to accessing
        }

        controller.onForeground()
        runCurrent()
        assertEquals(listOf("a" to false), sent)

        advanceTimeBy(DEVICE_PRESENCE_INTERVAL_MILLIS)
        runCurrent()
        assertEquals(2, sent.size)

        controller.onBackground()
        advanceTimeBy(DEVICE_PRESENCE_INTERVAL_MILLIS * 2)
        runCurrent()
        assertEquals(2, sent.size)
        assertFalse(controller.hasActiveLoop())
    }

    @Test
    fun `resume is immediate and duplicate foreground starts only one loop`() = runTest {
        val source = FakeHostSource(mutableListOf(RuntimeId("a")))
        var count = 0
        val controller = controller(source) { _, _ -> count++ }
        controller.onForeground()
        controller.onForeground()
        runCurrent()
        assertEquals(1, count)

        controller.onBackground()
        controller.onForeground()
        controller.onForeground()
        runCurrent()
        assertEquals(2, count)
        assertTrue(controller.hasActiveLoop())
    }

    @Test
    fun `all hosts renew and one host failure does not stop another`() = runTest {
        val source = FakeHostSource(mutableListOf(RuntimeId("bad"), RuntimeId("good")))
        val sent = mutableListOf<String>()
        val controller = controller(source, jitter = { 0 }) { runtime, accessing ->
            assertFalse(accessing)
            if (runtime.value == "bad") throw IOException("offline")
            sent += runtime.value
        }
        controller.onForeground()
        runCurrent()
        assertEquals(listOf("good"), sent)

        advanceTimeBy(DEVICE_PRESENCE_INTERVAL_MILLIS)
        runCurrent()
        assertEquals(listOf("good", "good"), sent)
    }

    @Test
    fun `catalog empty stops old host and forbidden catalog clears projections`() = runTest {
        val source = FakeHostSource(mutableListOf(RuntimeId("a")))
        val sent = mutableListOf<String>()
        val controller = controller(source) { runtime, _ -> sent += runtime.value }
        controller.onForeground()
        runCurrent()
        source.ids.clear()
        advanceTimeBy(DEVICE_PRESENCE_INTERVAL_MILLIS)
        runCurrent()
        assertEquals(listOf("a"), sent)

        source.catalogFailure = RelayHttpException(403, null, "association_revoked")
        advanceTimeBy(DEVICE_PRESENCE_INTERVAL_MILLIS)
        runCurrent()
        assertEquals(1, source.clears)
    }

    @Test
    fun `host forbidden is purged while remaining host continues`() = runTest {
        val source = FakeHostSource(mutableListOf(RuntimeId("revoked"), RuntimeId("active")))
        val sent = mutableListOf<String>()
        val controller = controller(source) { runtime, _ ->
            if (runtime.value == "revoked") {
                throw RelayHttpException(403, null, "association_revoked")
            }
            sent += runtime.value
        }
        controller.onForeground()
        runCurrent()
        assertEquals(listOf("revoked"), source.removed)
        assertEquals(listOf("active"), sent)
    }

    @Test
    fun `logout cancels and auth change restores only while foreground`() = runTest {
        val source = FakeHostSource(mutableListOf(RuntimeId("a")))
        var authenticated = true
        var count = 0
        val controller = controller(source, authenticated = { authenticated }) { _, _ -> count++ }
        controller.onForeground()
        runCurrent()
        assertEquals(1, count)
        controller.onLogout()
        advanceUntilIdle()
        assertFalse(controller.hasActiveLoop())

        authenticated = false
        controller.onAuthenticationChanged()
        runCurrent()
        assertEquals(1, count)
        authenticated = true
        controller.onAuthenticationChanged()
        runCurrent()
        assertEquals(2, count)
    }

    private fun kotlinx.coroutines.test.TestScope.controller(
        source: FakeHostSource,
        authenticated: () -> Boolean = { true },
        jitter: () -> Long = { 0 },
        send: suspend (RuntimeId, Boolean) -> Unit,
    ) = DevicePresenceController(
        scope = backgroundScope,
        hosts = source,
        send = send,
        authenticated = authenticated,
        failureJitterMillis = jitter,
    )

    private class FakeHostSource(val ids: MutableList<RuntimeId>) : DevicePresenceHostSource {
        var catalogFailure: RelayHttpException? = null
        var clears = 0
        val removed = mutableListOf<String>()

        override suspend fun activeRuntimeIds(): List<RuntimeId> {
            catalogFailure?.let { throw it }
            return ids.toList()
        }

        override suspend fun removeRuntime(runtimeId: RuntimeId) {
            removed += runtimeId.value
            ids.remove(runtimeId)
        }

        override suspend fun clear() {
            clears++
            ids.clear()
        }
    }
}
