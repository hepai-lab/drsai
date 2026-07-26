package ai.drsai.remote

import android.content.Intent
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AssociationIntentFilterTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test fun onlyAssociationHostResolvesForOpenDrSaiScheme() {
        fun matches(uri: String) = context.packageManager.queryIntentActivities(
            Intent(Intent.ACTION_VIEW, Uri.parse(uri)).addCategory(Intent.CATEGORY_BROWSABLE),
            0,
        ).filter { it.activityInfo.packageName == context.packageName }

        assertEquals(1, matches("opendrsai://associate?v=1").size)
        assertTrue(matches("opendrsai://oauth2redirect").isEmpty())
        assertTrue(matches("opendrsai://evil.example/associate").isEmpty())
    }
}
