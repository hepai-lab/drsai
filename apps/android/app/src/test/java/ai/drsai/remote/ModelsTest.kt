package ai.drsai.remote

import ai.drsai.remote.data.*
import org.junit.Assert.*
import org.junit.Test

class ModelsTest {
    @Test fun legacy_null_prefix_is_removed_only_from_assistant_messages() {
        assertEquals("Hello", sanitizeLegacyAssistantText("assistant", "nullnullnullHello"))
        assertEquals("nullnullHello", sanitizeLegacyAssistantText("user", "nullnullHello"))
        assertEquals("null value", sanitizeLegacyAssistantText("assistant", "null value"))
    }

    @Test fun app_starts_at_splash_without_a_user() {
        val state=AppState()
        assertEquals(AppDestination.Splash,state.destination)
        assertNull(state.user)
        assertFalse(state.streaming)
    }

    @Test fun conversation_and_messages_keep_local_identity() {
        val conversation=Conversation("local-42","测试会话",agentId="coder")
        val message=ChatMessage("m1",conversation.id,"user","你好")
        assertEquals("local-42",message.conversationId)
        assertEquals("coder",conversation.agentId)
    }

    @Test fun sse_parser_handles_fragmented_events_and_done() {
        val parser = SseParser()
        assertTrue(parser.feed("data: {\"choices\":[").isEmpty())
        val events = parser.feed("]}\n\ndata: [DONE]\n\n")
        assertEquals(listOf("{\"choices\":[]}", "[DONE]"), events)
    }

    @Test fun model_selection_prefers_deepseek_v4_pro_and_falls_back() {
        val fallback=ModelInfo("fallback")
        val preferred=ModelInfo("deepseek-ai/deepseek-v4-pro")
        assertEquals(preferred, selectPreferredModel(listOf(fallback, preferred)))
        assertEquals(fallback, selectPreferredModel(listOf(fallback)))
    }

    @Test fun oidc_configuration_supports_native_and_legacy_redirects() {
        assertEquals(BuildConfig.OIDC_ISSUER, OIDC_ISSUER)
        assertEquals("${BuildConfig.HAI_BASE_URL}/apiv2/v1", BuildConfig.MODEL_BASE_URL)
        assertEquals("opendrsai-android", BuildConfig.OIDC_CLIENT_ID)
        assertEquals(OIDC_NATIVE_REDIRECT_URI, BuildConfig.OIDC_REDIRECT_URI)
        assertEquals("opendrsai://oauth2redirect", OIDC_APP_RETURN_URI)
        assertEquals("ai.drsai.remote:/oauth2redirect", OIDC_NATIVE_REDIRECT_URI)
        assertFalse(OidcConfiguration("opendrsai-desktop").usesNativeRedirect)
        assertTrue(OidcConfiguration("opendrsai-android", OIDC_NATIVE_REDIRECT_URI).usesNativeRedirect)
        assertTrue(OIDC_SCOPE.contains("hai_api"))
        assertTrue(OIDC_SCOPE.contains("offline_access"))
    }
}
