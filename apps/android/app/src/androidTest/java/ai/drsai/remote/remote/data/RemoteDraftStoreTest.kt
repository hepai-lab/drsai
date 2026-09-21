package ai.drsai.remote.remote.data

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RemoteDraftStoreTest {
    @Test
    fun encryptedDraftSurvivesRecreationAndIsIsolatedByAccountRuntimeAndSession() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val first = RemoteDraftStore(context)
        val scopes = listOf(
            Triple("account-a", "runtime-a", "session-a"),
            Triple("account-b", "runtime-a", "session-a"),
            Triple("account-a", "runtime-b", "session-a"),
            Triple("account-a", "runtime-a", "session-b"),
        )
        scopes.forEach { (subject, runtime, session) -> first.clear(subject, runtime, session) }

        first.write("account-a", "runtime-a", "session-a", "unfinished message")
        val recreated = RemoteDraftStore(context)

        assertEquals("unfinished message", recreated.read("account-a", "runtime-a", "session-a"))
        assertEquals("", recreated.read("account-b", "runtime-a", "session-a"))
        assertEquals("", recreated.read("account-a", "runtime-b", "session-a"))
        assertEquals("", recreated.read("account-a", "runtime-a", "session-b"))
        assertNotEquals(
            recreated.scopeKey("account-a", "runtime-a", "session-a"),
            recreated.scopeKey("account-b", "runtime-a", "session-a"),
        )

        repeat(100) { index ->
            first.write("account-a", "runtime-a", "session-$index", "draft-$index")
        }
        val switched = RemoteDraftStore(context)
        repeat(100) { index ->
            assertEquals("draft-$index", switched.read("account-a", "runtime-a", "session-$index"))
            switched.clear("account-a", "runtime-a", "session-$index")
        }

        recreated.clear("account-a", "runtime-a", "session-a")
        assertEquals("", RemoteDraftStore(context).read("account-a", "runtime-a", "session-a"))
    }
}
