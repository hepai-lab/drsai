package ai.drsai.remote

import ai.drsai.remote.data.AuthTokens
import ai.drsai.remote.data.SecureTokenStore
import ai.drsai.remote.data.User
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

/** Test-only bridge used by the autonomous old-APK -> new-APK update acceptance. */
@RunWith(AndroidJUnit4::class)
class UpdateAcceptanceSeedTest {
    @Test
    fun seedAuthenticatedProfileWithoutProductionCredentials() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = SecureTokenStore(context)
        store.save(
            AuthTokens(
                accessToken = "stage5-update-acceptance-token",
                refreshToken = "stage5-update-acceptance-refresh-token",
                user = User("stage5-update-acceptance", "Stage 5 Update Acceptance", null),
            ),
        )
        store.oidcClientId = "stage5-update-acceptance"

        assertEquals("stage5-update-acceptance", store.user()?.id)
        assertNotNull(store.accessToken)
    }
}
