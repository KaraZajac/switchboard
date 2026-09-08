package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * The phone's surfaces, type and small shared parts.
 *
 * The colours are the desktop's, theme for theme — see `scripts/themes.py`,
 * which reads them out of the stylesheet the desktop actually paints with. The
 * two clients are meant to read as one product, and a phone stuck on one
 * palette while the desktop offers thirteen does not.
 *
 * Each name below is a property rather than a constant so that changing theme
 * repaints the app: reading one inside a composable subscribes to
 * [activePalette], and setting that recomposes everything that did.
 */

private var activePalette by mutableStateOf(DEFAULT_PALETTE)

/** The theme in use, for the picker to tick and the settings to save */
val theme: Palette get() = activePalette

/** Switch themes. Everything drawn from these names repaints. */
fun applyTheme(id: String?) {
    activePalette = paletteFor(id)
}

val Crust: Color get() = activePalette.crust
val Mantle: Color get() = activePalette.mantle
val Base: Color get() = activePalette.base
val Surface0: Color get() = activePalette.surface0
val Surface1: Color get() = activePalette.surface1
val Text0: Color get() = activePalette.text
val Subtext: Color get() = activePalette.subtext
val Overlay: Color get() = activePalette.overlay
val Blue: Color get() = activePalette.accent
val Green: Color get() = activePalette.good
val Yellow: Color get() = activePalette.warn
val Red: Color get() = activePalette.bad
val Mauve: Color get() = activePalette.accentSoft

/**
 * Stable per nick, and the same on both clients.
 *
 * FNV-1a over the nick, indexing the theme's avatar colours — the same hash and
 * the same list the desktop uses, so a person is the same colour on the phone
 * as on the machine next to it.
 */
fun nickColor(nick: String): Color {
    var hash = 2166136261u
    for (char in nick) {
        hash = hash xor char.code.toUInt()
        hash *= 16777619u
    }
    val avatars = activePalette.avatars
    return avatars[(hash % avatars.size.toUInt()).toInt()]
}

/** The `color` metadata key, when it is something we can actually draw */
fun metadataColor(value: String?): Color? {
    val raw = value?.trim() ?: return null
    if (raw.matches(Regex("^#[0-9a-fA-F]{6}$"))) {
        return Color(("ff" + raw.substring(1)).toLong(16))
    }
    if (raw.matches(Regex("^#[0-9a-fA-F]{3}$"))) {
        val r = raw[1]; val g = raw[2]; val b = raw[3]
        return Color("ff$r$r$g$g$b$b".toLong(16))
    }
    // mIRC colour numbers, which plenty of people still set
    val index = raw.toIntOrNull() ?: return null
    return MIRC_COLORS.getOrNull(index)
}

private val MIRC_COLORS = listOf(
    Color(0xFFFFFFFF), Color(0xFF000000), Color(0xFF00007F), Color(0xFF009300),
    Color(0xFFFF0000), Color(0xFF7F0000), Color(0xFF9C009C), Color(0xFFFC7F00),
    Color(0xFFFFFF00), Color(0xFF00FC00), Color(0xFF009393), Color(0xFF00FFFF),
    Color(0xFF0000FC), Color(0xFFFF00FF), Color(0xFF7F7F7F), Color(0xFFD2D2D2)
)

val TIME_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("h:mm a").withZone(ZoneId.systemDefault())
val DAY_FORMAT: DateTimeFormatter =
    DateTimeFormatter.ofPattern("EEEE, d MMMM").withZone(ZoneId.systemDefault())

fun parseTime(iso: String): Instant? = runCatching { Instant.parse(iso) }.getOrNull()

fun sameDay(a: String, b: String): Boolean {
    val first = parseTime(a)?.atZone(ZoneId.systemDefault())?.toLocalDate()
    val second = parseTime(b)?.atZone(ZoneId.systemDefault())?.toLocalDate()
    return first != null && first == second
}

fun withinFiveMinutes(a: String, b: String): Boolean {
    val first = parseTime(a) ?: return false
    val second = parseTime(b) ?: return false
    return kotlin.math.abs(second.epochSecond - first.epochSecond) < 300
}

/**
 * A person's avatar.
 *
 * IRC has no avatars of its own — `draft/metadata-2` carries a URL, and until
 * one is set the initial on a colour derived from the nick is what everyone
 * already recognises each other by in a channel list.
 */
@Composable
fun Avatar(
    nick: String,
    size: Dp = 40.dp,
    color: Color = nickColor(nick),
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.size(size).background(color, CircleShape),
        contentAlignment = Alignment.Center
    ) {
        Text(
            nick.firstOrNull { it.isLetterOrDigit() }?.uppercase() ?: "?",
            color = Crust,
            fontSize = (size.value * 0.42f).sp,
            fontWeight = FontWeight.Bold
        )
    }
}

/** A count badge: mentions in red, plain unread in grey */
@Composable
fun CountBadge(count: Int, background: Color = Red, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .background(background, RoundedCornerShape(10.dp))
            .padding(horizontal = 6.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(
            if (count > 99) "99+" else count.toString(),
            color = Crust,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

/** A small pill of text — mode, role, a status word */
@Composable
fun Pill(label: String, color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.16f))
            .padding(horizontal = 5.dp, vertical = 1.dp)
    ) {
        Text(label, color = color, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
}
