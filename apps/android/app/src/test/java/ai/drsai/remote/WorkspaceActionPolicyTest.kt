package ai.drsai.remote

import ai.drsai.remote.workbench.model.RuntimeAuthority
import ai.drsai.remote.workbench.model.RuntimeCapability
import ai.drsai.remote.workbench.model.RuntimeCapabilitySet
import ai.drsai.remote.workbench.model.WorkspaceAction
import ai.drsai.remote.workbench.model.WorkspaceActionContext
import ai.drsai.remote.workbench.model.WorkspaceActionDecision
import ai.drsai.remote.workbench.model.WorkspaceActionPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

class WorkspaceActionPolicyTest {
    private fun context(
        authority: RuntimeAuthority,
        online: Boolean = true,
        vararg capabilities: RuntimeCapability,
    ) = WorkspaceActionContext(authority, RuntimeCapabilitySet(values = capabilities.toSet()), online)

    @Test
    fun detailsRemainVisibleForOfflineRemoteWorkspace() {
        assertEquals(
            WorkspaceActionDecision.ALLOW,
            WorkspaceActionPolicy.decide(
                WorkspaceAction.VIEW_DETAILS,
                context(RuntimeAuthority.REMOTE_RUNTIME, online = false),
            ),
        )
    }

    @Test
    fun offlineRemoteActionsAreDisabledBeforeCapabilityEvaluation() {
        RuntimeCapability.entries.forEach { capability ->
            val decision = WorkspaceActionPolicy.decide(
                WorkspaceAction.CREATE_SESSION,
                context(RuntimeAuthority.REMOTE_RUNTIME, false, capability),
            )
            assertEquals(WorkspaceActionDecision.DISABLED_OFFLINE, decision)
        }
    }

    @Test
    fun localWorkspaceUsesSafCapabilitiesAndNeverRunsDangerousActions() {
        assertEquals(
            WorkspaceActionDecision.ALLOW,
            WorkspaceActionPolicy.decide(
                WorkspaceAction.READ_PROJECT_FILE,
                context(RuntimeAuthority.LOCAL_DEVICE, true, RuntimeCapability.SAF_READ),
            ),
        )
        listOf(
            WorkspaceAction.WRITE_PROJECT_FILE to RuntimeCapability.SAF_WRITE,
            WorkspaceAction.RUN_SHELL_COMMAND to RuntimeCapability.SHELL,
            WorkspaceAction.MUTATE_GIT_STATE to RuntimeCapability.GIT,
            WorkspaceAction.CREATE_WORKTREE to RuntimeCapability.WORKTREE,
        ).forEach { (action, capability) ->
            assertEquals(
                WorkspaceActionDecision.DISABLED_ON_DEVICE,
                WorkspaceActionPolicy.decide(
                    action,
                    context(RuntimeAuthority.LOCAL_DEVICE, true, capability),
                ),
            )
        }
    }

    @Test
    fun dangerousRemoteActionsRequireBothCapabilityAndApprovalSupport() {
        val matrix = listOf(
            WorkspaceAction.WRITE_PROJECT_FILE to RuntimeCapability.PROJECT_FILES,
            WorkspaceAction.RUN_SHELL_COMMAND to RuntimeCapability.SHELL,
            WorkspaceAction.MUTATE_GIT_STATE to RuntimeCapability.GIT,
            WorkspaceAction.CREATE_WORKTREE to RuntimeCapability.WORKTREE,
        )
        matrix.forEach { (action, capability) ->
            assertEquals(
                WorkspaceActionDecision.DISABLED_MISSING_CAPABILITY,
                WorkspaceActionPolicy.decide(
                    action,
                    context(RuntimeAuthority.REMOTE_RUNTIME, true, capability),
                ),
            )
            assertEquals(
                WorkspaceActionDecision.REQUIRE_REMOTE_APPROVAL,
                WorkspaceActionPolicy.decide(
                    action,
                    context(
                        RuntimeAuthority.REMOTE_RUNTIME,
                        true,
                        capability,
                        RuntimeCapability.APPROVALS,
                    ),
                ),
            )
        }
    }

    @Test
    fun missingCapabilityNeverEnablesAnAction() {
        WorkspaceAction.entries.filterNot { it == WorkspaceAction.VIEW_DETAILS }.forEach { action ->
            assertEquals(
                WorkspaceActionDecision.DISABLED_MISSING_CAPABILITY,
                WorkspaceActionPolicy.decide(
                    action,
                    context(RuntimeAuthority.REMOTE_RUNTIME),
                ),
            )
        }
    }
}
