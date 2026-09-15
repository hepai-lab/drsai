package ai.drsai.remote.ui

import org.junit.Assert.*
import org.junit.Test
import java.util.Locale
import java.util.TimeZone

class LocalizedFormattingTest {
    @Test fun zh_en_numbers_sizes_and_timezones_are_locale_aware() {
        assertEquals("1.5 KB", LocalizedFormatting.bytes(1536, Locale.US))
        assertEquals("1.5 KB", LocalizedFormatting.bytes(1536, Locale.SIMPLIFIED_CHINESE))
        assertEquals("1,234", LocalizedFormatting.count(1234, Locale.US))
        assertTrue(LocalizedFormatting.dateTime(0, Locale.US, TimeZone.getTimeZone("UTC")).contains("1970"))
        val shanghai = LocalizedFormatting.dateTime(0, Locale.SIMPLIFIED_CHINESE, TimeZone.getTimeZone("Asia/Shanghai"))
        assertTrue(shanghai.contains("1970"))
    }

    @Test fun rtl_locale_uses_its_own_number_format_without_corrupting_content() {
        val arabic = LocalizedFormatting.count(1234, Locale.forLanguageTag("ar"))
        assertTrue(arabic.isNotBlank())
        assertNotEquals("1234", arabic)
    }
}
