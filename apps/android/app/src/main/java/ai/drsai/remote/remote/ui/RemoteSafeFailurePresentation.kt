package ai.drsai.remote.remote.ui

import android.content.Context
import ai.drsai.remote.R
import ai.drsai.remote.remote.data.OwopResult
import ai.drsai.remote.remote.data.RemoteFailureMessageKind
import ai.drsai.remote.remote.data.safeRemoteFailureKind

fun safeRemoteFailureMessage(context: Context, failure: Throwable): String =
    context.getString(safeRemoteFailureResource(safeRemoteFailureKind(failure)))

fun safeRemoteFailureMessage(context: Context, failure: OwopResult.Failure): String =
    context.getString(safeRemoteFailureResource(safeRemoteFailureKind(failure)))

private fun safeRemoteFailureResource(kind: RemoteFailureMessageKind): Int = when (kind) {
    RemoteFailureMessageKind.AUTH_EXPIRED -> R.string.safe_remote_auth_expired
    RemoteFailureMessageKind.ACCESS_REVOKED -> R.string.safe_remote_access_revoked
    RemoteFailureMessageKind.RUNTIME_PAUSED -> R.string.safe_remote_runtime_paused
    RemoteFailureMessageKind.PROTOCOL_INCOMPATIBLE -> R.string.safe_remote_protocol_incompatible
    RemoteFailureMessageKind.TIMEOUT -> R.string.safe_remote_timeout
    RemoteFailureMessageKind.NETWORK_FAILED -> R.string.safe_remote_network_failed
    RemoteFailureMessageKind.RUNTIME_OFFLINE -> R.string.safe_remote_runtime_offline
    RemoteFailureMessageKind.TEMPORARILY_UNAVAILABLE -> R.string.safe_remote_temporarily_unavailable
    RemoteFailureMessageKind.OPERATION_FAILED -> R.string.safe_remote_operation_failed
}
