package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.switchboard.android.Member
import org.switchboard.android.SwitchboardStore

/**
 * Who is in the channel.
 *
 * Sectioned by rank, which is IRC's own idea of a role and the closest thing it
 * has to Discord's coloured role groups. Anyone with a mode prefix appears
 * above the room, because that is the person you look for when something needs
 * doing.
 */
@Composable
fun MemberList(
    store: SwitchboardStore,
    onSelect: (Member) -> Unit,
    modifier: Modifier = Modifier
) {
    val serverId = store.activeServerId
    val channel = store.activeChannel
    val members = if (serverId != null && channel != null) {
        store.membersFor(serverId, channel)
    } else {
        emptyList()
    }

    val ranked = members.sortedWith(
        compareByDescending<Member> { rank(it) }.thenBy { it.nick.lowercase() }
    )
    val staff = ranked.filter { rank(it) > 0 }
    val rest = ranked.filter { rank(it) == 0 }

    Column(modifier = modifier.fillMaxSize().background(Mantle)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    channel ?: "Members",
                    color = Text0,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Text("${members.size} here", color = Overlay, fontSize = 11.sp)
            }
        }
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Crust))

        LazyColumn(modifier = Modifier.fillMaxSize()) {
            if (staff.isNotEmpty()) {
                item { GroupHeader(roleName(staff.first()), staff.size) }
                items(staff.size) { MemberRow(store, serverId, staff[it], onSelect) }
            }
            if (rest.isNotEmpty()) {
                item { GroupHeader("Online", rest.size) }
                items(rest.size) { MemberRow(store, serverId, rest[it], onSelect) }
            }
            if (members.isEmpty()) {
                item {
                    Text(
                        "Nobody here yet.",
                        color = Overlay,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }
        }
    }
}

@Composable
private fun GroupHeader(label: String, count: Int) {
    Text(
        "${label.uppercase()} — $count",
        color = Overlay,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp)
    )
}

@Composable
private fun MemberRow(
    store: SwitchboardStore,
    serverId: String?,
    member: Member,
    onSelect: (Member) -> Unit
) {
    val profile = serverId?.let { store.metadataFor(it, member.nick) }
    val color = metadataColor(profile?.color) ?: nickColor(member.nick)
    val name = profile?.displayName?.takeIf { it.isNotBlank() } ?: member.nick

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onSelect(member) }
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(contentAlignment = Alignment.BottomEnd) {
            Avatar(member.nick, 32.dp, color)
            // Away is IRC's only presence signal, and it is worth showing
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .background(Mantle, CircleShape)
                    .padding(2.dp)
                    .background(if (member.away) Yellow else Green, CircleShape)
            )
        }

        Spacer(Modifier.width(10.dp))

        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp)
            ) {
                Text(
                    name,
                    color = if (member.away) Overlay else Text0,
                    fontSize = 14.sp,
                    fontWeight = if (rank(member) > 0) FontWeight.SemiBold else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false)
                )
                if (member.isBot) Pill("BOT", Blue)
                member.prefixes.firstOrNull()?.let { Pill(it, Mauve) }
            }

            // The custom status line, which is the whole point of the metadata
            profile?.status?.takeIf { it.isNotBlank() }?.let {
                Text(it, color = Overlay, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Channel modes, most privileged first: ~ & @ % + */
private fun rank(member: Member): Int = when (member.prefixes.firstOrNull()) {
    "~" -> 5
    "&" -> 4
    "@" -> 3
    "%" -> 2
    "+" -> 1
    else -> 0
}

private fun roleName(member: Member): String = when (member.prefixes.firstOrNull()) {
    "~" -> "Founders"
    "&" -> "Admins"
    "@" -> "Operators"
    "%" -> "Half-ops"
    "+" -> "Voiced"
    else -> "Online"
}
