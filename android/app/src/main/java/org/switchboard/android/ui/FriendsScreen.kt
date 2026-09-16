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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.irc.Friends
import org.switchboard.android.unwatchNicks

/**
 * Everyone you watch, on every network, as one list.
 *
 * Friends used to be a card in Settings with a heading per network, which made
 * "is anybody about?" a question you answered by scrolling — and put the answer
 * somewhere nobody opens unless something is wrong. It sits beside the
 * conversations now, because both are lists of people rather than lists of
 * places, and it reads `nick@network` because that is who somebody is: the same
 * name belongs to different people on different networks, so two rows that look
 * alike are never merged.
 */
@Composable
fun FriendsScreen(
    engine: SwitchboardEngine,
    onOpen: (serverId: String, nick: String) -> Unit,
    onClose: () -> Unit
) {
    val store = engine.store

    val roster = Friends.roster(
        store.servers.values.flatMap { server ->
            store.watchedFor(server.id).map { nick ->
                Friends.Watched(
                    serverId = server.id,
                    network = server.name.ifBlank { server.host },
                    nick = nick,
                    online = store.isOnline(server.id, nick)
                )
            }
        }
    )

    val online = roster.filter { it.online }
    val away = roster.filterNot { it.online }

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
            Text("Friends", color = Text0, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            if (roster.isNotEmpty()) {
                Text(
                    "${online.size} of ${roster.size} online",
                    color = Overlay,
                    fontSize = 11.sp,
                    modifier = Modifier.padding(end = 12.dp)
                )
            }
        }

        if (roster.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                Text(
                    "Nobody yet. Open somebody's name in a channel and choose " +
                        "“Tell me when they are online”.",
                    color = Overlay,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 48.dp, start = 32.dp, end = 32.dp)
                )
            }
            return@Column
        }

        LazyColumn(modifier = Modifier.fillMaxSize().navigationBarsPadding()) {
            if (online.isNotEmpty()) item { Heading("Online — ${online.size}") }
            items(online.size) { at -> FriendRow(engine, online[at], onOpen) }

            if (away.isNotEmpty()) item { Heading("Offline — ${away.size}") }
            items(away.size) { at -> FriendRow(engine, away[at], onOpen) }
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(
        text,
        color = Overlay,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 6.dp)
    )
}

@Composable
private fun FriendRow(
    engine: SwitchboardEngine,
    friend: Friends.Friend,
    onOpen: (serverId: String, nick: String) -> Unit
) {
    val profile = engine.store.metadataFor(friend.serverId, friend.nick)
    val colour = metadataColor(profile.color) ?: nickColor(friend.nick)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onOpen(friend.serverId, friend.nick) }
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box {
            Avatar(friend.nick, 36.dp, colour, avatar = profile.avatar)
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .size(11.dp)
                    .clip(CircleShape)
                    .background(Base)
                    .padding(1.5.dp)
                    .clip(CircleShape)
                    .background(if (friend.online) Green else Overlay)
            )
        }

        Spacer(Modifier.width(12.dp))

        // `nick@network`, the way people write it — the network is not a
        // subtitle, it is half the name
        Row(modifier = Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Text(
                friend.nick,
                color = if (friend.online) Text0 else Subtext,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                "@${friend.network}",
                color = Overlay,
                fontSize = 15.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        Text(
            "Stop watching",
            color = Red,
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
                .clip(RoundedCornerShape(12.dp))
                .clickable { engine.unwatchNicks(friend.serverId, listOf(friend.nick)) }
                .padding(horizontal = 10.dp, vertical = 6.dp)
        )
    }

    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Mantle))
}
