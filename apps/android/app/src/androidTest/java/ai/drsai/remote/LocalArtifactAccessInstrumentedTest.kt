package ai.drsai.remote

import android.content.Context
import android.content.Intent
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.data.ChatDatabase
import ai.drsai.remote.data.LocalArtifactMaterializer
import ai.drsai.remote.data.ToolArtifactEntity
import ai.drsai.remote.data.localArtifactIntent
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalArtifactAccessInstrumentedTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val database = Room.inMemoryDatabaseBuilder(context, ChatDatabase::class.java)
        .allowMainThreadQueries().build()

    @After fun close() = database.close()

    @Test fun materializedToolArtifactSurvivesAdapterRecreationAndSharesOnlyAReadOnlyContentUri() = runBlocking {
        val content = "artifact content 你好"
        database.dao().saveToolArtifact(ToolArtifactEntity(
            "artifact-1", "alice", "run-1", "session-1", "call-1", "workspace.read", content, 1,
        ))
        val first = LocalArtifactMaterializer(context, database.dao()).prepare("alice", "artifact-1", "tool")
        val recovered = LocalArtifactMaterializer(context, database.dao()).prepare("alice", "artifact-1", "tool")
        assertEquals(first.sha256, recovered.sha256)
        assertEquals(content.encodeToByteArray().size.toLong(), recovered.size)

        val share = localArtifactIntent(context, recovered, share = true)
        val uri = requireNotNull(share.getParcelableExtra(Intent.EXTRA_STREAM, android.net.Uri::class.java))
        assertEquals("content", uri.scheme)
        assertFalse(uri.toString().contains(context.cacheDir.absolutePath))
        assertTrue(share.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertFalse(share.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0)
        assertEquals(content, context.contentResolver.openInputStream(uri)!!.bufferedReader().use { it.readText() })
    }

    @Test fun accountScopeIsCheckedBeforeArtifactMaterialization() = runBlocking {
        database.dao().saveToolArtifact(ToolArtifactEntity(
            "artifact-private", "alice", "run-1", "session-1", "call-1", "workspace.read", "private", 1,
        ))
        val failure = runCatching {
            LocalArtifactMaterializer(context, database.dao()).prepare("bob", "artifact-private", "tool")
        }.exceptionOrNull()
        assertEquals("artifact_not_found", failure?.message)
    }
}
