package ai.drsai.remote

import ai.drsai.remote.remote.data.RemoteRunLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.Job
import org.junit.Assert.*
import org.junit.Test

class RemoteProcessRecoveryTest {
    @Test fun `background stops SSE and foreground queries before resume`() {
        var stops = 0; var resumes = 0
        val owner = object : LifecycleOwner { override val lifecycle: Lifecycle get() = error("unused") }
        val observer = RemoteRunLifecycleObserver({ stops++ }, { resumes++; Job() })
        observer.onStart(owner)
        observer.onStop(owner)
        observer.onStart(owner)
        assertEquals(1, stops); assertEquals(2, resumes)
    }
}
