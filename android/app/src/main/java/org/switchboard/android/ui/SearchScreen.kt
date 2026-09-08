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
    var thisChannelOnly by remember { mutableStateOf(false) }

    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    // Search as you type, once there is enough to be worth searching for, and
    // after a pause — every keystroke would be a round trip to the desktop.
    LaunchedEffect(query, thisChannelOnly, serverId) {
        if (serverId == null || query.trim().length < 2) {
            results = emptyList()
            searched = false
            return@LaunchedEffect
        }
        kotlinx.coroutines.delay(300)
        searching = true
        results = engine.searchMessages(
            serverId,
            query,
            if (thisChannelOnly) store.activeChannel else null
        )
        searching = false
        searched = true
    }

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
            Toggle("Everywhere", !thisChannelOnly) { thisChannelOnly = false }
            Spacer(Modifier.width(8.dp))
            store.activeChannel?.let { Toggle(it, thisChannelOnly) { thisChannelOnly = true } }
            Spacer(Modifier.weight(1f))
            Text(
                if (engine.mode == EngineMode.HOLDING) "this session" else "full history",
                color = Overlay,
                fontSize = 11.sp
            )
        }

        when {
            searching -> Note("Searching…")
            query.trim().length < 2 -> Note("Type at least two characters.")
            searched && results.isEmpty() -> Note("Nothing matched “${query.trim()}”.")
            else -> LazyColumn(modifier = Modifier.fillMaxSize().navigationBarsPadding()) {
                items(results.size) { index ->
                    val hit = results[index]
                    Hit(engine, hit, query.trim()) {
                        serverId?.let { onOpen(it, hit.channel) }
                    }
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
private fun Hit(engine: SwitchboardEngine, hit: SearchHit, term: String, onClick: () -> Unit) {
    val serverId = engine.store.activeServerId
    val profile = serverId?.let { engine.store.metadataFor(it, hit.nick) }
    val colour = metadataColor(profile?.color) ?: nickColor(hit.nick)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(hit.nick, 20.dp, colour)
            Spacer(Modifier.width(8.dp))
            Text(
                profile?.displayName?.takeIf { it.isNotBlank() } ?: hit.nick,
                color = colour,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold
            )
            Spacer(Modifier.width(8.dp))
            Text(hit.channel, color = Overlay, fontSize = 12.sp)
            Spacer(Modifier.weight(1f))
            Text(whenItWas(hit.timestamp), color = Overlay, fontSize = 11.sp)
        }
        Spacer(Modifier.height(4.dp))
        Text(
            highlighted(hit.content, term),
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
    Instant.parse(timestamp).atZone(ZoneId.systemDefault()).format(DAY_FORMAT)
}.getOrDefault("")
