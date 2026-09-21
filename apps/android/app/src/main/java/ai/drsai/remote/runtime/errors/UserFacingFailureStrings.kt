package ai.drsai.remote.runtime.errors

import ai.drsai.remote.R
import android.content.Context

enum class FailureCopyKey {
    PROVIDER_KEY, PROVIDER_ACCESS, PROVIDER_BALANCE, PROVIDER_TIMEOUT, PROVIDER_RATE,
    PROVIDER_SERVER, PROVIDER_STREAM, CONFIGURATION, CREDENTIAL, QUOTA, NETWORK,
    MODEL_CAPABILITY, RUNTIME, PERMISSION, TOOL_RETRY, TOOL_FINAL, APPROVAL, RECOVERY,
    PLATFORM_UNSUPPORTED,
}

data class FailureCopy(val title: String, val summary: String, val impact: String)
interface UserFacingFailureStrings { fun copy(key: FailureCopyKey): FailureCopy }

class AndroidUserFacingFailureStrings(private val context: Context) : UserFacingFailureStrings {
    override fun copy(key: FailureCopyKey): FailureCopy {
        val ids = when (key) {
            FailureCopyKey.PROVIDER_KEY -> Triple(R.string.failure_provider_key_title, R.string.failure_provider_key_summary, R.string.failure_provider_key_impact)
            FailureCopyKey.PROVIDER_ACCESS -> Triple(R.string.failure_provider_access_title, R.string.failure_provider_access_summary, R.string.failure_provider_access_impact)
            FailureCopyKey.PROVIDER_BALANCE -> Triple(R.string.failure_provider_balance_title, R.string.failure_provider_balance_summary, R.string.failure_provider_balance_impact)
            FailureCopyKey.PROVIDER_TIMEOUT -> Triple(R.string.failure_provider_timeout_title, R.string.failure_provider_timeout_summary, R.string.failure_provider_timeout_impact)
            FailureCopyKey.PROVIDER_RATE -> Triple(R.string.failure_provider_rate_title, R.string.failure_provider_rate_summary, R.string.failure_provider_rate_impact)
            FailureCopyKey.PROVIDER_SERVER -> Triple(R.string.failure_provider_server_title, R.string.failure_provider_server_summary, R.string.failure_provider_server_impact)
            FailureCopyKey.PROVIDER_STREAM -> Triple(R.string.failure_provider_stream_title, R.string.failure_provider_stream_summary, R.string.failure_provider_stream_impact)
            FailureCopyKey.CONFIGURATION -> Triple(R.string.failure_configuration_title, R.string.failure_configuration_summary, R.string.failure_configuration_impact)
            FailureCopyKey.CREDENTIAL -> Triple(R.string.failure_credential_title, R.string.failure_credential_summary, R.string.failure_credential_impact)
            FailureCopyKey.QUOTA -> Triple(R.string.failure_quota_title, R.string.failure_quota_summary, R.string.failure_quota_impact)
            FailureCopyKey.NETWORK -> Triple(R.string.failure_network_title, R.string.failure_network_summary, R.string.failure_network_impact)
            FailureCopyKey.MODEL_CAPABILITY -> Triple(R.string.failure_model_capability_title, R.string.failure_model_capability_summary, R.string.failure_model_capability_impact)
            FailureCopyKey.RUNTIME -> Triple(R.string.failure_runtime_title, R.string.failure_runtime_summary, R.string.failure_runtime_impact)
            FailureCopyKey.PERMISSION -> Triple(R.string.failure_permission_title, R.string.failure_permission_summary, R.string.failure_permission_impact)
            FailureCopyKey.TOOL_RETRY -> Triple(R.string.failure_tool_title, R.string.failure_tool_retry_summary, R.string.failure_tool_impact)
            FailureCopyKey.TOOL_FINAL -> Triple(R.string.failure_tool_title, R.string.failure_tool_final_summary, R.string.failure_tool_impact)
            FailureCopyKey.APPROVAL -> Triple(R.string.failure_approval_title, R.string.failure_approval_summary, R.string.failure_approval_impact)
            FailureCopyKey.RECOVERY -> Triple(R.string.failure_recovery_title, R.string.failure_recovery_summary, R.string.failure_recovery_impact)
            FailureCopyKey.PLATFORM_UNSUPPORTED -> Triple(R.string.failure_platform_title, R.string.failure_platform_summary, R.string.failure_platform_impact)
        }
        return FailureCopy(context.getString(ids.first), context.getString(ids.second), context.getString(ids.third))
    }
}

object EnglishUserFacingFailureStrings : UserFacingFailureStrings {
    override fun copy(key: FailureCopyKey): FailureCopy = when (key) {
        FailureCopyKey.PROVIDER_KEY -> FailureCopy("Invalid model credential", "The provider rejected the current API key. Update and verify it.", "The model request was not sent successfully; the task is preserved.")
        FailureCopyKey.PROVIDER_ACCESS -> FailureCopy("Insufficient model access", "The API key is valid but cannot access this model or endpoint.", "The provider rejected this model request; the task is preserved.")
        FailureCopyKey.PROVIDER_BALANCE -> FailureCopy("Insufficient model account balance", "Check the provider balance, plan, or billing status.", "This model cannot be called until the account is restored.")
        FailureCopyKey.PROVIDER_TIMEOUT -> FailureCopy("Model service timed out", "The request did not finish in time. Check the network and safely retry the model stage.", "The model response is incomplete; the task checkpoint is preserved.")
        FailureCopyKey.PROVIDER_RATE -> FailureCopy("Requests are too frequent", "The provider is rate limiting requests. Follow Retry-After or try later.", "The current request is incomplete; the API key does not need replacement.")
        FailureCopyKey.PROVIDER_SERVER -> FailureCopy("Model service is temporarily unavailable", "The provider returned a server error. Try again later.", "The error came from the model service and does not mean Android Runtime is damaged.")
        FailureCopyKey.PROVIDER_STREAM -> FailureCopy("Model response interrupted", "The provider connection closed before the response completed. Retry from the safe checkpoint.", "An incomplete response is not saved as the final answer.")
        FailureCopyKey.CONFIGURATION -> FailureCopy("Setup is still required", "Check the model service and current task settings before continuing.", "The task has not started.")
        FailureCopyKey.CREDENTIAL -> FailureCopy("Invalid model credential", "Update the credential and check the connection again.", "The model request cannot continue.")
        FailureCopyKey.QUOTA -> FailureCopy("Service is temporarily limiting requests", "Quota may be insufficient or requests too frequent. Try again later.", "The current request is incomplete.")
        FailureCopyKey.NETWORK -> FailureCopy("Network connection interrupted", "The task is preserved and can continue when the network recovers.", "The unfinished network stage is paused.")
        FailureCopyKey.MODEL_CAPABILITY -> FailureCopy("This model cannot perform the task", "Choose a verified model that supports agent tools.", "The tool-dependent task has not executed.")
        FailureCopyKey.RUNTIME -> FailureCopy("Agent Runtime is temporarily unavailable", "Restart the Runtime; the app will not switch to Lite mode.", "The current task is paused.")
        FailureCopyKey.PERMISSION -> FailureCopy("Permission required", "Only the minimum access needed by this task will be requested.", "The target is not accessed before permission is granted.")
        FailureCopyKey.TOOL_RETRY -> FailureCopy("Operation did not complete", "You can safely retry this operation.", "Only existing reliable results are retained.")
        FailureCopyKey.TOOL_FINAL -> FailureCopy("Operation did not complete", "Review the details and adjust the task.", "Only existing reliable results are retained.")
        FailureCopyKey.APPROVAL -> FailureCopy("Operation is awaiting confirmation", "Review the target and risk before allowing it.", "The operation is not executed before confirmation.")
        FailureCopyKey.RECOVERY -> FailureCopy("Task recovery required", "Completed steps are preserved; continue from the safe checkpoint.", "Completed results will not run twice.")
        FailureCopyKey.PLATFORM_UNSUPPORTED -> FailureCopy("This task requires Desktop", "Connect Desktop Runtime to continue.", "Android will not pretend to execute unsupported capabilities.")
    }
}
