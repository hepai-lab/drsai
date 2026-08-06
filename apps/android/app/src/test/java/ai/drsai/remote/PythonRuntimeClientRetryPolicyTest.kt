package ai.drsai.remote

import ai.drsai.remote.runtime.python.isExternalBindCancellation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PythonRuntimeClientRetryPolicyTest {
    @Test fun healthTimeoutIsRetriedButCallerCancellationStopsImmediately() = runBlocking {
        val timeout = runCatching { withTimeout(1) { delay(10) } }.exceptionOrNull()!!
        assertFalse(isExternalBindCancellation(timeout))
        assertTrue(isExternalBindCancellation(CancellationException("caller cancelled")))
        assertFalse(isExternalBindCancellation(IllegalStateException("bind failed")))
    }
}
