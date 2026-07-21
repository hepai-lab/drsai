package ai.drsai.remote

import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeBinding
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.workbench.model.RuntimeCapabilitySet
import ai.drsai.remote.workbench.model.RuntimeRouteDecision
import ai.drsai.remote.workbench.model.RuntimeRoutePolicy
import ai.drsai.remote.workbench.model.TaskRequirements
import ai.drsai.remote.workbench.model.WorkbenchId
import ai.drsai.remote.workbench.model.WorkbenchRun
import ai.drsai.remote.workbench.model.WorkbenchRunStatus
import ai.drsai.remote.workbench.model.WorkbenchWorkspace
import ai.drsai.remote.workbench.model.WorkspaceKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class WorkbenchModelsTest {
    @Test fun localWorkspaceRequiresLocalAuthority() {
        assertThrows(IllegalArgumentException::class.java) {
            WorkbenchWorkspace(
                "alice", "ihep",
                RuntimeBinding(WorkbenchId("remote-1"), RuntimeAuthority.REMOTE_RUNTIME),
                WorkbenchId("local:alice"), "本地", WorkspaceKind.LOCAL, 1,
            )
        }
    }

    @Test fun runCannotBeCopiedOrAdvancedWithoutNewSequence() {
        val run = run()
        assertFalse(run.javaClass.declaredMethods.any { it.name == "copy" })
        assertThrows(IllegalArgumentException::class.java) {
            run.advance(WorkbenchRunStatus.RUNNING, 0)
        }
        assertEquals(1, run.advance(WorkbenchRunStatus.RUNNING, 1).lastSequence)
    }

    @Test fun scopeCheckRejectsRuntimeRebinding() {
        val original = run()
        val rebound = WorkbenchRun(
            "alice", "ihep",
            RuntimeBinding(WorkbenchId("remote"), RuntimeAuthority.REMOTE_RUNTIME),
            original.workspaceId, original.sessionId, original.runId, "opendrsai",
            WorkbenchRunStatus.QUEUED,
        )
        assertThrows(IllegalArgumentException::class.java) { original.requireSameScope(rebound) }
    }

    @Test fun capabilityRoutingIsDeterministicAndHonorsExplicitBinding() {
        val local = RuntimeCapabilitySet(values = setOf(RuntimeCapability.CHAT, RuntimeCapability.LOCAL_MEMORY))
        val remote = RuntimeCapabilitySet(values = setOf(RuntimeCapability.CHAT, RuntimeCapability.SHELL))
        assertEquals(
            RuntimeRouteDecision.REMOTE,
            RuntimeRoutePolicy.decide(TaskRequirements(setOf(RuntimeCapability.SHELL)), local, remote),
        )
        assertEquals(
            RuntimeRouteDecision.UNSUPPORTED,
            RuntimeRoutePolicy.decide(
                TaskRequirements(setOf(RuntimeCapability.SHELL)), local, remote, RuntimeAuthority.LOCAL_DEVICE,
            ),
        )
        assertEquals(
            RuntimeRouteDecision.USER_CHOICE_REQUIRED,
            RuntimeRoutePolicy.decide(TaskRequirements(setOf(RuntimeCapability.CHAT)), local, remote),
        )
    }

    private fun run() = WorkbenchRun(
        "alice", "ihep", RuntimeBinding.AndroidLocal,
        WorkbenchId("local:alice"), WorkbenchId("session"), WorkbenchId("run"),
        "opendrsai", WorkbenchRunStatus.QUEUED,
    )
}
