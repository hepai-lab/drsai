package ai.drsai.remote.remote.data

import ai.drsai.remote.remote.generated.RelayContractGenerated

enum class RemoteRecoveryAction {
    NONE, RETRY, SIGN_IN, UPDATE_APP, REASSOCIATE, CONTACT_ADMIN, RESUME_ON_COMPUTER,
}

enum class RemoteActionableKind {
    CUSTOM, PAUSED, LOADING, STALE, OFFLINE, AUTH_REQUIRED, REVOKED, INCOMPATIBLE,
    RETRY_FAILURE, SIGN_IN_FAILURE, REASSOCIATE_FAILURE, UPDATE_FAILURE, CONTACT_ADMIN_FAILURE,
}

data class RemoteActionableState(
    val title: String,
    val reason: String,
    val action: RemoteRecoveryAction,
    val actionLabel: String?,
    val kind: RemoteActionableKind = RemoteActionableKind.CUSTOM,
)

/** Stable, user-facing recovery state. Never accepts or exposes raw exception text. */
fun remoteActionableState(
    lifecycle: RemoteLifecycleState,
    paused: Boolean = false,
): RemoteActionableState? = when {
    paused -> RemoteActionableState("", "", RemoteRecoveryAction.RESUME_ON_COMPUTER, null,
        RemoteActionableKind.PAUSED)
    lifecycle == RemoteLifecycleState.LOADING ->
        RemoteActionableState("", "", RemoteRecoveryAction.NONE, null, RemoteActionableKind.LOADING)
    lifecycle == RemoteLifecycleState.STALE ->
        RemoteActionableState("", "", RemoteRecoveryAction.RETRY, null, RemoteActionableKind.STALE)
    lifecycle == RemoteLifecycleState.OFFLINE ->
        RemoteActionableState("", "", RemoteRecoveryAction.RETRY, null, RemoteActionableKind.OFFLINE)
    lifecycle == RemoteLifecycleState.AUTH_REQUIRED ->
        RemoteActionableState("", "", RemoteRecoveryAction.SIGN_IN, null, RemoteActionableKind.AUTH_REQUIRED)
    lifecycle == RemoteLifecycleState.REVOKED ->
        RemoteActionableState("", "", RemoteRecoveryAction.REASSOCIATE, null, RemoteActionableKind.REVOKED)
    lifecycle == RemoteLifecycleState.INCOMPATIBLE ->
        RemoteActionableState("", "", RemoteRecoveryAction.UPDATE_APP, null, RemoteActionableKind.INCOMPATIBLE)
    else -> null
}

enum class RemoteFailureMessageKind {
    AUTH_EXPIRED, ACCESS_REVOKED, RUNTIME_PAUSED, PROTOCOL_INCOMPATIBLE, TIMEOUT,
    NETWORK_FAILED, RUNTIME_OFFLINE, TEMPORARILY_UNAVAILABLE, OPERATION_FAILED,
}

fun safeRemoteFailureKind(failure: Throwable): RemoteFailureMessageKind = when {
    failure is RelayHttpException && failure.status == 401 -> RemoteFailureMessageKind.AUTH_EXPIRED
    failure is RelayHttpException && failure.status == 403 -> RemoteFailureMessageKind.ACCESS_REVOKED
    failure is RelayHttpException && failure.errorCode == "runtime_paused" -> RemoteFailureMessageKind.RUNTIME_PAUSED
    failure is RelayHttpException && failure.errorCode == "protocol_incompatible" -> RemoteFailureMessageKind.PROTOCOL_INCOMPATIBLE
    failure is java.net.SocketTimeoutException -> RemoteFailureMessageKind.TIMEOUT
    failure is java.io.IOException -> RemoteFailureMessageKind.NETWORK_FAILED
    else -> RemoteFailureMessageKind.OPERATION_FAILED
}

fun safeRemoteFailureKind(failure: OwopResult.Failure): RemoteFailureMessageKind = when (failure.code) {
    "auth_required", "invalid_token" -> RemoteFailureMessageKind.AUTH_EXPIRED
    "permission_denied", "association_required", "insufficient_scope" -> RemoteFailureMessageKind.ACCESS_REVOKED
    "runtime_paused" -> RemoteFailureMessageKind.RUNTIME_PAUSED
    "runtime_offline", "runtime_owner_unavailable" -> RemoteFailureMessageKind.RUNTIME_OFFLINE
    "timeout", "gateway_timeout" -> RemoteFailureMessageKind.TIMEOUT
    else -> if (failure.retryable) RemoteFailureMessageKind.TEMPORARILY_UNAVAILABLE
        else RemoteFailureMessageKind.OPERATION_FAILED
}

fun remoteRecoveryAction(code: String?, retryable: Boolean = false, status: Int? = null): RemoteRecoveryAction {
    val normalizedCode = code ?: when (status) {
        401 -> "invalid_token"
        403 -> "association_required"
        else -> null
    }
    val transient = retryable || status == 408 || status == 429 || (status ?: 0) >= 500
    return when (RelayContractGenerated.errorAction(normalizedCode, transient)) {
        "retry" -> RemoteRecoveryAction.RETRY
        "login" -> RemoteRecoveryAction.SIGN_IN
        "re-pair" -> RemoteRecoveryAction.REASSOCIATE
        "update" -> RemoteRecoveryAction.UPDATE_APP
        else -> RemoteRecoveryAction.CONTACT_ADMIN
    }
}

/** A single safe CTA derived from the generated cross-client error contract. */
fun remoteActionableFailure(failure: Throwable): RemoteActionableState {
    val action = when (failure) {
        is RelayHttpException -> remoteRecoveryAction(failure.errorCode, failure.retryable, failure.status)
        is java.io.IOException -> RemoteRecoveryAction.RETRY
        else -> RemoteRecoveryAction.CONTACT_ADMIN
    }
    return remoteActionableFailure(action)
}

fun remoteActionableFailure(failure: OwopResult.Failure): RemoteActionableState =
    remoteActionableFailure(remoteRecoveryAction(failure.code, failure.retryable))

private fun remoteActionableFailure(action: RemoteRecoveryAction): RemoteActionableState = when (action) {
    RemoteRecoveryAction.RETRY -> RemoteActionableState("", "", action, null, RemoteActionableKind.RETRY_FAILURE)
    RemoteRecoveryAction.SIGN_IN -> RemoteActionableState("", "", action, null, RemoteActionableKind.SIGN_IN_FAILURE)
    RemoteRecoveryAction.REASSOCIATE -> RemoteActionableState("", "", action, null, RemoteActionableKind.REASSOCIATE_FAILURE)
    RemoteRecoveryAction.UPDATE_APP -> RemoteActionableState("", "", action, null, RemoteActionableKind.UPDATE_FAILURE)
    RemoteRecoveryAction.CONTACT_ADMIN -> RemoteActionableState("", "", action, null, RemoteActionableKind.CONTACT_ADMIN_FAILURE)
    else -> error("remote_error_action_invalid")
}
