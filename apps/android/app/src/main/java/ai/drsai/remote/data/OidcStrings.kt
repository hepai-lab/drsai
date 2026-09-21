package ai.drsai.remote.data

import ai.drsai.remote.R
import android.content.Context

enum class OidcText {
    REQUEST_EXPIRED, CALLBACK_MISMATCH, STATE_INVALID, CODE_MISSING, CALLBACK_PENDING,
    LOGIN_CANCELLED, TOKEN_REQUEST_FAILED, TOKEN_INCOMPLETE, NONCE_INVALID, SUBJECT_MISSING,
    REFRESH_MISSING, ISSUER_INVALID, AUDIENCE_INVALID, TOKEN_EXPIRED, JWT_INVALID,
    RS256_REQUIRED, SIGNING_KEY_MISSING, SIGNATURE_INVALID, CONFIG_LOAD_FAILED, JWKS_LOAD_FAILED,
}

interface OidcStrings { fun text(key: OidcText): String }

class AndroidOidcStrings(private val context: Context) : OidcStrings {
    override fun text(key: OidcText): String = context.getString(when (key) {
        OidcText.REQUEST_EXPIRED -> R.string.oidc_request_expired
        OidcText.CALLBACK_MISMATCH -> R.string.oidc_callback_mismatch
        OidcText.STATE_INVALID -> R.string.oidc_state_invalid
        OidcText.CODE_MISSING -> R.string.oidc_code_missing
        OidcText.CALLBACK_PENDING -> R.string.oidc_callback_pending
        OidcText.LOGIN_CANCELLED -> R.string.login_cancelled
        OidcText.TOKEN_REQUEST_FAILED -> R.string.oidc_token_request_failed
        OidcText.TOKEN_INCOMPLETE -> R.string.oidc_token_incomplete
        OidcText.NONCE_INVALID -> R.string.oidc_nonce_invalid
        OidcText.SUBJECT_MISSING -> R.string.oidc_subject_missing
        OidcText.REFRESH_MISSING -> R.string.oidc_refresh_missing
        OidcText.ISSUER_INVALID -> R.string.oidc_issuer_invalid
        OidcText.AUDIENCE_INVALID -> R.string.oidc_audience_invalid
        OidcText.TOKEN_EXPIRED -> R.string.oidc_token_expired
        OidcText.JWT_INVALID -> R.string.oidc_jwt_invalid
        OidcText.RS256_REQUIRED -> R.string.oidc_rs256_required
        OidcText.SIGNING_KEY_MISSING -> R.string.oidc_signing_key_missing
        OidcText.SIGNATURE_INVALID -> R.string.oidc_signature_invalid
        OidcText.CONFIG_LOAD_FAILED -> R.string.oidc_config_load_failed
        OidcText.JWKS_LOAD_FAILED -> R.string.oidc_jwks_load_failed
    })
}

object EnglishOidcStrings : OidcStrings {
    override fun text(key: OidcText): String = when (key) {
        OidcText.REQUEST_EXPIRED -> "The sign-in request expired; sign in again"
        OidcText.CALLBACK_MISMATCH -> "The sign-in callback address does not match"
        OidcText.STATE_INVALID -> "Sign-in state verification failed"
        OidcText.CODE_MISSING -> "The sign-in callback is missing an authorization code"
        OidcText.CALLBACK_PENDING -> "The native sign-in callback has not returned"
        OidcText.LOGIN_CANCELLED -> "Sign-in cancelled"
        OidcText.TOKEN_REQUEST_FAILED -> "OIDC token request failed"
        OidcText.TOKEN_INCOMPLETE -> "The OIDC token response is incomplete"
        OidcText.NONCE_INVALID -> "OIDC nonce verification failed"
        OidcText.SUBJECT_MISSING -> "The OIDC token is missing a user identifier"
        OidcText.REFRESH_MISSING -> "OIDC did not return a refresh token"
        OidcText.ISSUER_INVALID -> "OIDC issuer verification failed"
        OidcText.AUDIENCE_INVALID -> "OIDC audience verification failed"
        OidcText.TOKEN_EXPIRED -> "The OIDC token expired"
        OidcText.JWT_INVALID -> "OIDC returned an invalid JWT"
        OidcText.RS256_REQUIRED -> "The OIDC token must use RS256"
        OidcText.SIGNING_KEY_MISSING -> "Could not find the OIDC signing key"
        OidcText.SIGNATURE_INVALID -> "OIDC token signature verification failed"
        OidcText.CONFIG_LOAD_FAILED -> "Could not load HAI OIDC configuration"
        OidcText.JWKS_LOAD_FAILED -> "Could not load HAI OIDC signing keys"
    }
}
