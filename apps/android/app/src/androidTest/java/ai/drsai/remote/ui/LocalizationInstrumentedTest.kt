package ai.drsai.remote.ui

import android.content.Context
import android.content.res.Configuration
import android.os.LocaleList
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import ai.drsai.remote.R
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalizationInstrumentedTest {
    private val base: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun coreJourneyHasCompleteChineseAndEnglishResources() {
        val zh = localized("zh-CN")
        val en = localized("en-US")
        val required = listOf(
            R.string.new_conversation,
            R.string.open_navigation,
            R.string.add_attachment,
            R.string.send_message,
            R.string.stop_run,
            R.string.results_title,
            R.string.empty_no_sessions_title,
            R.string.empty_no_results_title,
            R.string.empty_offline_title,
            R.string.empty_no_model_title,
            R.string.empty_capability_title,
        )

        required.forEach { id ->
            val chinese = zh.getString(id)
            val english = en.getString(id)
            assertFalse(chinese.isBlank())
            assertFalse(english.isBlank())
            assertNotEquals("Resource $id fell back instead of being translated", chinese, english)
            assertFalse("Resource key leaked to UI", english.contains("empty_"))
        }
        assertEquals("1 model", en.resources.getQuantityString(R.plurals.model_count, 1, 1))
        assertEquals("2 models", en.resources.getQuantityString(R.plurals.model_count, 2, 2))
        assertEquals("2 个模型", zh.resources.getQuantityString(R.plurals.model_count, 2, 2))
    }

    @Test
    fun rtlAndLongCopyFixturesPreserveDirectionAndContent() {
        val arabic = localized("ar")
        val english = localized("en-US")
        assertEquals(Configuration.SCREENLAYOUT_LAYOUTDIR_RTL, arabic.resources.configuration.screenLayout and Configuration.SCREENLAYOUT_LAYOUTDIR_MASK)
        val longCopy = english.getString(R.string.empty_no_results_detail).repeat(8)
        assertTrue(longCopy.length > 400)
        assertFalse(longCopy.contains("empty_no_results_detail"))
    }

    private fun localized(languageTag: String): Context {
        val configuration = Configuration(base.resources.configuration)
        configuration.setLocales(LocaleList.forLanguageTags(languageTag))
        configuration.setLayoutDirection(Locale.forLanguageTag(languageTag))
        return base.createConfigurationContext(configuration)
    }
}
