package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.switchboard.android.JumpTarget
import org.switchboard.android.Mention
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.recentMentions
import java.time.ZoneId

/**
 * Everything that named you, across every network, newest first.
 *
 * The badge on a channel has always counted these and then forgotten which
 * lines they were, so the question it raises — what did they say? — could only
 * be answered by opening each network in turn and looking for your own nick.
 *
 * Where the answer comes from depends on what is holding the connections, and
 * the header says which: a desktop or a headless Switchboard has the whole
 * history, while this phone keeps a rolling window of each conversation. See
 * [recentMentions].
 */
@Composable
fun MentionsScreen(
    engine: SwitchboardEngine,
    onOpen: (serverId: String, channel: String) -> Unit,
    onClose: () -> Unit
) {
    var mentions by remember { mutableStateOf<List<Mention>?>(null) }

    // Re-asked whenever a message arrives, because a mention landing while
    // this is open is the one thing it exists to show
    val arrivals = engine.store.messagesSeen

    LaunchedEffect(arrivals) { mentions = engine.recentMentions() }

    Column(modifier = Modifier.fillMaxSize().background(Base)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Mantle)
                .statusBarsPadding()
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconAction(Icons.AutoMirrored.Filled.ArrowBack, "Back", onClose)
            Spacer(Modifier.width(4.dp))
            Text("Mentions", color = Text0, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text(
                if (engine.isHolding) "this session" else "full history",
                color = Overlay,
                fontSize = 11.sp,
                modifier = Modifier.padding(end = 12.dp)
            )
        }

        val found = mentions
        when {
            found == null -> Note("Looking…")
            found.isEmpty() -> Note(
                "Nothing yet. When somebody says your nick — or one of your highlight " +
                    "words — in a channel, it will be here."
            )
            else -> LazyColumn(modifier = Modifier.fillMaxSize().navigationBarsPadding()) {
                items(found.size) { index ->
                    val mention = found[index]
                    MentionRow(engine, mention) {
                        // To the line, not to the room it was said in — see
                        // [Jump]. The list is most of the way to useless if
                        // arriving means going looking.
                        engine.store.jumpTo = JumpTarget(
                            serverId = mention.serverId,
                            channel = mention.channel,
                            msgid = mention.id.takeIf { it.isNotEmpty() },
                            timestamp = mention.timestamp
                        )
                        onOpen(mention.serverId, mention.channel)
                    }
                }
            }
        }
    }
}

@Composable
private fun Note(text: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Text(
            text,
            color = Overlay,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 48.dp, start = 32.dp, end = 32.dp)
        )
    }
}

/** One mention: who said it, on which network and in which channel, and when */
@Composable
private fun MentionRow(engine: SwitchboardEngine, mention: Mention, onClick: () -> Unit) {
    val profile = engine.store.metadataFor(mention.serverId, mention.nick)
    val colour = metadataColor(profile.color) ?: nickColor(mention.nick)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp)
    ) {
        // Both halves of where, always. The whole point of this screen is that
        // the network is no longer implied by what you happen to have open.
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                mention.network,
                color = Overlay,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Spacer(Modifier.width(6.dp))
            Text(mention.channel, color = Subtext, fontSize = 12.sp, maxLines = 1)
            Spacer(Modifier.weight(1f))
            Text(whenItWas(mention.timestamp), color = Overlay, fontSize = 11.sp)
        }

        Spacer(Modifier.height(6.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(mention.nick, 20.dp, colour, avatar = profile.avatar)
            Spacer(Modifier.width(8.dp))
            Text(
                profile.displayName?.takeIf { it.isNotBlank() } ?: mention.nick,
                color = colour,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold
            )
        }

        Spacer(Modifier.height(4.dp))
        Text(
            mention.content,
            color = Text0,
            fontSize = 14.sp,
            lineHeight = 19.sp,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 28.dp)
        )
        Spacer(Modifier.height(8.dp))
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Mantle))
    }
}

/**
 * When it was said, in as few words as carry it.
 *
 * A list that crosses days needs the day; today's needs the time. Both on
 * every row is noise in the column that matters least.
 */
private fun whenItWas(timestamp: String): String {
    val at = parseTime(timestamp) ?: return ""
    val day = at.atZone(ZoneId.systemDefault()).toLocalDate()
    val today = java.time.LocalDate.now(ZoneId.systemDefault())

    return if (day == today) TIME_FORMAT.format(at) else DAY_FORMAT.format(at)
}
