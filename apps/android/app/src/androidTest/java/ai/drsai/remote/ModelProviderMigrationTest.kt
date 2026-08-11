package ai.drsai.remote

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.MIGRATION_13_14
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ModelProviderMigrationTest {
    @Test fun migration13To14CreatesProviderSchemaIndexesAndCascade() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val name = "model-provider-migration-${System.nanoTime()}.db"
        open(context, name, 13) { _, _, _ -> }.close()
        val helper = open(context, name, 14) { db, old, new ->
            assertEquals(13, old)
            assertEquals(14, new)
            MIGRATION_13_14.migrate(db)
        }
        val db = helper.writableDatabase

        assertTrue(tableExists(db, "model_providers"))
        assertTrue(tableExists(db, "provider_models"))
        assertTrue(indexExists(db, "index_provider_models_providerId"))
        assertTrue(indexExists(db, "index_provider_models_providerId_upstreamId"))
        db.execSQL("PRAGMA foreign_keys=ON")
        db.execSQL("INSERT INTO model_providers VALUES ('p',NULL,'Provider','https://example.com/v1','openai',0,1,1,1,1)")
        db.execSQL("INSERT INTO provider_models VALUES ('m','p','upstream','Model',0,0,0,NULL,NULL,1,'MANUAL',0)")
        db.execSQL("DELETE FROM model_providers WHERE id='p'")
        db.query("SELECT COUNT(*) FROM provider_models WHERE providerId='p'").use { cursor ->
            cursor.moveToFirst()
            assertEquals(0, cursor.getInt(0))
        }
        helper.close()
        context.deleteDatabase(name)
    }

    private fun open(
        context: Context,
        name: String,
        version: Int,
        upgrade: (SupportSQLiteDatabase, Int, Int) -> Unit,
    ): SupportSQLiteOpenHelper = FrameworkSQLiteOpenHelperFactory().create(
        SupportSQLiteOpenHelper.Configuration.builder(context)
            .name(name)
            .callback(object : SupportSQLiteOpenHelper.Callback(version) {
                override fun onCreate(db: SupportSQLiteDatabase) = Unit
                override fun onUpgrade(db: SupportSQLiteDatabase, oldVersion: Int, newVersion: Int) =
                    upgrade(db, oldVersion, newVersion)
            }).build(),
    ).also { it.writableDatabase }

    private fun tableExists(db: SupportSQLiteDatabase, name: String) = exists(db, "table", name)
    private fun indexExists(db: SupportSQLiteDatabase, name: String) = exists(db, "index", name)
    private fun exists(db: SupportSQLiteDatabase, type: String, name: String): Boolean =
        db.query("SELECT 1 FROM sqlite_master WHERE type=? AND name=?", arrayOf(type, name)).use { it.moveToFirst() }
}
