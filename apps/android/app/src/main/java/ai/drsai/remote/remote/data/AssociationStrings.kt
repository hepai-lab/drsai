package ai.drsai.remote.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class AssociationText {
    ENVIRONMENT_MISMATCH,
    INVALID_CODE,
    EXPIRED_CODE,
    CONSUMED_CODE,
    REVOKED_CODE,
    LOGIN_EXPIRED,
    RATE_LIMITED,
    NETWORK_FAILED,
    FAILED,
}

fun interface AssociationStrings {
    fun text(key: AssociationText): String
}

class AndroidAssociationStrings(private val context: Context) : AssociationStrings {
    override fun text(key: AssociationText): String = context.getString(
        when (key) {
            AssociationText.ENVIRONMENT_MISMATCH -> R.string.association_environment_mismatch
            AssociationText.INVALID_CODE -> R.string.association_invalid_code
            AssociationText.EXPIRED_CODE -> R.string.association_expired_code
            AssociationText.CONSUMED_CODE -> R.string.association_consumed_code
            AssociationText.REVOKED_CODE -> R.string.association_revoked_code
            AssociationText.LOGIN_EXPIRED -> R.string.association_login_expired
            AssociationText.RATE_LIMITED -> R.string.association_rate_limited
            AssociationText.NETWORK_FAILED -> R.string.association_network_failed
            AssociationText.FAILED -> R.string.association_failed
        },
    )
}

object EnglishAssociationStrings : AssociationStrings {
    override fun text(key: AssociationText): String = when (key) {
        AssociationText.ENVIRONMENT_MISMATCH -> "This QR code belongs to a different environment"
        AssociationText.INVALID_CODE -> "Invalid QR code. Refresh it on the computer and try again"
        AssociationText.EXPIRED_CODE -> "The QR code expired. Refresh it on the computer and try again"
        AssociationText.CONSUMED_CODE -> "The QR code was already used. Refresh it on the computer and try again"
        AssociationText.REVOKED_CODE -> "The QR code was revoked. Refresh it on the computer and try again"
        AssociationText.LOGIN_EXPIRED -> "Your HepAI sign-in expired. Sign in again"
        AssociationText.RATE_LIMITED -> "Too many attempts. Try again later"
        AssociationText.NETWORK_FAILED -> "Network connection failed. Check your connection and try again"
        AssociationText.FAILED -> "Could not connect the computer. Try again"
    }
}
