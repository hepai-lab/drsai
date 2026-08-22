package ai.drsai.remote.runtime.coordinator

import ai.drsai.remote.remote.generated.OaepInteractionContent
import ai.drsai.remote.remote.generated.OaepNoticeContent
import ai.drsai.remote.runtime.oaep.NormalizedAgentEvent

/** OAEP is the authority for every Desktop handoff offer and decision. */
object DesktopHandoffOaep {
    fun offered(runId: String, handoffId: String, decision: DesktopHandoffDecision): List<NormalizedAgentEvent> {
        require(runId.isNotBlank() && handoffId.isNotBlank()) { "handoff_oaep_identity_required" }
        require(decision.state == DesktopHandoffState.OFFER && decision.target != null) { "handoff_oaep_offer_invalid" }
        val itemId = itemId(runId, handoffId)
        return listOf(
            NormalizedAgentEvent.RunStarted,
            NormalizedAgentEvent.ItemCreated(
                itemId, "interaction",
                OaepInteractionContent(
                    interactionType = "handoff",
                    prompt = decision.message,
                    options = listOf(
                        mapOf("id" to "accept", "label" to "Open Desktop Runtime"),
                        mapOf("id" to "decline", "label" to "Cancel"),
                    ),
                    operation = "runtime.handoff",
                    requestSummary = mapOf(
                        "handoff_id" to handoffId,
                        "target_runtime_id" to decision.target.binding.runtimeId.value,
                        "required_capabilities" to decision.required.map { it.name.lowercase() }.sorted(),
                        "execution_location" to "desktop",
                        "kind" to decision.kind.name.lowercase(),
                        "transport" to if (decision.kind == DesktopHandoffKind.MCP_STDIO) "stdio" else null,
                        "resource_id" to decision.resourceId,
                        "remote_tool_approval_required" to true,
                    ).filterValues { it != null },
                ),
                status = "waiting",
            ),
            NormalizedAgentEvent.RunWaiting("handoff", itemId),
        )
    }

    fun accepted(runId: String, handoffId: String, value: HandoffPackage): List<NormalizedAgentEvent> = listOf(
        NormalizedAgentEvent.ItemCompleted(
            itemId(runId, handoffId), "interaction",
            OaepInteractionContent(
                interactionType = "handoff", prompt = "Desktop Runtime handoff",
                options = emptyList(), operation = "runtime.handoff", response = "accept",
                requestSummary = mapOf(
                    "handoff_id" to handoffId,
                    "target_runtime_id" to value.targetRuntimeId.value,
                    "package_sha256" to value.digest,
                    "execution_location" to "desktop",
                    "transport" to value.transport,
                    "resource_id" to value.resourceId,
                    "remote_tool_approval_required" to value.remoteToolApprovalRequired,
                ).filterValues { it != null },
            ),
        ),
        NormalizedAgentEvent.ItemCompleted(
            "$runId:notice:handoff-created:$handoffId", "notice",
            OaepNoticeContent(
                "info", "handoff_created", "Desktop Runtime handoff package created",
                details = mapOf(
                    "handoff_id" to handoffId, "target_runtime_id" to value.targetRuntimeId.value,
                    "package_sha256" to value.digest, "execution_location" to "desktop",
                ),
            ),
        ),
        NormalizedAgentEvent.RunCompleted,
    )

    fun declined(runId: String, handoffId: String): List<NormalizedAgentEvent> = listOf(
        NormalizedAgentEvent.ItemCompleted(
            itemId(runId, handoffId), "interaction",
            OaepInteractionContent(
                interactionType = "handoff", prompt = "Desktop Runtime handoff",
                options = emptyList(), operation = "runtime.handoff", response = "decline",
                requestSummary = mapOf("handoff_id" to handoffId),
            ),
        ),
        NormalizedAgentEvent.RunCancelled,
    )

    private fun itemId(runId: String, handoffId: String) = "$runId:interaction:handoff:$handoffId"
}
