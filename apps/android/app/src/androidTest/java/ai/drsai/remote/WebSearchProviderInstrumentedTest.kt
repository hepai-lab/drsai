package ai.drsai.remote

import ai.drsai.remote.runtime.tools.defaultAndroidWebSearchProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4

@RunWith(AndroidJUnit4::class)
class WebSearchProviderInstrumentedTest {
    @Test fun realProviderReturnsNormalizedHttpsSourcesForEnglishAndChinese() {
        runBlocking {
            val provider = defaultAndroidWebSearchProvider()
            listOf("Android operating system", "人工智能").forEach { query ->
                val response = provider.search(query, 3)
                assertEquals("provider=$query error=${response.errorCode}", "ok", response.status)
                assertEquals(query, response.query)
                assertTrue(response.provider in setOf("bing-web", "wikipedia-mediawiki"))
                assertTrue(response.items.isNotEmpty())
                assertTrue(response.items.all { it.title.isNotBlank() && it.url.startsWith("https://") })
            }
        }
    }
}
