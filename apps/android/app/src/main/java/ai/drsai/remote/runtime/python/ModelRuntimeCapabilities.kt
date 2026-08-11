package ai.drsai.remote.runtime.python

import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.ModelInfo
import java.security.MessageDigest

data class ModelRuntimeCapabilities(
    val modelId: String,
    val wireApi: String,
    val tools: Boolean,
    val parallelTools: Boolean,
    val reasoning: Boolean,
    val source: String,
    val status: String = "known",
) {
    init {
        require(modelId.isNotBlank()) { "model_capability_model_id_missing" }
        require(wireApi in setOf("openai", "anthropic")) { "model_capability_wire_api_invalid" }
        require(source in setOf("probe", "configured", "provider_metadata")) { "model_capability_source_invalid" }
        require(status in setOf("known", "unknown", "incompatible")) { "model_capability_status_invalid" }
        require(!parallelTools || tools) { "model_parallel_tools_require_tools" }
    }

    val digest: String = MessageDigest.getInstance("SHA-256").digest(
        listOf(modelId, wireApi, tools, parallelTools, reasoning, source, status).joinToString("\u0000").encodeToByteArray(),
    ).joinToString("") { "%02x".format(it) }

    companion object {
        fun configured(model: ModelInfo, wireApi: String) = ModelRuntimeCapabilities(
            model.id,
            wireApi,
            tools = model.tools,
            parallelTools = false,
            reasoning = model.reasoning,
            source = if (model.source.equals("DISCOVERED", true)) "provider_metadata" else "configured",
            status = if (model.source.equals("DISCOVERED", true) && !model.tools && !model.reasoning) "unknown" else "known",
        )
    }
}

fun ModelRuntimeCapabilities.requireRunSupport(toolSchemaCount: Int) {
    if (status != "known") throw ApiException(
        422, "model_capabilities_unknown:$modelId:$source", retryable = false, code = "model_capabilities_unknown",
    )
    if (toolSchemaCount > 0 && !tools) throw ApiException(
        422, "model_tools_unsupported:$modelId:preflight", retryable = false, code = "model_tools_unsupported",
    )
}

fun ModelRuntimeCapabilities.requireToolCallBatch(callCount: Int) {
    if (callCount > 1 && !parallelTools) throw ApiException(
        422, "model_parallel_tools_unsupported:$modelId:$callCount", retryable = false,
        code = "model_parallel_tools_unsupported",
    )
}
