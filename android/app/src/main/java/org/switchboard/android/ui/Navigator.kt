@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.ExperimentalFoundationApi::class
)

package org.switchboard.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.sp
import org.switchboard.android.EngineMode
import org.switchboard.android.Server
import coil.compose.AsyncImage
import androidx.compose.ui.layout.ContentScale
import org.switchboard.android.SwitchboardStore
import org.switchboard.android.SERVER_CONSOLE
import org.switchboard.android.irc.Services
import org.switchboard.android.irc.Unread
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
    pairedWithDesktop: Boolean,
    vaultUnlocked: Boolean,
    onSelect: (serverId: String, channel: String) -> Unit,
    onSelectServer: (serverId: String) -> Unit,
    onEditServer: (serverId: String) -> Unit,
    onOpenAccount: (serverId: String) -> Unit,
    onToggleConnection: (serverId: String) -> Unit,
    isMuted: (serverId: String) -> Boolean,
    onToggleMute: (serverId: String) -> Unit,
    onJoin: (serverId: String, channel: String) -> Unit,
    onLeave: (serverId: String, channel: String) -> Unit,
    isChannelMuted: (serverId: String, channel: String) -> Boolean,
    onToggleChannelMute: (serverId: String, channel: String) -> Unit,
    onOpenSettings: () -> Unit,
    onEditProfile: () -> Unit,
    onToggleAway: (serverId: String, away: Boolean) -> Unit,
    onBrowse: () -> Unit,
    onManageServers: () -> Unit
) {
    Row(modifier = Modifier.fillMaxSize().background(Mantle)) {
        ServerRail(
            store = store,
            onSelect = { id -> store.dmMode = false; onSelectServer(id) },
            onOpenMessages = { store.dmMode = true },
            onManageServers = onManageServers,
            onEditServer = onEditServer,
            onOpenAccount = onOpenAccount,
            onToggleConnection = onToggleConnection,
            isMuted = isMuted,
            isChannelMuted = isChannelMuted,
            onToggleMute = onToggleMute
        )

        Column(modifier = Modifier.weight(1f).fillMaxHeight()) {
            if (store.dmMode) {
                DirectMessageList(
                    store = store,
                    onSelect = onSelect,
                    modifier = Modifier.weight(1f)
                )
            } else {
                ChannelList(
                    store = store,
                    onSelect = onSelect,
                    onJoin = onJoin,
                    onBrowse = onBrowse,
                    onLeave = onLeave,
                    isChannelMuted = isChannelMuted,
                    onToggleChannelMute = onToggleChannelMute,
                    modifier = Modifier.weight(1f)
                )
            }
            UserPanel(
                store, mode, modeDetail, takingOver, pairedWithDesktop, vaultUnlocked,
                onOpenSettings, onEditProfile, onToggleAway
            )
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
    onOpenMessages: () -> Unit,
    onManageServers: () -> Unit,
    onEditServer: (String) -> Unit,
    onOpenAccount: (String) -> Unit,
    onToggleConnection: (String) -> Unit,
    isMuted: (String) -> Boolean,
    /** A silenced channel should not light the network it is on */
    isChannelMuted: (serverId: String, channel: String) -> Boolean,
    onToggleMute: (String) -> Unit
) {
    val servers = store.servers.values.sortedBy { it.name.lowercase() }
    // Which server's menu is open, if any. Long-press is the only way to reach
    // it — editing a network used to mean pressing "add a network" and then
    // choosing an existing one, which reads like a mistake even when it works.
    var menuFor by remember { mutableStateOf<String?>(null) }

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
        // People first, networks under it — the shape every app of this kind
        // has, and the one the desktop already had. A message from someone on
        // a network you are not looking at used to be filed under that
        // network, which is somewhere you have to already know to look.
        val dmUnread = store.directMessageUnread()
        Box(
            modifier = Modifier.fillMaxWidth().height(52.dp),
            contentAlignment = Alignment.CenterStart
        ) {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .height(if (store.dmMode) 40.dp else if (dmUnread > 0) 10.dp else 0.dp)
                    .clip(RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp))
                    .background(Text0)
            )

            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Box(
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(if (store.dmMode) 16.dp else 24.dp))
                        .background(if (store.dmMode) Blue else Surface0)
                        .clickable { onOpenMessages() },
                    contentAlignment = Alignment.Center
                ) {
                    MessagesIcon(
                        tint = if (store.dmMode) Crust else Text0,
                        modifier = Modifier.size(24.dp)
                    )
                }

                if (dmUnread > 0 && !store.dmMode) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(end = 6.dp)
                            .size(18.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .background(Red),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            if (dmUnread > 9) "9+" else "$dmUnread",
                            color = Crust,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }

        HorizontalDivider(
            modifier = Modifier.width(28.dp).padding(vertical = 2.dp),
            color = Surface0
        )

        for (server in servers) {
            val active = store.activeServerId == server.id && !store.dmMode
            // One rule, shared with the desktop: people are not counted here —
            // their unread belongs to the Messages button above — a muted
            // channel does not light its network, and a mention in one still
            // counts, greyed.
            val look = Unread.railLook(
                store.channelsFor(server.id).map { channel ->
                    Unread.Conversation(
                        name = channel.name,
                        unread = channel.unread,
                        mentions = channel.mentions,
                        muted = isChannelMuted(server.id, channel.name)
                    )
                },
                active = active,
                serverMuted = isMuted(server.id)
            )

            Box(
                modifier = Modifier.fillMaxWidth().height(52.dp),
                contentAlignment = Alignment.CenterStart
            ) {
                Box(
                    modifier = Modifier
                        .width(4.dp)
                        .height(
                            when (look.chip) {
                                Unread.Chip.TALL -> 40.dp
                                Unread.Chip.SHORT -> 10.dp
                                Unread.Chip.NONE -> 0.dp
                            }
                        )
                        .clip(RoundedCornerShape(topEnd = 4.dp, bottomEnd = 4.dp))
                        .background(Text0)
                )

                Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    ServerBadge(
                        server = server,
                        active = active,
                        mentions = look.mentions,
                        muted = look.mentionsMuted,
                        onSelect = onSelect,
                        onLongPress = { menuFor = server.id }
                    )

                    ServerMenu(
                        server = server,
                        muted = isMuted(server.id),
                        expanded = menuFor == server.id,
                        onDismiss = { menuFor = null },
                        onAccount = { menuFor = null; onOpenAccount(server.id) },
                        onEdit = { menuFor = null; onEditServer(server.id) },
                        onToggleConnection = { menuFor = null; onToggleConnection(server.id) },
                        onMute = { menuFor = null; onToggleMute(server.id) }
                    )
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

/**
 * A speech bubble, drawn.
 *
 * The one glyph this screen wants lives in `material-icons-extended`, which is
 * a few megabytes and a slower build for a rounded rectangle and a triangle.
 */
@Composable
private fun MessagesIcon(tint: Color, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val body = h * 0.72f
        val radius = body * 0.28f

        drawRoundRect(
            color = tint,
            topLeft = Offset(0f, 0f),
            size = Size(w, body),
            cornerRadius = CornerRadius(radius, radius)
        )

        // The tail, tucked under the left third the way a chat bubble sits
        drawPath(
            path = Path().apply {
                moveTo(w * 0.22f, body - 1f)
                lineTo(w * 0.22f, h)
                lineTo(w * 0.46f, body - 1f)
                close()
            },
            color = tint
        )
    }
}

/**
 * What you can do to a network, without leaving the screen you are on.
 *
 * Long-press, because the rail is a row of small round buttons and there is
 * nowhere to put five more. Editing lives here rather than behind "add a
 * network", which is where it used to be: you pressed add, and then chose an
 * existing one, and the form quietly turned into an edit form.
 */
@Composable
private fun ServerMenu(
    server: Server,
    muted: Boolean,
    expanded: Boolean,
    onDismiss: () -> Unit,
    onAccount: () -> Unit,
    onEdit: () -> Unit,
    onToggleConnection: () -> Unit,
    onMute: () -> Unit
) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss, modifier = Modifier.background(Surface0)) {
        DropdownMenuItem(
            text = { Text(server.name, color = Overlay, fontSize = 12.sp, fontWeight = FontWeight.Bold) },
            onClick = {},
            enabled = false
        )
        DropdownMenuItem(
            text = {
                Text(
                    if (server.connected) "Disconnect" else "Connect",
                    color = if (server.connected) Yellow else Green,
                    fontSize = 14.sp
                )
            },
            onClick = onToggleConnection
        )
        DropdownMenuItem(
            text = { Text("Account…", color = Text0, fontSize = 14.sp) },
            onClick = onAccount
        )
        DropdownMenuItem(
            text = { Text("Edit network", color = Text0, fontSize = 14.sp) },
            onClick = onEdit
        )
        DropdownMenuItem(
            text = {
                Text(
                    if (muted) "Unmute this network" else "Mute this network",
                    color = Text0,
                    fontSize = 14.sp
                )
            },
            onClick = onMute
        )
    }
}

@Composable
private fun ServerBadge(
    server: Server,
    active: Boolean,
    mentions: Int,
    muted: Boolean,
    onSelect: (String) -> Unit,
    onLongPress: () -> Unit
) {
    Box(contentAlignment = Alignment.BottomEnd) {
        Box(
            modifier = Modifier
                .size(48.dp)
                // Discord's trick: the selected server squares off its corners,
                // so selection is legible even without colour.
                .clip(RoundedCornerShape(if (active) 16.dp else 24.dp))
                .background(if (active) Blue else Surface0)
                .combinedClickable(
                    onClick = { onSelect(server.id) },
                    onLongClick = onLongPress
                ),
            contentAlignment = Alignment.Center
        ) {
            // The initials are drawn either way, so a picture that is still
            // loading — or that never arrives — leaves something to read
            // rather than an empty tile.
            Text(
                server.name.take(2).uppercase(),
                color = if (active) Crust else Text0,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )

            // `draft/network-icon`, which the network gives us in ISUPPORT.
            // Most networks set none and the initials are what you get.
            server.icon?.let { icon ->
                AsyncImage(
                    model = icon,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.matchParentSize()
                )
            }
        }

        // Connection state, where a Discord avatar would carry presence
        Box(
            modifier = Modifier
                .size(14.dp)
                .background(Crust, CircleShape)
                .padding(2.5.dp)
                .background(if (server.connected) Green else Overlay, CircleShape)
        )

        // A muted network still counts its mentions; it just does not shout
        // about them. Grey rather than red says which of the two is happening —
        // a rail with no badge at all reads as a quiet evening instead.
        //
        // Hung off the corner rather than tucked inside it: a badge that sits
        // within the icon's outline competes with whatever the icon is, and a
        // network picture is exactly the sort of busy thing it disappears
        // into. The ring is the rail's own colour, so it reads as sitting on
        // top rather than as part of the picture.
        if (mentions > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 7.dp, y = (-7).dp)
            ) {
                CountBadge(
                    mentions,
                    background = if (muted) Overlay else Red,
                    ring = Crust
                )
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
    onLeave: (serverId: String, channel: String) -> Unit,
    isChannelMuted: (serverId: String, channel: String) -> Boolean,
    onToggleChannelMute: (serverId: String, channel: String) -> Unit,
    modifier: Modifier = Modifier
) {
    var joining by remember { mutableStateOf(false) }
    // Which channel's menu is open. Leaving a channel had no button at all
    // before this: you could join from three places and never get out again,
    // which since joining now sets join-on-connect meant permanently.
    var channelMenu by remember { mutableStateOf<String?>(null) }
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
            // Says where to go, now that the two rows that used to say it have
            // gone. Finding a channel is the thing somebody needs first on a
            // network they have just joined, and a sidebar reading "nothing
            // joined yet" and stopping there does not help them do it.
            Text(
                "Nothing joined yet — the + above finds rooms, or joins one by name.",
                color = Overlay,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp)
            )
        }

        for (channel in channels) {
            val selected = store.activeServerId == serverId &&
                store.activeChannel.equals(channel.name, true)
            val muted = serverId != null && isChannelMuted(serverId, channel.name)
            val look = Unread.rowLook(channel.unread, muted, selected)
            val lit = look != Unread.RowLook.QUIET
            val badge = Unread.rowBadge(channel.mentions, muted)

            Box {
                // The same mark the desktop puts at the edge of an unread
                // channel. White text says it too, but a row of names is read
                // down the left edge and this is what the eye lands on first.
                if (look == Unread.RowLook.UNREAD) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.CenterStart)
                            .width(3.dp)
                            .height(8.dp)
                            .clip(RoundedCornerShape(topEnd = 3.dp, bottomEnd = 3.dp))
                            .background(Text0)
                    )
                }

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 1.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (selected) Surface0 else Color.Transparent)
                        .combinedClickable(
                            onClick = { serverId?.let { onSelect(it, channel.name) } },
                            onLongClick = { channelMenu = channel.name }
                        )
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "#",
                        color = if (lit) Subtext else Overlay,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.width(22.dp)
                    )
                    Text(
                        channel.name.removePrefix("#"),
                        color = if (lit) Text0 else Subtext,
                        fontWeight = if (look == Unread.RowLook.UNREAD) {
                            FontWeight.SemiBold
                        } else {
                            FontWeight.Normal
                        },
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    // A number means somebody said your name. Unread on its own
                    // is the white, and putting a count there as well made the
                    // two indistinguishable without reading them.
                    badge?.let { CountBadge(it.count, if (it.muted) Overlay else Red) }
                }

                ChannelMenu(
                    name = channel.name,
                    muted = muted,
                    expanded = channelMenu == channel.name,
                    onDismiss = { channelMenu = null },
                    onMute = {
                        channelMenu = null
                        serverId?.let { onToggleChannelMute(it, channel.name) }
                    },
                    onLeave = {
                        channelMenu = null
                        serverId?.let { onLeave(it, channel.name) }
                    }
                )
            }
        }

        // Both of these used to be spelled out here as their own rows, because
        // the "+" beside the heading was a bare glyph whose sheet hid the room
        // list one tap further down. The sheet names both now and is where the
        // "+" goes, so two more rows saying the same thing is a list of four
        // things where there are two.
        //
        // The empty state below still says it in words, which is the case the
        // spelled-out rows were really for: a network you have just joined and
        // have not found anything on yet.

        // Where the server itself talks. Listed once it has said something,
        // under its own heading rather than among the people — its connection
        // banner is not a conversation, but it is worth being able to read.
        val services = serverId?.let { store.servicesOn(it) }.orEmpty()
        if (services.isNotEmpty()) {
            SectionHeader("Network services")

            for (who in services) {
                val selected = store.activeChannel.equals(who, true)
                val entry = store.channelsFor(serverId!!).first { it.name.equals(who, true) }
                val muted = isChannelMuted(serverId, who)
                val look = Unread.rowLook(entry.unread, muted, selected)
                val badge = Unread.rowBadge(entry.mentions, muted)

                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 1.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(if (selected) Surface0 else Color.Transparent)
                        .clickable { onSelect(serverId, who) }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "\u2699",
                        color = if (look != Unread.RowLook.QUIET) Subtext else Overlay,
                        fontSize = 15.sp,
                        modifier = Modifier.width(22.dp)
                    )
                    Text(
                        who,
                        color = if (look != Unread.RowLook.QUIET) Text0 else Subtext,
                        fontWeight = if (look == Unread.RowLook.UNREAD) {
                            FontWeight.SemiBold
                        } else {
                            FontWeight.Normal
                        },
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f)
                    )
                    badge?.let { CountBadge(it.count, if (it.muted) Overlay else Red) }
                }
            }

            Spacer(Modifier.height(8.dp))
        }

        if (serverId != null && store.hasConsole(serverId)) {
            val selected = store.activeChannel == SERVER_CONSOLE
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 1.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(if (selected) Surface0 else Color.Transparent)
                    .clickable { onSelect(serverId, SERVER_CONSOLE) }
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    "!",
                    color = Overlay,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.width(22.dp)
                )
                Text(
                    "Server messages",
                    color = if (selected) Text0 else Subtext,
                    fontSize = 15.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }

        Spacer(Modifier.height(16.dp))
    }
}

/**
 * Everybody who has written to you, across every network, behind one button.
 *
 * The desktop has had this since it had a rail: people are not a property of a
 * network you happen to be looking at. The phone used to list them under that
 * network's channels, so a message from somebody on a network you were not
 * looking at was filed somewhere you had to already know to check — which for
 * a direct message is exactly backwards.
 *
 * The network is still shown against each name, because it is part of who they
 * are: `robin` on Libera and `robin` on OFTC are two people, and a row that
 * omits it is a row you can answer wrongly.
 */
@Composable
private fun DirectMessageList(
    store: SwitchboardStore,
    onSelect: (serverId: String, channel: String) -> Unit,
    modifier: Modifier = Modifier
) {
    val conversations = store.allDirectMessages()
    var starting by remember { mutableStateOf(false) }
    var who by remember { mutableStateOf("") }
    // Only where it tells you something. With one network on the phone every
    // row would carry the same word, which is noise on all of them; with two
    // it is the difference between two people. The desktop draws the line in
    // the same place.
    val showNetwork = store.servers.size > 1

    Column(modifier = modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "Messages",
                color = Text0,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f)
            )
            // The desktop has always been able to start one. Without this the
            // phone could only ever answer, which also meant it could not talk
            // to a network's services until they spoke first — and being told
            // to identify is precisely the moment you need to reply.
            Text(
                "+",
                color = Green,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(RoundedCornerShape(6.dp))
                    .clickable { starting = !starting }
                    .padding(horizontal = 10.dp, vertical = 2.dp)
            )
        }

        if (starting) {
            val serverId = store.activeServerId
            OutlinedTextField(
                value = who,
                onValueChange = { who = it },
                singleLine = true,
                placeholder = { Text("Who? — a nickname, or NickServ", color = Overlay) },
                colors = TextFieldDefaults.colors(
                    focusedTextColor = Text0,
                    unfocusedTextColor = Text0,
                    focusedContainerColor = Surface0,
                    unfocusedContainerColor = Surface0
                ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = {
                    val name = who.trim()
                    if (name.isNotEmpty() && serverId != null) {
                        store.openConversation(serverId, name)
                        // A service is listed under its network rather than
                        // here, so staying in Messages would show an empty
                        // list straight after opening something.
                        if (Services.isServices(name)) store.dmMode = false
                        onSelect(serverId, name)
                        who = ""
                        starting = false
                    }
                }),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
            )

            if (serverId == null) {
                Text(
                    "Pick a network first — a name on IRC belongs to one.",
                    color = Overlay,
                    fontSize = 12.sp,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
                )
            }
            Spacer(Modifier.height(8.dp))
        }

        if (conversations.isEmpty()) {
            Text(
                "Nobody has written to you yet. When somebody does, the " +
                    "conversation shows up here whichever network it is on.",
                color = Subtext,
                fontSize = 13.sp,
                lineHeight = 18.sp,
                modifier = Modifier.padding(horizontal = 16.dp)
            )
            return@Column
        }

        for (dm in conversations) {
            val selected = store.activeServerId == dm.serverId &&
                store.activeChannel.equals(dm.nick, true)
            val unread = dm.unread > 0
            val profile = store.metadataFor(dm.serverId, dm.nick)

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 1.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(if (selected) Surface0 else Color.Transparent)
                    .clickable { onSelect(dm.serverId, dm.nick) }
                    .padding(horizontal = 8.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Avatar(
                    dm.nick,
                    32.dp,
                    metadataColor(profile.color) ?: nickColor(dm.nick),
                    avatar = profile.avatar
                )
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        profile.displayName?.takeIf { it.isNotBlank() } ?: dm.nick,
                        color = if (selected || unread) Text0 else Subtext,
                        fontWeight = if (unread) FontWeight.SemiBold else FontWeight.Normal,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (showNetwork) {
                        Text(
                            dm.serverName,
                            color = Overlay,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                if (dm.unread > 0) CountBadge(dm.unread)
            }
        }

        Spacer(Modifier.height(16.dp))
    }
}

/** What you can do to a channel you are in */
@Composable
private fun ChannelMenu(
    name: String,
    muted: Boolean,
    expanded: Boolean,
    onDismiss: () -> Unit,
    onMute: () -> Unit,
    onLeave: () -> Unit
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.background(Surface0)
    ) {
        DropdownMenuItem(
            text = { Text(name, color = Overlay, fontSize = 12.sp, fontWeight = FontWeight.Bold) },
            onClick = {},
            enabled = false
        )
        DropdownMenuItem(
            text = { Text(if (muted) "Unmute" else "Mute", color = Text0, fontSize = 14.sp) },
            onClick = onMute
        )
        DropdownMenuItem(
            text = { Text("Leave", color = Red, fontSize = 14.sp) },
            onClick = onLeave
        )
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
    pairedWithDesktop: Boolean,
    vaultUnlocked: Boolean,
    onOpenSettings: () -> Unit,
    onEditProfile: () -> Unit,
    onToggleAway: (serverId: String, away: Boolean) -> Unit
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
        Box(
            modifier = Modifier.clip(CircleShape).clickable(onClick = onEditProfile),
            contentAlignment = Alignment.BottomEnd
        ) {
            Avatar(
                nick,
                34.dp,
                metadataColor(profile?.color) ?: nickColor(nick),
                avatar = profile?.avatar
            )
            if (server?.away == true) {
                Box(
                    modifier = Modifier
                        .size(12.dp)
                        .background(Crust, CircleShape)
                        .padding(2.dp)
                        .background(Yellow, CircleShape)
                )
            }
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
                ModePill(mode, takingOver, pairedWithDesktop)
            }
            Text(
                modeDetail,
                color = Overlay,
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        // Away, which is the state a phone is in more than any other device and
        // which you could only reach by typing `/away` — a command this client
        // could not even run until recently.
        server?.let {
            Text(
                if (it.away) "Back" else "Away",
                color = if (it.away) Yellow else Overlay,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .clickable { onToggleAway(it.id, !it.away) }
                    .padding(horizontal = 10.dp, vertical = 6.dp)
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
fun ModePill(
    mode: EngineMode,
    takingOver: Boolean = false,
    /**
     * Whether a desktop is part of this at all.
     *
     * "TAKING OVER" is a sentence about two devices. On a phone that has never
     * been paired it names something the user has no idea about and cannot act
     * on, while what is actually happening — a socket dialling — has a perfectly
     * ordinary name.
     */
    pairedWithDesktop: Boolean = false
) = when {
    mode == EngineMode.HOLDING -> Pill("LIVE", Green)
    mode == EngineMode.FOLLOWING -> Pill("DESKTOP", Blue)
    takingOver && pairedWithDesktop -> Pill("TAKING OVER", Yellow)
    takingOver -> Pill("CONNECTING", Yellow)
    else -> Pill("OFFLINE", Overlay)
}
