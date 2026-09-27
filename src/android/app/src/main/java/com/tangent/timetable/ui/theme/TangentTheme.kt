package com.tangent.timetable.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Forest = Color(0xFF315C45)
private val ForestDark = Color(0xFFB1D5B8)
private val Paper = Color(0xFFF5F6F1)
private val Ink = Color(0xFF17211B)
private val Night = Color(0xFF171D19)

@Composable
fun TangentTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = if (dark) {
        darkColorScheme(
            primary = ForestDark,
            secondary = Color(0xFFD0C29A),
            background = Night,
            surface = Color(0xFF202822),
        )
    } else {
        lightColorScheme(
            primary = Forest,
            secondary = Color(0xFF8B6738),
            background = Paper,
            surface = Color.White,
            onBackground = Ink,
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}
