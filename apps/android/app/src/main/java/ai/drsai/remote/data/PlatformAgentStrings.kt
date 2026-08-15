package ai.drsai.remote.data

import android.content.Context
import ai.drsai.remote.R

enum class PlatformAgentText {
    SIGN_IN_FIRST, INVALID_CATALOG, CATALOG_CONNECTED, LOGIN_EXPIRED, CANNOT_CONNECT,
    CATALOG_CACHED, CATALOG_LOAD_FAILED, INVALID_STREAM_RESPONSE, EMPTY_RESPONSE,
    STREAM_INTERRUPTED, NO_DISPLAY_CONTENT, RUN_FAILED, CONNECTION_INTERRUPTED,
    INVALID_STREAM_DATA, STREAM_ERROR, ACCESS_FORBIDDEN, AGENT_NOT_FOUND,
    CHAT_UNSUPPORTED, CREDENTIALS_UNAVAILABLE, CREDENTIALS_INVALID, QUOTA_EXCEEDED,
    CATALOG_UNAVAILABLE, PLATFORM_ACCESS_FORBIDDEN, API_UNAVAILABLE, REQUEST_LIMITED,
    SERVICE_UNAVAILABLE, HTTP_REQUEST_FAILED,
}

interface PlatformAgentStrings {
    fun text(key: PlatformAgentText, vararg arguments: Any): String
}

class AndroidPlatformAgentStrings(private val context: Context) : PlatformAgentStrings {
    override fun text(key: PlatformAgentText, vararg arguments: Any): String =
        context.getString(resource(key), *arguments)

    private fun resource(key: PlatformAgentText): Int = when (key) {
        PlatformAgentText.SIGN_IN_FIRST -> R.string.platform_sign_in_first
        PlatformAgentText.INVALID_CATALOG -> R.string.platform_invalid_catalog
        PlatformAgentText.CATALOG_CONNECTED -> R.string.platform_catalog_connected
        PlatformAgentText.LOGIN_EXPIRED -> R.string.platform_login_expired
        PlatformAgentText.CANNOT_CONNECT -> R.string.platform_cannot_connect
        PlatformAgentText.CATALOG_CACHED -> R.string.platform_catalog_cached
        PlatformAgentText.CATALOG_LOAD_FAILED -> R.string.platform_catalog_load_failed
        PlatformAgentText.INVALID_STREAM_RESPONSE -> R.string.platform_invalid_stream_response
        PlatformAgentText.EMPTY_RESPONSE -> R.string.platform_empty_response
        PlatformAgentText.STREAM_INTERRUPTED -> R.string.platform_stream_interrupted
        PlatformAgentText.NO_DISPLAY_CONTENT -> R.string.platform_no_display_content
        PlatformAgentText.RUN_FAILED -> R.string.platform_run_failed
        PlatformAgentText.CONNECTION_INTERRUPTED -> R.string.platform_connection_interrupted
        PlatformAgentText.INVALID_STREAM_DATA -> R.string.platform_invalid_stream_data
        PlatformAgentText.STREAM_ERROR -> R.string.platform_stream_error
        PlatformAgentText.ACCESS_FORBIDDEN -> R.string.platform_agent_access_forbidden
        PlatformAgentText.AGENT_NOT_FOUND -> R.string.platform_agent_not_found
        PlatformAgentText.CHAT_UNSUPPORTED -> R.string.platform_chat_unsupported
        PlatformAgentText.CREDENTIALS_UNAVAILABLE -> R.string.platform_credentials_unavailable
        PlatformAgentText.CREDENTIALS_INVALID -> R.string.platform_credentials_invalid
        PlatformAgentText.QUOTA_EXCEEDED -> R.string.platform_quota_exceeded
        PlatformAgentText.CATALOG_UNAVAILABLE -> R.string.platform_catalog_unavailable
        PlatformAgentText.PLATFORM_ACCESS_FORBIDDEN -> R.string.platform_access_forbidden
        PlatformAgentText.API_UNAVAILABLE -> R.string.platform_api_unavailable
        PlatformAgentText.REQUEST_LIMITED -> R.string.platform_request_limited
        PlatformAgentText.SERVICE_UNAVAILABLE -> R.string.platform_service_unavailable
        PlatformAgentText.HTTP_REQUEST_FAILED -> R.string.platform_http_request_failed
    }
}

object EnglishPlatformAgentStrings : PlatformAgentStrings {
    override fun text(key: PlatformAgentText, vararg arguments: Any): String = when (key) {
        PlatformAgentText.SIGN_IN_FIRST -> "Sign in first"
        PlatformAgentText.INVALID_CATALOG -> "The platform agent catalog returned invalid data"
        PlatformAgentText.CATALOG_CONNECTED -> "Connected to HAI platform agents"
        PlatformAgentText.LOGIN_EXPIRED -> "Your HAI sign-in expired; sign in again"
        PlatformAgentText.CANNOT_CONNECT -> "Cannot connect to the HAI platform"
        PlatformAgentText.CATALOG_CACHED -> "The platform is unavailable; showing the last synced agents"
        PlatformAgentText.CATALOG_LOAD_FAILED -> "Could not load platform agents"
        PlatformAgentText.INVALID_STREAM_RESPONSE -> "The platform agent returned an invalid streaming response"
        PlatformAgentText.EMPTY_RESPONSE -> "The platform agent response is empty"
        PlatformAgentText.STREAM_INTERRUPTED -> "The platform agent stream ended before completion"
        PlatformAgentText.NO_DISPLAY_CONTENT -> "The platform agent returned no displayable content"
        PlatformAgentText.RUN_FAILED -> "Platform agent run failed"
        PlatformAgentText.CONNECTION_INTERRUPTED -> "The platform agent connection was interrupted"
        PlatformAgentText.INVALID_STREAM_DATA -> "The platform agent returned invalid stream data"
        PlatformAgentText.STREAM_ERROR -> "The platform agent stream returned an error"
        PlatformAgentText.ACCESS_FORBIDDEN -> "This account cannot use the selected agent"
        PlatformAgentText.AGENT_NOT_FOUND -> "The selected agent is unavailable; refresh the list"
        PlatformAgentText.CHAT_UNSUPPORTED -> "This agent does not support Android chat"
        PlatformAgentText.CREDENTIALS_UNAVAILABLE -> "The platform has not prepared runtime credentials for this agent"
        PlatformAgentText.CREDENTIALS_INVALID -> "The platform agent credentials are invalid; contact an administrator"
        PlatformAgentText.QUOTA_EXCEEDED -> "Agent quota exhausted; try again later"
        PlatformAgentText.CATALOG_UNAVAILABLE -> "The HAI agent catalog is temporarily unavailable"
        PlatformAgentText.PLATFORM_ACCESS_FORBIDDEN -> "This account cannot use platform agents"
        PlatformAgentText.API_UNAVAILABLE -> "The platform agent API is unavailable"
        PlatformAgentText.REQUEST_LIMITED -> "Requests are too frequent or quota is insufficient"
        PlatformAgentText.SERVICE_UNAVAILABLE -> "The HAI platform agent service is temporarily unavailable"
        PlatformAgentText.HTTP_REQUEST_FAILED -> "Platform agent request failed (HTTP ${arguments.firstOrNull()})"
    }
}
