package com.tomasmach.na_pivo.wear.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.wear.compose.material3.ColorScheme
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.Typography
import com.tomasmach.na_pivo.wear.R

/**
 * The watch reuses the mobile Tácek visual tokens verbatim. Layout and gestures
 * remain Wear-native, but color and type should feel like the same product.
 */
internal object NaPivoColors {
    val Stout = Color(0xFF1F1308)
    val Stout2 = Color(0xFF2B1A0E)
    val Stout3 = Color(0xFF3A2515)
    val Border = Color(0xFF5A3A20)
    val Amber = Color(0xFFE8A317)
    val AmberLight = Color(0xFFF5B642)
    val Glow = Color(0xFFFF7A1A)
    val Neon = Color(0xFFFFD27A)
    val Foam = Color(0xFFFBF3E0)
    val FoamMuted = Color(0xFFE8DCC0)
    val MutedText = Color(0xFFA8896A)
    val Success = Color(0xFF7DD66B)
    val Black = Color(0xFF000000)
    val White = Color(0xFFFFFFFF)

    val StoutArgb = 0xFF1F1308.toInt()
    val Stout2Argb = 0xFF2B1A0E.toInt()
    val Stout3Argb = 0xFF3A2515.toInt()
    val BorderArgb = 0xFF5A3A20.toInt()
    val AmberArgb = 0xFFE8A317.toInt()
    val AmberLightArgb = 0xFFF5B642.toInt()
    val FoamArgb = 0xFFFBF3E0.toInt()
    val FoamMutedArgb = 0xFFE8DCC0.toInt()
    val MutedTextArgb = 0xFFA8896A.toInt()
}

internal val Baloo2FontFamily = FontFamily(
    Font(R.font.baloo2_regular, FontWeight.Normal),
    Font(R.font.baloo2_medium, FontWeight.Medium),
    Font(R.font.baloo2_semibold, FontWeight.SemiBold),
    Font(R.font.baloo2_bold, FontWeight.Bold),
    Font(R.font.baloo2_extrabold, FontWeight.ExtraBold),
    Font(R.font.baloo2_extrabold, FontWeight.Black),
)

internal val InterFontFamily = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
    Font(R.font.inter_bold, FontWeight.Bold),
)

private val NaPivoColorScheme = ColorScheme(
    primary = NaPivoColors.Amber,
    primaryDim = NaPivoColors.AmberLight,
    primaryContainer = NaPivoColors.Stout3,
    onPrimary = NaPivoColors.Stout,
    onPrimaryContainer = NaPivoColors.Foam,
    secondary = NaPivoColors.AmberLight,
    secondaryDim = NaPivoColors.Amber,
    secondaryContainer = NaPivoColors.Stout3,
    onSecondary = NaPivoColors.Stout,
    onSecondaryContainer = NaPivoColors.Foam,
    tertiary = NaPivoColors.Neon,
    tertiaryDim = NaPivoColors.AmberLight,
    tertiaryContainer = NaPivoColors.Stout3,
    onTertiary = NaPivoColors.Stout,
    onTertiaryContainer = NaPivoColors.Foam,
    surfaceContainerLow = NaPivoColors.Stout,
    surfaceContainer = NaPivoColors.Stout2,
    surfaceContainerHigh = NaPivoColors.Stout3,
    onSurface = NaPivoColors.Foam,
    onSurfaceVariant = NaPivoColors.FoamMuted,
    outline = NaPivoColors.Border,
    outlineVariant = NaPivoColors.Border.copy(alpha = 0.6f),
    background = NaPivoColors.Stout,
    onBackground = NaPivoColors.Foam,
    error = NaPivoColors.AmberLight,
    errorDim = NaPivoColors.MutedText,
    errorContainer = NaPivoColors.Stout3,
    onError = NaPivoColors.Stout,
    onErrorContainer = NaPivoColors.Foam,
)

@Composable
internal fun NaPivoWearTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = NaPivoColorScheme,
        typography = Typography(defaultFontFamily = InterFontFamily),
        content = content,
    )
}
