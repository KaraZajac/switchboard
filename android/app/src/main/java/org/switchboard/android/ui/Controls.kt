package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The sizes this app draws with.
 *
 * Every dp used to be an inline literal, and it showed: four glyph sizes,
 * seven touch targets, four left edges in one list, three in one settings
 * column. These are the numbers, in one place, so a new control can only be
 * the same size as the ones beside it.
 */
object Sizes {
    /** One glyph size. Everything that is an icon is this big. */
    val icon = 20.dp

    /** A control in a bar or the composer — the comfortable thumb target */
    val tapBar = 44.dp

    /** A control inside a row or a heading, where 44 would crowd the text */
    val tapRow = 36.dp

    /** The edge everything in a panel starts at */
    val gutter = 16.dp

    /** Between a row's avatar and its text */
    val avatarGap = 10.dp

    /** A conversation avatar, and the one in a members or messages row */
    val avatarLarge = 40.dp
    val avatarRow = 32.dp

    /** How far a message's text sits from the edge: [avatarLarge] + the gap */
    val messageGutter = 56.dp

    /** A spinner, wherever one is shown */
    val spinner = 20.dp

    /** A presence or connection dot, and the ring that lifts it off what is behind */
    val dot = 12.dp
    val dotRing = 2.dp

    /** A full-width primary button */
    val buttonHeight = 48.dp
}

/**
 * An icon that does something.
 *
 * Replaces eleven hand-sized `Icon(...).clickable(...)` chains. Two of those
 * had no padding at all, so their touch target *was* the glyph — an 18dp
 * target on a phone, next to chips twice that size. They also skipped `clip`,
 * so a round button flashed a square ripple.
 *
 * [inRow] shrinks the target, never the glyph: an icon that changes size from
 * one row to the next is the thing this is here to stop.
 */
@Composable
fun IconAction(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    inRow: Boolean = false,
    tint: Color = Subtext,
    enabled: Boolean = true
) {
    Box(
        modifier = modifier
            .size(if (inRow) Sizes.tapRow else Sizes.tapBar)
            .clip(CircleShape)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Icon(
            icon,
            contentDescription = label,
            tint = if (enabled) tint else Overlay,
            modifier = Modifier.size(Sizes.icon)
        )
    }
}

/**
 * A heading over a list: CHANNELS — 4, OPERATORS — 2, "Notifications".
 *
 * Uppercase, because every other heading in the app was and the fourteen in
 * settings were the exception. One left edge, which is the same one the rows
 * beneath it use — the old ones sat two pixels to the right of their own
 * content for no reason anybody chose.
 */
@Composable
fun SectionLabel(
    text: String,
    modifier: Modifier = Modifier,
    trailing: @Composable (RowScope.() -> Unit)? = null
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(start = Sizes.gutter, end = 6.dp, top = 14.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text.uppercase(),
            color = Overlay,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f)
        )
        trailing?.invoke(this)
    }
}
