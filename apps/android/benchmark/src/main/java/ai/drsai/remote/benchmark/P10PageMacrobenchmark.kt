package ai.drsai.remote.benchmark

import android.content.ComponentName
import android.content.Intent
import android.util.Log
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class P10PageMacrobenchmark {
    @get:Rule val benchmark = MacrobenchmarkRule()
    private val targetPackage = "ai.drsai.remote.benchmark"

    @Test fun coldStart() = benchmark.measureRepeated(
        packageName = targetPackage,
        metrics = listOf(StartupTimingMetric()),
        compilationMode = CompilationMode.Full(),
        startupMode = StartupMode.COLD,
        iterations = 5,
        setupBlock = { pressHome() },
    ) { startActivityAndWait(fixtureIntent("setup")) }

    @Test fun setupJourney() = page("setup", "agent-setup-card")

    // The production timeline follows the latest item, so exercise older history from the bottom.
    @Test fun timeline500() = page("timeline-500", "oaep-timeline-list", scroll = true, scrollDown = false)

    @Test fun modelCatalog1000() = page("models-1000", "performance-model-list", scroll = true)

    /**
     * A separate stability gate complements frame traces: after warming the 1,000-row page,
     * repeated recomposition/scroll cycles must not cause monotonic process-memory growth.
     */
    @Test fun modelCatalogMemoryIsStable() {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.executeShellCommand("am force-stop $targetPackage")
        launchFixture(device, "models-1000", "performance-model-list")

        repeat(4) { scrollViewport(device, down = true) }
        val baselineKb = processPssKb(device)
        repeat(20) { index -> scrollViewport(device, down = index % 2 == 0) }
        device.executeShellCommand("am send-trim-memory $targetPackage RUNNING_LOW")
        device.waitForIdle()
        val finalKb = processPssKb(device)
        val growthKb = finalKb - baselineKb
        Log.i(PSS_TAG, "baseline_kb=$baselineKb final_kb=$finalKb growth_kb=$growthKb budget_kb=$MAX_RECOMPOSITION_PSS_GROWTH_KB")

        assertTrue(
            "PSS grew by ${growthKb}KB (baseline=${baselineKb}KB, final=${finalKb}KB)",
            growthKb <= MAX_RECOMPOSITION_PSS_GROWTH_KB,
        )
    }

    private fun page(page: String, tag: String, scroll: Boolean = false, scrollDown: Boolean = true) = benchmark.measureRepeated(
        packageName = targetPackage,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = CompilationMode.Full(),
        iterations = 5,
        setupBlock = { killProcess() },
    ) {
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        startActivityAndWait(fixtureIntent(page))
        device.wait(Until.hasObject(By.res(tag)), 5_000)
            .also { if (!it) error("benchmark_page_not_ready:$tag") }
        if (scroll) repeat(3) { scrollViewport(device, down = scrollDown) }
        device.waitForIdle()
    }

    private fun launchFixture(device: UiDevice, page: String, tag: String) {
        InstrumentationRegistry.getInstrumentation().targetContext.startActivity(fixtureIntent(page))
        device.wait(Until.hasObject(By.res(tag)), 5_000)
            .also { if (!it) error("benchmark_page_not_ready:$tag") }
        device.waitForIdle()
    }

    private fun fixtureIntent(page: String) = Intent().apply {
        component = ComponentName(targetPackage, "ai.drsai.remote.ui.PerformanceFixtureActivity")
        putExtra("page", page)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    }

    private fun scrollViewport(device: UiDevice, down: Boolean) {
        val x = device.displayWidth / 2
        val upper = device.displayHeight / 4
        val lower = device.displayHeight * 3 / 4
        if (down) device.swipe(x, lower, x, upper, 24) else device.swipe(x, upper, x, lower, 24)
        device.waitForIdle()
    }

    private fun processPssKb(device: UiDevice): Int {
        val output = device.executeShellCommand("dumpsys meminfo $targetPackage")
        val totalPss = Regex("TOTAL PSS:\\s*(\\d+)").find(output)?.groupValues?.get(1)?.toIntOrNull()
        val legacyTotal = Regex("(?m)^\\s*TOTAL\\s+(\\d+)").find(output)?.groupValues?.get(1)?.toIntOrNull()
        return totalPss ?: legacyTotal ?: error("benchmark_pss_not_found")
    }

    private companion object {
        const val PSS_TAG = "P10PageMemoryGate"
        const val MAX_RECOMPOSITION_PSS_GROWTH_KB = 16 * 1024
    }
}
