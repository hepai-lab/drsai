package ai.drsai.remote

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.ModelProviderStore
import ai.drsai.remote.data.SecureTokenStore
import android.util.Log
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ModelProviderRuntimeDiagnosticTest {
    @Test fun printNonSensitiveRuntimeConfiguration() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val selectedModelId = SecureTokenStore(context).selectedModelId
        val credentialStore = ModelProviderStore(context)
        credentialStore.providers().forEach { provider ->
            Log.i(
                TAG,
                "LEGACY_MODEL_PROVIDER_DIAGNOSTIC providerId=${provider.id} name=${provider.name} " +
                    "baseUrl=${provider.baseUrl} hasKey=${credentialStore.hasApiKey(provider.id)} " +
                    "models=${provider.modelIds.joinToString(",")}",
            )
        }
        val databaseFile = context.getDatabasePath("opendrsai.db")
        if (!databaseFile.exists()) {
            Log.i(TAG, "MODEL_PROVIDER_DIAGNOSTIC database=not_initialized")
            return
        }
        val database = android.database.sqlite.SQLiteDatabase.openDatabase(
            databaseFile.absolutePath,
            null,
            android.database.sqlite.SQLiteDatabase.OPEN_READONLY,
        )
        database.use { db ->
            db.rawQuery(
                "SELECT id, modelId, updatedAt FROM conversations ORDER BY updatedAt DESC LIMIT 1",
                null,
            ).use { cursor ->
                if (cursor.moveToFirst()) {
                    Log.i(TAG, "CONVERSATION_MODEL_DIAGNOSTIC id=${cursor.getString(0)} modelId=${cursor.getString(1)} updatedAt=${cursor.getLong(2)}")
                }
            }
            db.rawQuery(
                """
                SELECT p.id, p.displayName, p.baseUrl, p.wireApi,
                       m.id, m.upstreamId, m.displayName, m.enabled
                FROM model_providers p
                LEFT JOIN provider_models m ON m.providerId = p.id
                ORDER BY p.createdAt, m.sortOrder
                """.trimIndent(),
                null,
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    val providerId = cursor.getString(0)
                    val modelId = cursor.getString(4)
                    Log.i(
                        TAG,
                        "MODEL_PROVIDER_DIAGNOSTIC " +
                            "providerId=$providerId name=${cursor.getString(1)} baseUrl=${cursor.getString(2)} " +
                            "wireApi=${cursor.getString(3)} hasKey=${credentialStore.hasApiKey(providerId)} " +
                            "modelId=$modelId upstreamId=${cursor.getString(5)} modelName=${cursor.getString(6)} " +
                            "enabled=${cursor.getInt(7) != 0} selected=${modelId == selectedModelId}",
                    )
                }
            }
        }
    }

    private companion object {
        const val TAG = "ModelProviderDiagnostic"
    }
}
