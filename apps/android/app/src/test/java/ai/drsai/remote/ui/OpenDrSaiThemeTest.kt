package ai.drsai.remote.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenDrSaiThemeTest {
    @Test
    fun lightThemeTracksDesktopSemanticTokens() {
        with(OpenDrSaiLightColorScheme) {
            assertEquals(Color(0xFF8B5CF6), primary)
            assertEquals(Color(0xFFFAFAFE), background)
            assertEquals(Color(0xFFFFFFFF), surface)
            assertEquals(Color(0xFF202733), onSurface)
            assertEquals(Color(0xFF4A5260), onSurfaceVariant)
            assertEquals(Color(0xFFEEF2F6), surfaceVariant)
            assertEquals(Color(0xFFE6EBF1), secondaryContainer)
            assertEquals(Color(0xFFD6DCE5), outline)
            assertEquals(Color(0xFFB4234A), error)
            assertEquals(Color.Transparent, surfaceTint)
        }
    }

    @Test
    fun darkThemeTracksDesktopSemanticTokens() {
        with(OpenDrSaiDarkColorScheme) {
            assertEquals(Color(0xFFC4B5FD), primary)
            assertEquals(Color(0xFF17151C), background)
            assertEquals(Color(0xFF211E27), surface)
            assertEquals(Color(0xFFF0EBF5), onSurface)
            assertEquals(Color(0xFFC0B7CB), onSurfaceVariant)
            assertEquals(Color(0xFF3C3547), outline)
            assertEquals(Color(0xFF3A202B), errorContainer)
            assertEquals(Color.Transparent, surfaceTint)
        }
    }

    @Test
    fun bodyTextPairsMeetAccessibleContrast() {
        listOf(
            OpenDrSaiLightColorScheme.onSurface to OpenDrSaiLightColorScheme.surface,
            OpenDrSaiLightColorScheme.onBackground to OpenDrSaiLightColorScheme.background,
            OpenDrSaiDarkColorScheme.onPrimary to OpenDrSaiDarkColorScheme.primary,
            OpenDrSaiDarkColorScheme.onSurface to OpenDrSaiDarkColorScheme.surface,
            OpenDrSaiDarkColorScheme.onBackground to OpenDrSaiDarkColorScheme.background,
        ).forEach { (foreground, background) ->
            assertTrue(
                "contrast ${contrastRatio(foreground, background)} for $foreground on $background",
                contrastRatio(foreground, background) >= 4.5f,
            )
        }
    }

    @Test
    fun desktopPurpleActionMeetsNonTextContrast() {
        assertTrue(
            contrastRatio(OpenDrSaiLightColorScheme.onPrimary, OpenDrSaiLightColorScheme.primary) >= 3f,
        )
    }

    private fun contrastRatio(first: Color, second: Color): Float {
        val lighter = maxOf(first.luminance(), second.luminance())
        val darker = minOf(first.luminance(), second.luminance())
        return (lighter + 0.05f) / (darker + 0.05f)
    }
}
