@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Settings
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.sp
import org.switchboard.android.EngineMode
import org.switchboard.android.Server
import org.switchboard.android.SwitchboardStore
import org.switchboard.android.isChannel

/**
 * The navigator: server rail on the left, channels beside it.
 *
 * The two-column shape is Discord's, and it earns its place — the rail answers
 * "which network" at a glance and survives having a dozen of them, which is
 * exactly the situation IRC users are in and the situation a flat list handles
 * worst.
 */
@Composable
fun Navigator(
    store: SwitchboardStore,
    mode: EngineMode,
    modeDetail: String,
    takingOver: Boolean,
    vaultUnlocked: Boolean,
    onSelect: (serverId: String, channel: String) -> Unit,
    onSelectServer: (serverId: String) -> Unit,
    onJoin: (serverId: String, channel: String) -> Unit,
    onOpenSettings: () -> Unit,
    onEditProfile: () -> Unit,
    onBrowse: () -> Unit,
    onManageServers: () -> Unit
) {
    Row(modifier = Modifier.fillMaxSize().background(Mantle)) {
        ServerRail(store, onSelectServer, onManageServers)

        Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
            ChannelList(store, onSelect, onJoin, onBrowse, modifier = Modifier.weight(1f))
            UserPanel(store, mode, modeDetail, takingOver, vaultUnlocked, onOpenSettings, onEditProfile)
        }
    }
}

/**
 * The strip of networks.
 *
 * The pill on the left edge is the whole information design here: tall for the
 * server you are looking at, short for one with something unread, absent
 * otherwise. It reads without being looked at, which is what a rail is for.
 */
@Composable
private fun ServerRail(
    store: SwitchboardStore,
    onSelect: (String) -> Unit,
    onManageServers: () -> Unit
) {
    val servers = store.servers.values.sortedBy { it.name.lowercase() }

    Column(
        modifier = Modifier
            .width(68.dp)
            .fillMaxHeight()
            .background(Crust)
            .verticalScroll(rememberScrollState())
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        for (server in servers) {
            val active = store.activeServerId == server.id
            val unread = store.channelsFor(server.id).sumOf { it.unread }
            val mentions = store.channelsFor(server.id).sumOf { it.mentions }

            Box(
                modifier = Modifier.fillMaxWidth().height(52.dp),
                contentAlignment = Alignment.CenterStart
            ) {
                Box(
                    modifier = Modifier
                        .width(4.dp)
                        .height(if (active) 40.dp else if (unread > 0) 10.dp else 0.dp)
                        .clip(RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp))
                        .background(Text0)
                )

                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    ServerBadge(server, active, mentions, onSelect)
                }
            }
        }

        // Where every app of this shape puts "add a server"
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(Surface0)
                .clickable(onClick = onManageServers),
            contentAlignment = Alignment.Center
        ) {
            Text("+", color = Green, fontSize = 24.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun ServerBadge(
    server: Server,
    active: Boolean,
    mentions: Int,
    onSelect: (String) -> Unit
) {
    Box(contentAlignment = Alignment.BottomEnd) {
        Box(
            modifier = Modifier
                .size(48.dp)
                // Discord's trick: the selected server squares off its corners,
                // so selection is legible even without colour.
                .clip(RoundedCornerShape(if (active) 16.dp else 24.dp))
                .background(if (active) Blue else Surface0)
                .clickable { onSelect(server.id) },
            contentAlignment = Alignment.Center
        ) {
            Text(
                server.name.take(2).uppercase(),
                color = if (active) Crust else Text0,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )
        }

        // Connection state, where a Discord avatar would carry presence
        Box(
            modifier = Modifier
                .size(14.dp)
                .background(Crust, CircleShape)
                .padding(2.5.dp)
                .background(if (server.connected) Green else Overlay, CircleShape)
        )

        if (mentions > 0) {
            Box(modifier = Modifier.align(Alignment.TopEnd)) {
                CountBadge(mentions)
            }
        }
    }
}

/** Channels on the selected network, with the server's name as the header */
@Composable
private fun ChannelList(
    store: SwitchboardStore,
    onSelect: (serverId: String, channel: String) -> Unit,
    onJoin: (serverId: String, channel: String) -> Unit,
    onBrowse: () -> Unit,
    modifier: Modifier = Modifier
) {
    var joining by remember { mutableStateOf(false) }
    val serverId = store.activeServerId
    val server = serverId?.let { store.servers[it] }
    // Only rooms here; people have their own section below, and a nick listed
    // as "#robin" is both wrong and duplicated.
    val channels = serverId?.let { store.channelsFor(it).filter { c -> isChannel(c.name) } }
        ?: emptyList()

    Column(modifier = modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    server?.name ?: "Switchboard",
                    color = Text0,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                if (server != null) {
                    Text(
                        server.host,
                        color = Overlay,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }

        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Crust))
        Spacer(Modifier.height(12.dp))

        Row(
            modifier = Modifier.fillMaxWidth().padding(end = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(modifier = Modifier.weight(1f)) {
                SectionHeader("Channels — ${channels.size}")
            }
            if (serverId != null) {
                Text(
                    "+",
                    color = Subtext,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .clickable { joining = true }
                        .padding(horizontal = 10.dp, vertical = 2.dp)
                )
            }
        }

        if (joining && serverId != null) {
            JoinChannelSheet(
                onDismiss = { joining = false },
                onBrowse = {
                    joining = false
                    onBrowse()
                },
                onJoin = { name ->
                    joining = false
                    // A bare name is a channel; anything else the user typed
                    // their own prefix for is left alone
                    onJoin(serverId, if (name.startsWith("#") || name.startsWith("&")) name else "#$name")
                }
            )
        }

        if (channels.isEmpty()) {
            Text(
                "Nothing joined yet.",
                color = Overlay,
                fontSize = 13.sp,
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp)
            )
        }

        for (channel in channels) {
            val selected = store.activeServerId == serverId &&
                store.activeChannel.equals(channel.name, true)
            val unread = channel.unread > 0

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 1.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(if (selected) Surface0 else Color.Transparent)
                    .clickable { serverId?.let { onSelect(it, channel.name) } }
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "#",
                    color = if (selected || unread) Subtext else Overlay,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.width(22.dp)
                )
                Text(
                    channel.name.removePrefix("#"),
                    color = if (selected || unread) Text0 else Subtext,
                    fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
                if (channel.mentions > 0) {
                    CountBadge(channel.mentions)
                } else if (unread) {
                    CountBadge(channel.unread, Surface1)
                }
            }
        }

        val conversations = serverId?.let { store.directMessages(it) }.orEmpty()
        if (conversations.isNotEmpty()) {
            Spacer(Modifier.height(16.dp))
            SectionHeader("Direct messages — ${conversations.size}")

            for (who in conversations) {
                val entry = store.channelsFor(serverId!!).first { it.name.equals(who, true) }
                val selected = store.activeChannel.equals(who, true)
                val unread = entry.unread > 0
                val profile = store.metadataFor(serverId, who)

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 1.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (selected) Surface0 else Color.Transparent)
                        .clickable { onSelect(serverId, who) }
                        .padding(horizontal = 8.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Avatar(who, 24.dp, metadataColor(profile.color) ?: nickColor(who))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        profile.displayName?.takeIf { it.isNotBlank() } ?: who,
                        color = if (selected || unread) Text0 else Subtext,
                        fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    if (entry.unread > 0) CountBadge(entry.unread)
                }
            }
        }

        Spacer(Modifier.height(16.dp))
    }
}

/** Asking to join somewhere new */
@Composable
private fun JoinChannelSheet(
    onDismiss: () -> Unit,
    onBrowse: () -> Unit,
    onJoin: (String) -> Unit
) {
    var name by remember { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Mantle) {
        Column(modifier = Modifier.fillMaxWidth().padding(24.dp)) {
            Text("Join a channel", color = Text0, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            Text(
                "The # is added for you.",
                color = Overlay,
                fontSize = 12.sp
            )
            Spacer(Modifier.height(16.dp))

            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                placeholder = { Text("channel", color = Overlay, fontSize = 15.sp) },
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = {
                    if (name.isNotBlank()) onJoin(name.trim())
                }),
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

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = { if (name.isNotBlank()) onJoin(name.trim()) },
                enabled = name.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Blue,
                    contentColor = Crust,
                    disabledContainerColor = Surface0,
                    disabledContentColor = Overlay
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                Text("Join", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }

            // Knowing the name is the easy case. Not knowing it is why LIST exists.
            Text(
                "Browse the network instead",
                color = Blue,
                fontSize = 14.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .clickable(onClick = onBrowse)
                    .padding(vertical = 14.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun SectionHeader(label: String) {
    Text(
        label.uppercase(),
        color = Overlay,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 18.dp, end = 16.dp, bottom = 4.dp)
    )
}

/**
 * The panel across the bottom: who you are, and which device is on the network.
 *
 * The mode line is the one piece of this app that has no Discord equivalent, and
 * it is the piece a user most needs: whether this phone is watching the desktop
 * or standing in for it changes what happens when they close the app.
 */
@Composable
private fun UserPanel(
    store: SwitchboardStore,
    mode: EngineMode,
    modeDetail: String,
    takingOver: Boolean,
    vaultUnlocked: Boolean,
    onOpenSettings: () -> Unit,
    onEditProfile: () -> Unit
) {
    val server = store.activeServerId?.let { store.servers[it] }
    val nick = server?.nick.orEmpty().ifBlank { "you" }
    val profile = store.activeServerId?.let { store.metadataFor(it, nick) }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Crust)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Your own avatar is where a profile lives in every app of this shape
        Box(modifier = Modifier.clip(CircleShape).clickable(onClick = onEditProfile)) {
            Avatar(nick, 34.dp, metadataColor(profile?.color) ?: nickColor(nick))
        }
        Spacer(Modifier.width(9.dp))

        Column(modifier = Modifier.weight(1f).clickable(onClick = onEditProfile)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    profile?.displayName?.takeIf { it.isNotBlank() } ?: nick,
                    color = Text0,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                Spacer(Modifier.width(6.dp))
                ModePill(mode, takingOver)
            }
            Text(
                modeDetail,
                color = Overlay,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        if (!vaultUnlocked) {
            Icon(
                Icons.Filled.Lock,
                contentDescription = "Shared config is locked",
                tint = Yellow,
                modifier = Modifier.size(18.dp).clickable(onClick = onOpenSettings)
            )
            Spacer(Modifier.width(10.dp))
        }

        Icon(
            Icons.Filled.Settings,
            contentDescription = "Settings",
            tint = Subtext,
            modifier = Modifier.size(20.dp).clickable(onClick = onOpenSettings)
        )
    }
}

/**
 * Which client is on the network, in two words.
 *
 * Taking over gets its own colour rather than borrowing "offline". The two are
 * not the same thing to a person watching: one means nothing is happening, and
 * the other means something is — for the twenty-odd seconds it takes to dial a
 * server, which is exactly when someone is looking at this.
 */
@Composable
fun ModePill(mode: EngineMode, takingOver: Boolean = false) = when {
    mode == EngineMode.HOLDING -> Pill("LIVE", Green)
    mode == EngineMode.FOLLOWING -> Pill("DESKTOP", Blue)
    takingOver -> Pill("TAKING OVER", Yellow)
    else -> Pill("OFFLINE", Overlay)
}
