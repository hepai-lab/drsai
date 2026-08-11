package ai.drsai.remote

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.runtime.python.SharedPreferencesPythonRuntimeMetrics
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PythonRuntimeMetricsTest {
    @Test fun recordsOnlyAggregateProductionMetrics() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        context.getSharedPreferences("python_runtime_metrics_v1", Context.MODE_PRIVATE).edit().clear().commit()
        val metrics = SharedPreferencesPythonRuntimeMetrics(context)
        metrics.runtimeStarted()
        metrics.bindFinished(12, true)
        metrics.recoveryFinished(40, true)
        metrics.duplicateSideEffectBlocked()
        metrics.safeFallback()

        val snapshot = metrics.snapshot()
        assertEquals(1, snapshot.starts)
        assertEquals(12, snapshot.bindLatencyTotalMs)
        assertEquals(1.0, snapshot.recoverySuccessRate, 0.0)
        assertEquals(1.0, snapshot.fallbackRate, 0.0)
        val keys = context.getSharedPreferences("python_runtime_metrics_v1", Context.MODE_PRIVATE).all.keys
        assertTrue(keys.none { it.contains("content") || it.contains("uri") || it.contains("path") || it.contains("token") })
    }
}
