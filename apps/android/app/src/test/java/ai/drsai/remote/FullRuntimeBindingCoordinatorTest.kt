package ai.drsai.remote

import ai.drsai.remote.runtime.python.FullRuntimeBindingCoordinator
import ai.drsai.remote.runtime.python.FullRuntimeBindingDiagnosticSink
import ai.drsai.remote.runtime.python.FullRuntimeBindingListener
import ai.drsai.remote.runtime.python.FullRuntimeBindingSnapshot
import ai.drsai.remote.runtime.python.FullRuntimeBindingState
import ai.drsai.remote.runtime.python.FullRuntimeBindingTransport
import ai.drsai.remote.runtime.python.FullRuntimeIdentity
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FullRuntimeBindingCoordinatorTest {
    @Test fun `concurrent callers share one account binding`() = runTest {
        val transport = FakeTransport(identity = identity())
        val observed = mutableListOf<FullRuntimeBindingSnapshot>()
        val coordinator = FullRuntimeBindingCoordinator(
            this, transport, FullRuntimeBindingDiagnosticSink(observed::add), retryDelayMs = 1,
        )

        listOf(async { coordinator.ensureReady("alice") }, async { coordinator.ensureReady("alice") }).awaitAll()

        assertEquals(1, transport.binds)
        assertEquals(FullRuntimeBindingState.READY, coordinator.state.value.state)
        assertEquals("alice", coordinator.state.value.accountSubject)
        assertEquals("p9-tools-v1", coordinator.state.value.identity?.toolManifestVersion)
        assertEquals("a".repeat(64), coordinator.state.value.identity?.kernelSha256)
        assertTrue(observed.any { it.state == FullRuntimeBindingState.BINDING })
    }

    @Test fun `runtime identity rejects malformed or missing digest evidence`() {
        val error = runCatching { identity(kernelSha256 = "not-a-digest") }.exceptionOrNull()
        assertEquals("runtime_identity_digest_invalid", error?.message)
    }

    @Test fun `binder death automatically rebinds the same account`() = runTest {
        val transport = FakeTransport()
        val coordinator = FullRuntimeBindingCoordinator(this, transport, retryDelayMs = 1)
        coordinator.bind("alice")

        transport.listener?.onConnectionLost("binder_died")
        advanceUntilIdle()

        assertEquals(2, transport.binds)
        assertEquals(FullRuntimeBindingState.READY, coordinator.state.value.state)
        assertEquals("alice", coordinator.state.value.accountSubject)
    }

    @Test fun `failed bind is explicit unavailable and never changes authority`() = runTest {
        val transport = FakeTransport(failures = 2)
        val coordinator = FullRuntimeBindingCoordinator(this, transport, maxAttempts = 2, retryDelayMs = 1)

        val error = runCatching { coordinator.ensureReady("alice") }.exceptionOrNull()

        assertTrue(error?.message.orEmpty().startsWith("full_runtime_unavailable:"))
        assertEquals(2, transport.binds)
        assertEquals(FullRuntimeBindingState.UNAVAILABLE, coordinator.state.value.state)
        assertEquals("alice", coordinator.state.value.accountSubject)
    }

    @Test fun `account switch closes old binding and logout clears identity`() = runTest {
        val transport = FakeTransport()
        val coordinator = FullRuntimeBindingCoordinator(this, transport, retryDelayMs = 1)
        coordinator.bind("alice")
        coordinator.bind("bob")

        assertEquals(1, transport.closes)
        assertEquals("bob", coordinator.state.value.accountSubject)
        coordinator.release("bob")
        assertEquals(2, transport.closes)
        assertEquals(FullRuntimeBindingState.UNINITIALIZED, coordinator.state.value.state)
        assertEquals(null, coordinator.state.value.accountSubject)
    }

    private fun identity(kernelSha256: String = "a".repeat(64)) = FullRuntimeIdentity(
        kernelId = "drsai-agent-kernel",
        kernelVersion = "p9.1",
        kernelSha256 = kernelSha256,
        promptVersion = "p9-agent-kernel-v1",
        promptSha256 = "b".repeat(64),
        toolManifestVersion = "p9-tools-v1",
        capabilityManifestVersion = "p9-capabilities-v1",
        capabilityManifestSha256 = "c".repeat(64),
        runtimeProcessName = "ai.drsai.remote.debug:runtime",
        runtimePid = 4242,
    )

    private class FakeTransport(
        private var failures: Int = 0,
        private val identity: FullRuntimeIdentity? = null,
    ) : FullRuntimeBindingTransport {
        var binds = 0
        var closes = 0
        var listener: FullRuntimeBindingListener? = null

        override suspend fun bind() {
            binds += 1
            delay(10)
            if (failures > 0) {
                failures -= 1
                error("bind_failed")
            }
        }

        override fun setBindingListener(listener: FullRuntimeBindingListener?) {
            this.listener = listener
        }

        override fun runtimeIdentity(): FullRuntimeIdentity? = identity

        override fun close() {
            closes += 1
        }
    }
}
