package ai.drsai.remote.runtime.device

enum class WorkspaceAuthorizationStep { IDLE, EXPLAINING_SCOPE, PICKING_DIRECTORY }

data class WorkspaceAuthorizationJourney(
    val step: WorkspaceAuthorizationStep = WorkspaceAuthorizationStep.IDLE,
    val runId: String? = null,
) {
    val visible: Boolean get() = step == WorkspaceAuthorizationStep.EXPLAINING_SCOPE

    fun request(runId: String?): WorkspaceAuthorizationJourney =
        WorkspaceAuthorizationJourney(WorkspaceAuthorizationStep.EXPLAINING_SCOPE, runId)

    fun openPicker(): WorkspaceAuthorizationJourney =
        if (step == WorkspaceAuthorizationStep.EXPLAINING_SCOPE) copy(step = WorkspaceAuthorizationStep.PICKING_DIRECTORY) else this

    fun denied(): WorkspaceAuthorizationJourney = WorkspaceAuthorizationJourney()
    fun granted(): WorkspaceAuthorizationJourney = WorkspaceAuthorizationJourney()
}
