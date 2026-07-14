package ai.drsai.remote

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ai.drsai.remote.data.ApiException
import ai.drsai.remote.data.OIDC_AUTH_TIMEOUT_MS
import ai.drsai.remote.data.OIDC_NATIVE_REDIRECT_URI
import ai.drsai.remote.data.OidcLoginTransaction
import ai.drsai.remote.data.OidcTransactionStore
import ai.drsai.remote.data.validateAuthorizationCallback
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OidcRedirectTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val store get() = OidcTransactionStore(context)

    @Before fun clearBefore() = store.clear()
    @After fun clearAfter() = store.clear()

    @Test
    fun nativeTransactionSurvivesStoreRecreation() {
        val transaction = transaction(createdAt = 123_456L)
        store.save(transaction)

        assertEquals(transaction, OidcTransactionStore(context).load())
        store.clear()
        assertNull(OidcTransactionStore(context).load())
    }

    @Test
    fun callbackIsBoundToRedirectStateAndLifetime() {
        val now = 2_000_000L
        val transaction = transaction(createdAt = now)
        val valid = Uri.parse("$OIDC_NATIVE_REDIRECT_URI?code=code-a&state=state-a")
        assertEquals("code-a", validateAuthorizationCallback(valid, transaction, now))

        val wrongState = Uri.parse("$OIDC_NATIVE_REDIRECT_URI?code=code-a&state=state-b")
        assertThrows(ApiException::class.java) {
            validateAuthorizationCallback(wrongState, transaction, now)
        }

        val wrongRedirect = Uri.parse("other.scheme:/oauth2redirect?code=code-a&state=state-a")
        assertThrows(ApiException::class.java) {
            validateAuthorizationCallback(wrongRedirect, transaction, now)
        }

        val expired = transaction(createdAt = now - OIDC_AUTH_TIMEOUT_MS - 1)
        assertThrows(ApiException::class.java) {
            validateAuthorizationCallback(valid, expired, now)
        }
    }

    private fun transaction(createdAt: Long) = OidcLoginTransaction(
        clientId = "opendrsai-android",
        redirectUri = OIDC_NATIVE_REDIRECT_URI,
        verifier = "verifier-a",
        state = "state-a",
        nonce = "nonce-a",
        createdAt = createdAt,
    )
}
