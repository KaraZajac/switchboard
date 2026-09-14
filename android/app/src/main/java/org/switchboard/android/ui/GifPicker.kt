package org.switchboard.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.switchboard.android.BuildConfig
import org.switchboard.android.irc.Klipy

/**
 * The GIF picker: the desktop's, on a phone.
 *
 * Same source (Klipy), same five tabs, same choice of which file to send —
 * see [Klipy] — so a GIF picked here is a link the desktop draws, and the
 * other way round. A sheet rather than a panel because that is what a phone
 * has: it takes most of the screen, the keyboard pushes it up, and a swipe
 * dismisses it. What is picked goes straight out as a message, as it does on
 * the desktop; there is nothing to add to a GIF.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun GifPickerSheet(onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var tab by remember { mutableStateOf(Klipy.TABS.first()) }
    var query by remember { mutableStateOf("") }
    var found by remember { mutableStateOf<List<Klipy.Item>>(emptyList()) }
    var asking by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }

    // Trending until something is typed; then the search, a moment after the
    // last keystroke rather than on every one of them.
    LaunchedEffect(tab, query) {
        val wanted = query.trim()
        if (wanted.isNotEmpty()) delay(300)
        asking = true
        failed = false
        val url = if (wanted.isEmpty()) Klipy.trendingUrl(tab.id) else Klipy.searchUrl(tab.id, wanted)
        val answer = withContext(Dispatchers.IO) { runCatching { Klipy.fetch(url, USER_AGENT) } }
        found = answer.getOrElse { failed = true; emptyList() }
        asking = false
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Mantle,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(modifier = Modifier.fillMaxWidth().fillMaxHeight(0.85f).imePadding()) {
            Row(
                modifier = Modifier
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 14.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                for (choice in Klipy.TABS) {
                    val chosen = choice == tab
                    Text(
                        choice.label,
                        color = if (chosen) Crust else Subtext,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .background(if (chosen) Blue else Surface0)
                            .clickable { tab = choice }
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            }

            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Search ${tab.label}", color = Overlay, fontSize = 15.sp) },
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

            Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                when {
                    asking -> CircularProgressIndicator(
                        color = Blue,
                        strokeWidth = 2.dp,
                        modifier = Modifier.size(24.dp).align(Alignment.Center)
                    )

                    failed -> Text(
                        "Klipy did not answer. Try again in a moment.",
                        color = Overlay,
                        fontSize = 14.sp,
                        modifier = Modifier.align(Alignment.Center).padding(32.dp)
                    )

                    found.isEmpty() -> Text(
                        "Nothing for “${query.trim()}”.",
                        color = Overlay,
                        fontSize = 14.sp,
                        modifier = Modifier.align(Alignment.Center).padding(32.dp)
                    )

                    else -> LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                        modifier = Modifier.fillMaxSize()
                    ) {
                        items(found) { item ->
                            AsyncImage(
                                model = item.previewUrl,
                                contentDescription = item.title,
                                contentScale = ContentScale.Crop,
                                modifier = Modifier
                                    .aspectRatio(1f)
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(Surface0)
                                    .clickable { onPick(item.shareUrl) }
                            )
                        }
                    }
                }
            }

            Text(
                "Powered by Klipy",
                color = Overlay,
                fontSize = 11.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(vertical = 8.dp)
            )
        }
    }
}

private val USER_AGENT = "Switchboard/${BuildConfig.VERSION_NAME} (Android)"
