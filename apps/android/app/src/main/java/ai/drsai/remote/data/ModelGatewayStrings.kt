package ai.drsai.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class ModelGatewayText {
    EMPTY_RESPONSE, STREAM_INTERRUPTED, RETRY_EMPTY_RESPONSE, SIGN_IN_FIRST, NETWORK_FAILED,
    IMAGE_UNSUPPORTED, SCHEMA_REJECTED, LOGIN_EXPIRED, API_KEY_INVALID, MODEL_FORBIDDEN,
    MODEL_NOT_FOUND, RATE_LIMITED, SERVICE_UNAVAILABLE, REQUEST_FAILED, INVALID_STREAM,
    STREAM_ERROR, NO_AVAILABLE_MODEL,
}

interface ModelGatewayStrings { fun text(key: ModelGatewayText, vararg arguments: Any): String }

class AndroidModelGatewayStrings(private val context: Context) : ModelGatewayStrings {
    override fun text(key: ModelGatewayText, vararg arguments: Any): String = context.getString(when (key) {
        ModelGatewayText.EMPTY_RESPONSE -> R.string.model_empty_body
        ModelGatewayText.STREAM_INTERRUPTED -> R.string.model_stream_interrupted
        ModelGatewayText.RETRY_EMPTY_RESPONSE -> R.string.model_retry_empty_response
        ModelGatewayText.SIGN_IN_FIRST -> R.string.platform_sign_in_first
        ModelGatewayText.NETWORK_FAILED -> R.string.model_network_failed
        ModelGatewayText.IMAGE_UNSUPPORTED -> R.string.model_image_unsupported
        ModelGatewayText.SCHEMA_REJECTED -> R.string.model_schema_rejected
        ModelGatewayText.LOGIN_EXPIRED -> R.string.platform_login_expired
        ModelGatewayText.API_KEY_INVALID -> R.string.model_api_key_invalid
        ModelGatewayText.MODEL_FORBIDDEN -> R.string.model_forbidden
        ModelGatewayText.MODEL_NOT_FOUND -> R.string.model_not_found
        ModelGatewayText.RATE_LIMITED -> R.string.model_rate_limited
        ModelGatewayText.SERVICE_UNAVAILABLE -> R.string.model_service_unavailable
        ModelGatewayText.REQUEST_FAILED -> R.string.model_request_failed
        ModelGatewayText.INVALID_STREAM -> R.string.model_invalid_stream
        ModelGatewayText.STREAM_ERROR -> R.string.model_stream_error
        ModelGatewayText.NO_AVAILABLE_MODEL -> R.string.model_no_available_model
    }, *arguments)
}

object EnglishModelGatewayStrings : ModelGatewayStrings {
    override fun text(key: ModelGatewayText, vararg arguments: Any): String = when (key) {
        ModelGatewayText.EMPTY_RESPONSE -> "The model response is empty"
        ModelGatewayText.STREAM_INTERRUPTED -> "The model stream ended before completion"
        ModelGatewayText.RETRY_EMPTY_RESPONSE -> "The model returned an empty response; try again"
        ModelGatewayText.SIGN_IN_FIRST -> "Sign in first"
        ModelGatewayText.NETWORK_FAILED -> "Network connection failed"
        ModelGatewayText.IMAGE_UNSUPPORTED -> "The ${arguments.getOrNull(0)} model does not support image input; switch to a vision model"
        ModelGatewayText.SCHEMA_REJECTED -> "${arguments.getOrNull(0)} rejected the current tool schema${arguments.getOrNull(1)?.toString().orEmpty()}"
        ModelGatewayText.LOGIN_EXPIRED -> "Your HAI sign-in expired; sign in again"
        ModelGatewayText.API_KEY_INVALID -> "The ${arguments.getOrNull(0)} API key is invalid or expired"
        ModelGatewayText.MODEL_FORBIDDEN -> "${arguments.getOrNull(0)} denied access to this model"
        ModelGatewayText.MODEL_NOT_FOUND -> "${arguments.getOrNull(0)} does not provide the requested model${arguments.getOrNull(1)?.toString().orEmpty()}"
        ModelGatewayText.RATE_LIMITED -> "Model requests are too frequent or quota is insufficient; try again later"
        ModelGatewayText.SERVICE_UNAVAILABLE -> "The ${arguments.getOrNull(0)} model service is temporarily unavailable (HTTP ${arguments.getOrNull(1)})${arguments.getOrNull(2)?.toString().orEmpty()}"
        ModelGatewayText.REQUEST_FAILED -> "Model request failed (HTTP ${arguments.getOrNull(0)})"
        ModelGatewayText.INVALID_STREAM -> "The model returned invalid stream data"
        ModelGatewayText.STREAM_ERROR -> "The model stream returned an error"
        ModelGatewayText.NO_AVAILABLE_MODEL -> "This HAI account has no available models"
    }
}
