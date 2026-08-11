package ai.drsai.remote

import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.HaiModelClient
import ai.drsai.remote.data.MIGRATION_1_2
import ai.drsai.remote.data.MIGRATION_2_3
import ai.drsai.remote.data.MIGRATION_3_4
import ai.drsai.remote.data.MIGRATION_4_5
import ai.drsai.remote.data.MIGRATION_5_6
import ai.drsai.remote.data.MIGRATION_6_7
import ai.drsai.remote.data.MIGRATION_7_8
import ai.drsai.remote.data.MIGRATION_8_9
import ai.drsai.remote.data.MIGRATION_9_10
import ai.drsai.remote.data.MIGRATION_10_11
import ai.drsai.remote.data.MIGRATION_11_12
import ai.drsai.remote.data.MIGRATION_12_13
import ai.drsai.remote.data.MIGRATION_13_14
import ai.drsai.remote.data.ModelProviderRepository
import ai.drsai.remote.data.ModelProviderStore
import ai.drsai.remote.data.OidcClient
import ai.drsai.remote.data.RuntimeMessage
import ai.drsai.remote.data.SecureTokenStore
import android.content.Context
import android.util.Log
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Opt-in physical-device proof. Never logs or exports the encrypted API key. */
@RunWith(AndroidJUnit4::class)
class LiveModelToolCallingInstrumentedTest {
    @Test
    fun deepseekV4FlashProducesFiveRealToolCalls(): Unit = runBlocking {
        assumeTrue(
            "live provider acceptance must be explicitly enabled",
            InstrumentationRegistry.getArguments().getString("runLiveProvider") == "true",
        )
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.databaseBuilder(context, ChatDatabase::class.java, "opendrsai.db")
            .addMigrations(
                MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4, MIGRATION_4_5,
                MIGRATION_5_6, MIGRATION_6_7, MIGRATION_7_8, MIGRATION_8_9,
                MIGRATION_9_10, MIGRATION_10_11, MIGRATION_11_12, MIGRATION_12_13,
                MIGRATION_13_14,
            )
            .build()
        try {
            val credentials = ModelProviderStore(context)
            val repository = ModelProviderRepository(
                database.modelProviderDao(), credentials, credentials::providers,
            )
            repository.ensureBuiltIns(BuildConfig.MODEL_BASE_URL)
            val (providers, models) = repository.snapshot()
            val model = models.firstOrNull {
                it.enabled && it.upstreamId.equals(MODEL, ignoreCase = true) && it.providerId != "hepai"
            } ?: error("deepseek-v4-flash_not_configured")
            val provider = providers.first { it.id == model.providerId }
            check(credentials.hasApiKey(provider.id)) { "deepseek-v4-flash_api_key_missing" }
            val client = HaiModelClient(
                SecureTokenStore(context),
                OidcClient(),
                providerStore = repository,
            )
            val calls = mutableListOf<String>()
            repeat(REQUIRED_CALLS) { index ->
                val name = "acceptance_tool_${index + 1}"
                val tools = JSONArray().put(JSONObject()
                    .put("type", "function")
                    .put("function", JSONObject()
                        .put("name", name)
                        .put("description", "Required v1.5.6 Android Full Runtime acceptance tool")
                        .put("parameters", JSONObject()
                            .put("type", "object")
                            .put("properties", JSONObject().put("value", JSONObject().put("type", "integer")))
                            .put("required", JSONArray().put("value")))))
                client.streamCompletionWithTools(
                    model.id,
                    listOf(RuntimeMessage(
                        "user",
                        "Call the only available function $name exactly once with value ${index + 1}. " +
                            "Do not answer with plain text.",
                    )),
                    tools,
                ) { delta -> calls.addAll(delta.toolCalls.mapNotNull { it.name }) }
                assertTrue("provider returned no call for $name", calls.contains(name))
            }
            assertEquals(REQUIRED_CALLS, calls.distinct().size)
            Log.i(MARKER, JSONObject()
                .put("provider", provider.name)
                .put("provider_id", provider.id)
                .put("model", MODEL)
                .put("model_id", model.id)
                .put("status", "passed")
                .put("code", 200)
                .put("tool_calls", calls.size)
                .put("distinct_tools", JSONArray(calls.distinct()))
                .put("passed", calls.size >= REQUIRED_CALLS && calls.distinct().size == REQUIRED_CALLS)
                .toString())
        } finally {
            database.close()
        }
    }

    companion object {
        const val MODEL = "deepseek-v4-flash"
        const val REQUIRED_CALLS = 5
        const val MARKER = "V156_LIVE_PROVIDER_TOOL_CALLING"
    }
}
