@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.switchboard.android.ChannelListing
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.listChannels
import org.switchboard.android.irc.Formatting

/**
 * What is on this network.
 *
 * IRC's answer to "what channels exist" is a LIST, and on a real network that is
 * thousands of lines arriving over several seconds. So the list fills as it
 * comes and the filter runs over what has arrived — waiting for the end before
 * showing anything would mean staring at a spinner on exactly the networks
 * where browsing matters most.
 */
@Composable
fun BrowseScreen(
    engine: SwitchboardEngine,
    onJoin: (serverId: String, channel: String) -> Unit,
    onClose: () -> Unit
) {
    val store = engine.store
    val serverId = store.activeServerId
    var filter by remember { mutableStateOf("") }
    // Starts true so the first frame says "asking", not "nothing found" — the
    // request has not even been made when that frame is drawn.
    var asking by remember(serverId) { mutableStateOf(true) }

    LaunchedEffect(serverId) {
        if (serverId == null) {
            asking = false
            return@LaunchedEffect
        }
        engine.listChannels(serverId)
        asking = false
    }

    val joined = serverId?.let { id ->
        store.channelsFor(id).map { it.name.lowercase() }.toSet()
    }.orEmpty()

    val shown = store.channelListing
        // Matched against the topic as it reads: a topic full of colour codes
        // would otherwise match on "4" and never on the word beside it.
        .filter {
            filter.isBlank() || it.name.contains(filter, true) ||
                Formatting.strip(it.topic).contains(filter, true)
        }
        // Busiest first, which is what someone looking for somewhere to talk
        // wants. Ties by name, so a network where every channel has the same
        // count does not come back in a different order every time it is asked.
        .sortedWith(compareByDescending<ChannelListing> { it.users }.thenBy { it.name.lowercase() })

    Column(modifier = Modifier.fillMaxSize().background(Base)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Mantle)
                .statusBarsPadding()
                .padding(horizontal = 6.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = Subtext,
                modifier = Modifier.size(42.dp).clickable(onClick = onClose).padding(10.dp)
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Browse channels",
                    color = Text0,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    when {
                        asking || !store.channelListComplete ->
                            "Asking the network… ${store.channelListing.size} so far"
                        store.channelListing.isEmpty() -> "The network returned nothing"
                        else -> "${store.channelListing.size} channels"
                    },
                    color = Overlay,
                    fontSize = 11.sp
                )
            }
        }

        OutlinedTextField(
            value = filter,
            onValueChange = { filter = it },
            placeholder = { Text("Filter by name or topic", color = Overlay, fontSize = 15.sp) },
            singleLine = true,
            shape = RoundedCornerShape(10.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Surface0,
                unfocusedContainerColor = Surface0,
                focusedTextColor = Text0,
                unfocusedTextColor = Text0,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = Blue
            ),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp)
        )

        if (!asking && shown.isEmpty() && store.channelListComplete) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                Text(
                    if (filter.isBlank()) {
                        "Nothing to browse. Some networks hide their channel list."
                    } else {
                        "Nothing matched “$filter”."
                    },
                    color = Overlay,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(top = 40.dp, start = 32.dp, end = 32.dp)
                )
            }
            return@Column
        }

        LazyColumn(modifier = Modifier.fillMaxSize().navigationBarsPadding()) {
            items(shown.size) { index ->
                Listing(shown[index], joined.contains(shown[index].name.lowercase())) {
                    serverId?.let { onJoin(it, shown[index].name) }
                }
            }
        }
    }
}

@Composable
private fun Listing(entry: ChannelListing, alreadyIn: Boolean, onJoin: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = !alreadyIn, onClick = onJoin)
            .padding(horizontal = 16.dp, vertical = 11.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("#", color = Overlay, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(3.dp))
            Text(
                entry.name.removePrefix("#"),
                color = Text0,
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                // One weight in this row, not two: with a weighted spacer as
                // well, the leftover space was split between them and the Join
                // button came to rest in the middle of the row, at a different
                // place on every line.
                modifier = Modifier.weight(1f)
            )
            Spacer(Modifier.width(10.dp))
            Text(
                "${entry.users}",
                color = Overlay,
                fontSize = 12.sp
            )
            Spacer(Modifier.width(10.dp))
            Text(
                if (alreadyIn) "Joined" else "Join",
                color = if (alreadyIn) Overlay else Crust,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .clip(RoundedCornerShape(14.dp))
                    .background(if (alreadyIn) Color.Transparent else Blue)
                    .padding(horizontal = 12.dp, vertical = 5.dp)
            )
        }
        if (entry.topic.isNotBlank()) {
            Spacer(Modifier.height(3.dp))
            Text(
                formatted(entry.topic),
                color = Subtext,
                fontSize = 13.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
        Spacer(Modifier.height(9.dp))
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Mantle))
    }
}
