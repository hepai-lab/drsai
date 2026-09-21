package ai.drsai.remote

import ai.drsai.remote.remote.data.*
import org.junit.Assert.*
import org.junit.Test

class WebSearchContractTest {
    @Test fun `managed web search identity and callable set are frozen`() {
        assertEquals("opendrsai.web-search/1", WEB_SEARCH_CONTRACT_SCHEMA)
        assertEquals("hepai/tavily-web-search-v1", MANAGED_WEB_SEARCH_MODEL)
        assertEquals(listOf("search", "extract"), WEB_SEARCH_FUNCTIONS)
        assertEquals(listOf("auto", "managed", "byok", "none"), WEB_SEARCH_PROVIDER_MODES)
    }

    @Test fun `public error matrix keeps provider and platform failures distinct`() {
        assertEquals(13, WEB_SEARCH_RECOVERY.size)
        assertEquals(WebSearchRecovery(false, WebSearchRecoveryAction.ACCOUNT_OR_BYOK), webSearchRecovery("quota_exhausted"))
        assertEquals(WebSearchRecovery(false, WebSearchRecoveryAction.CONTACT_ADMIN), webSearchRecovery("provider_quota_exhausted"))
        assertEquals(WebSearchRecovery(true, WebSearchRecoveryAction.RETRY), webSearchRecovery("provider_timeout"))
        assertEquals(WebSearchRecovery(false, WebSearchRecoveryAction.CHANGE_URL), webSearchRecovery("unsafe_web_url"))
        assertNull(webSearchRecovery("private_internal_error"))
    }
}
