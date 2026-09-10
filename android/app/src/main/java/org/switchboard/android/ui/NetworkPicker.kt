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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.switchboard.android.KnownNetwork
import org.switchboard.android.KnownNetworks

/**
 * Somewhere to start, for somebody with no networks.
 *
 * IRC's worst moment is the first one. A client that opens on an empty screen
 * and a box wanting a hostname is asking a question most people cannot answer,
 * and nothing in the app helps them answer it — you are expected to already
 * know that irc.libera.chat exists, and which of the dozen networks is the one
 * your people are on.
 *
 * So: the twelve that most people mean, with what each is for. Typing an
 * address by hand is still one tap away, because a list is a starting point and
 * not a directory.
 */
@Composable
fun NetworkPicker(
    onPick: (KnownNetwork) -> Unit,
    onByHand: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var query by remember { mutableStateOf("") }
    val shown = remember(query) { KnownNetworks.matching(context, query) }

    Column(modifier = Modifier.fillMaxSize().background(Base)) {
        Header("Choose a network", onBack)

        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = {
                Text("Search by name, subject or where it is", color = Overlay, fontSize = 14.sp)
            },
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
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp)
        )

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
        ) {
            if (shown.isEmpty()) {
                Text(
                    "Nothing here matches “$query”. Plenty of networks are not on " +
                        "this list — put its address in by hand.",
                    color = Overlay,
                    fontSize = 14.sp,
                    lineHeight = 20.sp,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 28.dp)
                )
            }

            for (network in shown) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPick(network) }
                        .padding(horizontal = 20.dp, vertical = 12.dp)
                ) {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            network.name,
                            color = Text0,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(network.region, color = Overlay, fontSize = 11.sp)
                    }
                    Spacer(Modifier.height(3.dp))
                    Text(network.description, color = Subtext, fontSize = 13.sp, lineHeight = 18.sp)
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${network.host}:${network.port}" + if (network.tls) " · TLS" else "",
                            color = Overlay,
                            fontSize = 11.sp
                        )
                        // Said out loud rather than left as an absence. A
                        // network with no encrypted port is a real choice
                        // somebody is making, and they can only make it if we
                        // tell them.
                        if (!network.tls) {
                            Spacer(Modifier.width(6.dp))
                            Text("not encrypted", color = Yellow, fontSize = 11.sp)
                        }
                    }
                }
                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Mantle))
            }

            Spacer(Modifier.height(16.dp))
            Text(
                "I know the address — enter it myself",
                color = Blue,
                fontSize = 14.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onByHand)
                    .padding(vertical = 14.dp)
            )
            Text(
                "Checked ${KnownNetworks.checkedAt(context)}",
                color = Overlay,
                fontSize = 11.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}
