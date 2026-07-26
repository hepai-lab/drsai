package ai.drsai.remote.ui

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * Android mapping of the effective Desktop palette.
 *
 * The Desktop sidebar intentionally overrides a few root --app-* tokens with cool
 * neutral navigation colors. Map those final rendered values to Material roles so
 * Android does not turn large selected areas lavender.
 */
internal val OpenDrSaiLightColorScheme: ColorScheme = lightColorScheme(
    primary = Color(0xFF8B5CF6),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFF1EEF7),
    onPrimaryContainer = Color(0xFF2F2A3A),
    inversePrimary = Color(0xFFA78BFA),
    secondary = Color(0xFF69758A),
    onSecondary = Color(0xFFFFFFFF),
    // Desktop .sidebar-button.active / .workspace-row.active.
    secondaryContainer = Color(0xFFE6EBF1),
    onSecondaryContainer = Color(0xFF202733),
    tertiary = Color(0xFF2F7D5B),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFF1FBF6),
    onTertiaryContainer = Color(0xFF1B4B38),
    background = Color(0xFFFAFAFE),
    onBackground = Color(0xFF202733),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF202733),
    // Desktop navigation hover and muted navigation text.
    surfaceVariant = Color(0xFFEEF2F6),
    onSurfaceVariant = Color(0xFF4A5260),
    // Desktop elevation is expressed with neutral shadows, never a purple overlay.
    surfaceTint = Color.Transparent,
    inverseSurface = Color(0xFF202733),
    inverseOnSurface = Color(0xFFF8FAFC),
    error = Color(0xFFB4234A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFF1F5),
    onErrorContainer = Color(0xFF7A1734),
    outline = Color(0xFFD6DCE5),
    outlineVariant = Color(0xFFE6EBF1),
    scrim = Color(0xFF202733),
)

internal val OpenDrSaiDarkColorScheme: ColorScheme = darkColorScheme(
    primary = Color(0xFFC4B5FD),
    onPrimary = Color(0xFF211E27),
    primaryContainer = Color(0xFF382E47),
    onPrimaryContainer = Color(0xFFF2EDF7),
    inversePrimary = Color(0xFF6D4BD6),
    secondary = Color(0xFFA78BFA),
    onSecondary = Color(0xFF211E27),
    secondaryContainer = Color(0xFF2D2738),
    onSecondaryContainer = Color(0xFFDDD6E8),
    tertiary = Color(0xFF6FCF9F),
    onTertiary = Color(0xFF10271D),
    tertiaryContainer = Color(0xFF1B3027),
    onTertiaryContainer = Color(0xFFCFEEDD),
    background = Color(0xFF17151C),
    onBackground = Color(0xFFF0EBF5),
    surface = Color(0xFF211E27),
    onSurface = Color(0xFFF0EBF5),
    surfaceVariant = Color(0xFF292530),
    onSurfaceVariant = Color(0xFFC0B7CB),
    surfaceTint = Color.Transparent,
    inverseSurface = Color(0xFFF0EBF5),
    inverseOnSurface = Color(0xFF2F2A3A),
    error = Color(0xFFF08BA8),
    onError = Color(0xFF3A101F),
    errorContainer = Color(0xFF3A202B),
    onErrorContainer = Color(0xFFF4C8D5),
    outline = Color(0xFF3C3547),
    outlineVariant = Color(0xFF312B39),
    scrim = Color(0xFF000000),
)
