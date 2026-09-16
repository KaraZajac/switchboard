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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
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
import org.switchboard.android.watchNicks

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

    var adding by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf<String?>(null) }

    // Only a network that is up can be told to watch anybody. One that is not
    // would take the name, write it down, and say nothing for as long as it
    // stayed down — which reads exactly like the person never being around.
    val reachable = store.servers.values
        .filter { it.connected }
        .sortedBy { it.name.lowercase() }
    val target = chosen?.takeIf { id -> reachable.any { it.id == id } } ?: reachable.firstOrNull()?.id

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
                    modifier = Modifier.padding(end = 4.dp)
                )
            }
            IconAction(
                Icons.Filled.Add,
                "Watch somebody",
                { adding = !adding },
                inRow = true,
                tint = Green
            )
        }

        if (adding) {
            AddFriend(
                typed = typed,
                onTyped = { typed = it },
                networks = reachable.map { it.id to it.name.ifBlank { it.host } },
                target = target,
                onTarget = { chosen = it },
                onAdd = {
                    val nick = typed.trim()
                    if (nick.isNotEmpty() && target != null) {
                        engine.watchNicks(target, listOf(nick))
                        typed = ""
                        adding = false
                    }
                }
            )
        }

        if (roster.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                Text(
                    "Nobody yet. Add somebody with the + above, or open their name " +
                        "in a channel and choose “Tell me when they are online”.",
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

/**
 * Somebody to start watching, and which network to watch them on.
 *
 * The network is asked for rather than assumed, because a nick belongs to one:
 * watching `rowan` says nothing about who answers to that name anywhere else.
 * Only the networks that are up are offered — one that is down would take the
 * name, write it down and stay silent, which reads exactly like the person
 * never being around.
 */
@Composable
private fun AddFriend(
    typed: String,
    onTyped: (String) -> Unit,
    networks: List<Pair<String, String>>,
    target: String?,
    onTarget: (String) -> Unit,
    onAdd: () -> Unit
) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
        if (networks.isEmpty()) {
            Text(
                "No network is connected, and a friend list lives on the connection — " +
                    "come back when one is up.",
                color = Overlay,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 6.dp)
            )
            return@Column
        }

        OutlinedTextField(
            value = typed,
            onValueChange = onTyped,
            placeholder = { Text("Nickname", color = Overlay, fontSize = 15.sp) },
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onAdd() }),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Surface0,
                unfocusedContainerColor = Surface0,
                focusedTextColor = Text0,
                unfocusedTextColor = Text0,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = Blue
            ),
            modifier = Modifier.fillMaxWidth()
        )

        // One network is not a choice, so it is not offered as one
        if (networks.size > 1) {
            Spacer(Modifier.height(8.dp))
            Row(modifier = Modifier.fillMaxWidth()) {
                for ((id, name) in networks) {
                    Text(
                        name,
                        color = if (id == target) Crust else Subtext,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        // A rounded rectangle, like every other control here.
                        // At this height a 20dp radius is a lozenge, and one
                        // lozenge among rectangles reads as a different kind of
                        // thing than the buttons beside it.
                        modifier = Modifier
                            .padding(end = 8.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (id == target) Blue else Surface0)
                            .clickable { onTarget(id) }
                            .padding(horizontal = 14.dp, vertical = 7.dp)
                    )
                }
            }
        }

        Spacer(Modifier.height(8.dp))
        Text(
            "Watch",
            color = if (typed.isBlank()) Overlay else Crust,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(if (typed.isBlank()) Surface0 else Green)
                .clickable(enabled = typed.isNotBlank()) { onAdd() }
                .padding(vertical = 12.dp)
        )

        Spacer(Modifier.height(4.dp))
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Mantle))
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
                .clip(RoundedCornerShape(8.dp))
                .clickable { engine.unwatchNicks(friend.serverId, listOf(friend.nick)) }
                .padding(horizontal = 10.dp, vertical = 6.dp)
        )
    }

    Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Mantle))
}
