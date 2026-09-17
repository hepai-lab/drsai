package ai.drsai.remote

import ai.drsai.remote.runtime.coordinator.DesktopHandoffPlanner
import ai.drsai.remote.runtime.coordinator.DesktopHandoffState
import ai.drsai.remote.runtime.coordinator.DesktopHandoffTargetSelector
import ai.drsai.remote.runtime.coordinator.RuntimeDescriptor
import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.workbench.model.RuntimeCapabilitySet
import ai.drsai.remote.workbench.model.WorkbenchId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DesktopHandoffTargetSelectorTest {
    private fun target(id: String, name: String, online: Boolean, shell: Boolean = true) = RuntimeDescriptor(
        RuntimeBinding(WorkbenchId(id), RuntimeAuthority.REMOTE_RUNTIME), name, "1", online,
        RuntimeCapabilitySet(values = buildSet { add(RuntimeCapability.CHAT); if (shell) add(RuntimeCapability.SHELL) }),
    )

    @Test fun noneSingleMultipleOfflineAndInsufficientTargetsAreExact() {
        assertEquals(DesktopHandoffState.UNAVAILABLE, DesktopHandoffPlanner.plan("运行 shell", emptyList()).state)
        val alpha = target("a", "Alpha", true)
        val beta = target("b", "Beta", true)
        val offline = target("off", "Offline", false)
        val insufficient = target("weak", "Weak", true, shell = false)
        val decision = DesktopHandoffPlanner.plan("运行 shell", listOf(beta, offline, insufficient, alpha))
        assertEquals(listOf("a", "b"), decision.targets.map { it.binding.runtimeId.value })
        assertEquals("b", DesktopHandoffTargetSelector.select(decision.targets, "b").binding.runtimeId.value)
        assertThrows(IllegalStateException::class.java) { DesktopHandoffTargetSelector.select(decision.targets, "off") }
        assertThrows(IllegalStateException::class.java) { DesktopHandoffTargetSelector.select(decision.targets, "missing") }
    }
}
