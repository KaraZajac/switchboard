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
import androidx.compose.foundation.text.KeyboardActions
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.switchboard.android.EngineMode
import org.switchboard.android.SearchHit
import org.switchboard.android.irc.Search
import org.switchboard.android.searchEverywhere
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.searchMessages
import java.time.Instant
import java.time.ZoneId

/**
 * Finding something that was said.
 *
 * The desktop searches its whole database; a phone holding the connections has
 * only this session in memory. Both are useful and they are not the same thing,
 * so the screen says which one answered rather than letting a thin result read
 * as "it isn't there".
 */
@Composable
fun SearchScreen(engine: SwitchboardEngine, onOpen: (String, String) -> Unit, onClose: () -> Unit) {
    val store = engine.store
    val serverId = store.activeServerId

    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchHit>>(emptyList()) }
    var searched by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    /*
     * Everywhere by default, and everywhere means every network.
     *
     * It used to mean "everywhere on this network", which is the question
     * nobody has: you remember what somebody said, not which network they said
     * it on. Narrowing is a tap away and the tap is obvious.
     */
    var scope by remember { mutableStateOf(Scope.EVERYWHERE) }
    var everywhere by remember { mutableStateOf<List<Search.Found>>(emptyList()) }

    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    // Search as you type, once there is enough to be worth searching for, and
    // after a pause — every keystroke would be a round trip to the desktop.
    LaunchedEffect(query, scope, serverId) {
        if (query.trim().length < 2 || (scope != Scope.EVERYWHERE && serverId == null)) {
            results = emptyList()
            everywhere = emptyList()
            searched = false
            return@LaunchedEffect
        }
        kotlinx.coroutines.delay(300)
        searching = true

        if (scope == Scope.EVERYWHERE) {
            everywhere = engine.searchEverywhere(query)
            results = emptyList()
        } else {
            results = engine.searchMessages(
                serverId!!,
                query,
                if (scope == Scope.CHANNEL) store.activeChannel else null
            )
            everywhere = emptyList()
        }

        searching = false
        searched = true
    }

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
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Search messages", color = Overlay, fontSize = 15.sp) },
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {}),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Surface0,
                    unfocusedContainerColor = Surface0,
                    focusedTextColor = Text0,
                    unfocusedTextColor = Text0,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    cursorColor = Blue
                ),
                modifier = Modifier.weight(1f).focusRequester(focus)
            )
        }

        // Scope, and where the answer is coming from
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Toggle("Everywhere", scope == Scope.EVERYWHERE) { scope = Scope.EVERYWHERE }
            Spacer(Modifier.width(8.dp))
            store.servers[serverId]?.let { server ->
                Toggle(server.name.ifBlank { server.host }, scope == Scope.NETWORK) {
                    scope = Scope.NETWORK
                }
                Spacer(Modifier.width(8.dp))
            }
            store.activeChannel?.let { Toggle(it, scope == Scope.CHANNEL) { scope = Scope.CHANNEL } }
            Spacer(Modifier.weight(1f))
            Text(
                if (engine.mode == EngineMode.HOLDING) "this session" else "full history",
                color = Overlay,
                fontSize = 11.sp
            )
        }

        val nothing = if (scope == Scope.EVERYWHERE) everywhere.isEmpty() else results.isEmpty()

        when {
            searching -> Note("Searching…")
            query.trim().length < 2 -> Note("Type at least two characters.")
            searched && nothing -> Note("Nothing matched “${query.trim()}”.")
            scope == Scope.EVERYWHERE ->
                LazyColumn(modifier = Modifier.fillMaxSize().navigationBarsPadding()) {
                    items(everywhere.size) { index ->
                        val found = everywhere[index]
                        // `#channel@network`, because the network is no longer
                        // implied by what you have open
                        Hit(
                            engine = engine,
                            serverId = found.serverId,
                            where = Search.whereSaid(found.channel, found.network),
                            nick = found.nick,
                            content = found.content,
                            timestamp = found.timestamp,
                            term = query.trim()
                        ) { onOpen(found.serverId, found.channel) }
                    }
                }
            else -> LazyColumn(modifier = Modifier.fillMaxSize().navigationBarsPadding()) {
                items(results.size) { index ->
                    val hit = results[index]
                    Hit(
                        engine = engine,
                        serverId = serverId.orEmpty(),
                        where = hit.channel,
                        nick = hit.nick,
                        content = hit.content,
                        timestamp = hit.timestamp,
                        term = query.trim()
                    ) { serverId?.let { onOpen(it, hit.channel) } }
                }
            }
        }
    }
}

@Composable
private fun Toggle(label: String, on: Boolean, onClick: () -> Unit) {
    Text(
        label,
        color = if (on) Crust else Subtext,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .clip(RoundedCornerShape(20.dp))
            .background(if (on) Blue else Surface0)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp)
    )
}

@Composable
private fun Note(text: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Text(text, color = Overlay, fontSize = 14.sp, modifier = Modifier.padding(top = 48.dp))
    }
}

/** One result: who said it, where, and the matched words picked out */
@Composable
private fun Hit(
    engine: SwitchboardEngine,
    serverId: String,
    where: String,
    nick: String,
    content: String,
    timestamp: String,
    term: String,
    onClick: () -> Unit
) {
    val profile = serverId.takeIf { it.isNotEmpty() }?.let { engine.store.metadataFor(it, nick) }
    val colour = metadataColor(profile?.color) ?: nickColor(nick)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(nick, 20.dp, colour, avatar = profile?.avatar)
            Spacer(Modifier.width(8.dp))
            Text(
                profile?.displayName?.takeIf { it.isNotBlank() } ?: nick,
                color = colour,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.width(8.dp))
            Text(where, color = Overlay, fontSize = 12.sp)
            Spacer(Modifier.weight(1f))
            Text(whenItWas(timestamp), color = Overlay, fontSize = 11.sp)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            highlighted(content, term),
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

/** The matched words in bold, so a long line still shows why it is here */
private fun highlighted(content: String, term: String) = buildAnnotatedString {
    if (term.isEmpty()) {
        append(content)
        return@buildAnnotatedString
    }
    var from = 0
    while (true) {
        val at = content.indexOf(term, from, ignoreCase = true)
        if (at < 0) break
        append(content.substring(from, at))
        withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = Yellow)) {
            append(content.substring(at, at + term.length))
        }
        from = at + term.length
    }
    append(content.substring(from))
}

private fun whenItWas(timestamp: String): String = runCatching {
    runCatching { Instant.parse(timestamp).atZone(ZoneId.systemDefault()).format(DAY_FORMAT) }
        .getOrDefault("")
}.getOrDefault("")

/** How wide a search is: one channel, one network, or all of them */
private enum class Scope { CHANNEL, NETWORK, EVERYWHERE }
