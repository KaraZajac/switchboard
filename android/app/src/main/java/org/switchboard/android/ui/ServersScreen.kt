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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.addServer
import org.switchboard.android.canEditServers
import org.switchboard.android.connectServer
import org.switchboard.android.disconnectServer
import org.switchboard.android.irc.ServerConfig
import org.switchboard.android.listServers
import org.switchboard.android.removeServer
import org.switchboard.android.updateServer
import androidx.compose.ui.text.font.FontFamily
import org.switchboard.android.irc.CertFp

/**
 * The networks.
 *
 * The phone could read every network the desktop was on and add none of its
 * own, which made it a viewer rather than a client. Everything written here goes
 * into the shared vault, so a network added on the phone is on the desktop too —
 * that is the whole point of there being one config.
 */
@Composable
fun ServersScreen(
    engine: SwitchboardEngine,
    onClose: () -> Unit,
    /**
     * Open straight into this network's settings.
     *
     * Set when someone long-pressed it on the rail and chose Edit. Closing the
     * form then goes back where they came from rather than dropping them in a
     * list they never asked for.
     */
    editServerId: String? = null
) {
    var editing by remember { mutableStateOf<ServerConfig?>(null) }
    var adding by remember { mutableStateOf(false) }
    var servers by remember { mutableStateOf<List<ServerConfig>>(emptyList()) }
    var revision by remember { mutableStateOf(0) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(revision, engine.vaultVersion, engine.mode) {
        servers = engine.listServers()
    }

    LaunchedEffect(editServerId, servers) {
        if (editServerId != null && editing == null) {
            editing = servers.find { it.id == editServerId }
        }
    }

    // Back closes the form, not the whole screen. Without this the app-level
    // handler wins and a half-filled form vanishes to the conversation.
    //
    // Unless the form *is* the screen: arriving from a long-press on the rail
    // there is no list behind it to go back to, and dropping the user into one
    // they never asked for is the flow this shortcut exists to avoid.
    val cameStraightHere = editServerId != null && editing?.id == editServerId
    androidx.activity.compose.BackHandler(enabled = adding || editing != null) {
        adding = false
        editing = null
        if (cameStraightHere) onClose()
    }

    if (adding || editing != null) {
        ServerForm(
            engine = engine,
            existing = editing,
            onDone = {
                adding = false
                editing = null
                revision++
                if (cameStraightHere) onClose()
            }
        )
        return
    }

    Column(modifier = Modifier.fillMaxSize().background(Base)) {
        Header("Networks", onClose)

        if (!engine.canEditServers) {
            Text(
                "Unlock the shared config to add or change networks.",
                color = Yellow,
                fontSize = 13.sp,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)
            )
        }

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
        ) {
            if (servers.isEmpty()) {
                Text(
                    "No networks yet.",
                    color = Overlay,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp)
                )
            }

            for (server in servers) {
                val live = engine.store.servers[server.id]?.connected == true
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = engine.canEditServers) { editing = server }
                        .padding(horizontal = 20.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(9.dp)
                            .background(if (live) Green else Overlay, CircleShape)
                    )
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            server.name.ifBlank { server.host },
                            color = Text0,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            "${server.host}:${server.port}${if (server.tls) " · TLS" else ""} · ${server.nick}",
                            color = Overlay,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    Text(
                        if (live) "Disconnect" else "Connect",
                        color = if (live) Red else Blue,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier
                            .clip(RoundedCornerShape(14.dp))
                            .clickable {
                                if (live) engine.disconnectServer(server.id)
                                else engine.connectServer(server.id)
                            }
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
                Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(Mantle))
            }

            Spacer(Modifier.height(20.dp))
            Button(
                onClick = { adding = true },
                enabled = engine.canEditServers,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Blue,
                    contentColor = Crust,
                    disabledContainerColor = Surface0,
                    disabledContentColor = Overlay
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).height(48.dp)
            ) {
                Text("Add a network", fontWeight = FontWeight.Bold, fontSize = 15.sp)
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

/**
 * Adding or editing one network.
 *
 * The password boxes start empty even when a password is set, and an empty box
 * is left alone rather than saved — otherwise renaming a network would quietly
 * log you out of it. The hint under each says so, because a blank box that means
 * "unchanged" is not something anyone should have to guess.
 */
@Composable
private fun ServerForm(
    engine: SwitchboardEngine,
    existing: ServerConfig?,
    onDone: () -> Unit
) {
    var name by remember { mutableStateOf(existing?.name.orEmpty()) }
    var host by remember { mutableStateOf(existing?.host.orEmpty()) }
    var port by remember { mutableStateOf((existing?.port ?: 6697).toString()) }
    var tls by remember { mutableStateOf(existing?.tls ?: true) }
    var nick by remember { mutableStateOf(existing?.nick.orEmpty()) }
    var saslUser by remember { mutableStateOf(existing?.saslUsername.orEmpty()) }
    var saslPass by remember { mutableStateOf("") }
    var clientCert by remember { mutableStateOf(existing?.clientCert.orEmpty()) }
    var autoJoin by remember { mutableStateOf(existing?.autoJoin?.joinToString(", ").orEmpty()) }
    var autoConnect by remember { mutableStateOf(existing?.autoConnect ?: true) }
    var confirmingRemoval by remember { mutableStateOf(false) }
    // A new network starts at the list; editing one never does.
    var picking by remember { mutableStateOf(existing == null) }
    val scope = rememberCoroutineScope()

    val valid = host.isNotBlank() && nick.isNotBlank() && port.toIntOrNull() != null

    if (picking) {
        NetworkPicker(
            onPick = { network ->
                // Auto-connect, because somebody who has just chosen a network
                // from a list means to go there — a server that sits
                // disconnected waiting to be told is a puzzle, not a client.
                name = network.name
                host = network.host
                port = network.port.toString()
                tls = network.tls
                autoConnect = true
                autoJoin = network.channels.joinToString(", ")
                picking = false
            },
            onByHand = { picking = false },
            onBack = onDone
        )
        return
    }

    Column(modifier = Modifier.fillMaxSize().background(Base)) {
        Header(if (existing == null) "Add a network" else "Edit network", onDone)

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 20.dp)
        ) {
            Field("Name", "Libera.Chat", name) { name = it }
            Field("Server", "irc.libera.chat", host) { host = it }
            Field("Port", "6697", port, KeyboardType.Number) { port = it }

            Toggle("Use TLS", "Encrypted. Turn this off only for a plain-text server.", tls) {
                tls = it
                // The conventional ports, so the two settings stay consistent
                if (port == "6697" || port == "6667") port = if (it) "6697" else "6667"
            }

            Field("Nickname", "yourname", nick) { nick = it }
            Field("Account (SASL)", "Leave blank if you do not have one", saslUser) { saslUser = it }
            Field(
                "Account password",
                if (existing != null) "Unchanged unless you type here" else "Your account password",
                saslPass,
                secret = true
            ) { saslPass = it }

            ClientCertificate(clientCert) { clientCert = it }

            Field("Join on connect", "#one, #two", autoJoin) { autoJoin = it }

            Toggle("Connect automatically", "Bring this network up on its own.", autoConnect) {
                autoConnect = it
            }

            Spacer(Modifier.height(20.dp))
            Button(
                onClick = {
                    scope.launch {
                        val config = ServerConfig(
                            id = existing?.id.orEmpty(),
                            name = name.ifBlank { host },
                            host = host.trim(),
                            port = port.toIntOrNull() ?: 6697,
                            tls = tls,
                            nick = nick.trim(),
                            username = existing?.username.orEmpty(),
                            realname = existing?.realname.orEmpty(),
                            saslMechanism = when {
                                // A certificate is the credential, and EXTERNAL
                                // is the only mechanism that uses one
                                clientCert.isNotBlank() -> "EXTERNAL"
                                saslUser.isBlank() -> null
                                existing?.saslMechanism != null -> existing.saslMechanism
                                else -> "PLAIN"
                            },
                            saslUsername = saslUser.trim().ifBlank { null },
                            // Blank means "leave it alone"; the engine drops it
                            saslPassword = saslPass.ifBlank { existing?.saslPassword },
                            clientCert = clientCert.trim().ifBlank { null },
                            password = existing?.password,
                            identifyCommand = existing?.identifyCommand,
                            autoConnect = autoConnect,
                            autoJoin = autoJoin.split(",")
                                .map { it.trim() }
                                .filter { it.isNotEmpty() }
                                .map { if (it.startsWith("#") || it.startsWith("&")) it else "#$it" },
                            sortOrder = existing?.sortOrder ?: 0,
                            websocketUrl = existing?.websocketUrl,
                            avatarUrl = existing?.avatarUrl,
                            profile = existing?.profile.orEmpty(),
                            preAwayMessage = existing?.preAwayMessage
                        )
                        if (existing == null) engine.addServer(config)
                        else engine.updateServer(existing.id, config)
                        onDone()
                    }
                },
                enabled = valid,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Blue,
                    contentColor = Crust,
                    disabledContainerColor = Surface0,
                    disabledContentColor = Overlay
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp)
            ) {
                Text(
                    if (existing == null) "Add network" else "Save changes",
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
            }

            if (existing != null) {
                Spacer(Modifier.height(12.dp))
                Text(
                    if (confirmingRemoval) "Tap again to remove ${existing.name}" else "Remove this network",
                    color = Red,
                    fontSize = 14.sp,
                    fontWeight = if (confirmingRemoval) FontWeight.Bold else FontWeight.Normal,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            if (!confirmingRemoval) {
                                confirmingRemoval = true
                            } else {
                                scope.launch {
                                    engine.removeServer(existing.id)
                                    onDone()
                                }
                            }
                        }
                        .padding(vertical = 14.dp),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center
                )
            }
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
internal fun Header(title: String, onBack: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Mantle)
            .statusBarsPadding()
            .padding(horizontal = 6.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            Icons.AutoMirrored.Filled.ArrowBack,
            contentDescription = "Back",
            tint = Subtext,
            modifier = Modifier.size(42.dp).clickable(onClick = onBack).padding(10.dp)
        )
        Text(title, color = Text0, fontSize = 17.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun Field(
    label: String,
    hint: String,
    value: String,
    keyboard: KeyboardType = KeyboardType.Text,
    secret: Boolean = false,
    onChange: (String) -> Unit
) {
    Spacer(Modifier.height(16.dp))
    Text(label.uppercase(), color = Overlay, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(6.dp))
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        placeholder = { Text(hint, color = Overlay, fontSize = 14.sp) },
        singleLine = true,
        shape = RoundedCornerShape(10.dp),
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard, imeAction = ImeAction.Next),
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
}

@Composable
private fun Toggle(label: String, detail: String, on: Boolean, onChange: (Boolean) -> Unit) {
    Spacer(Modifier.height(18.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(label, color = Text0, fontSize = 15.sp)
            Text(detail, color = Overlay, fontSize = 11.sp, lineHeight = 15.sp)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = on,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = Crust,
                checkedTrackColor = Blue,
                uncheckedThumbColor = Overlay,
                uncheckedTrackColor = Surface0,
                uncheckedBorderColor = Surface1
            )
        )
    }
}

/**
 * Somewhere to put a client certificate.
 *
 * SASL EXTERNAL proves who you are with the certificate the TLS handshake
 * already presented, so there is no password anywhere — which is why the
 * networks that offer it call it the strongest thing they have. It needs the
 * certificate and its key, and the fingerprint of the certificate registered
 * with the network's services.
 *
 * The fingerprint is shown here because working it out is most of why nobody
 * uses CertFP: every guide ends with an openssl incantation whose output you
 * are then meant to carry somewhere else.
 */
@Composable
private fun ClientCertificate(value: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(value.isNotBlank()) }
    val problem = remember(value) { CertFp.problem(value) }
    val fingerprint = remember(value) { CertFp.fingerprint(value) }

    Column(modifier = Modifier.padding(top = 14.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth().clickable { open = !open },
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                "CERTIFICATE (SASL EXTERNAL)",
                color = Subtext,
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f)
            )
            Text(if (open) "Hide" else "Set up", color = Blue, fontSize = 13.sp)
        }

        if (open) {
        Spacer(Modifier.height(8.dp))
        Field(
            "",
            "-----BEGIN CERTIFICATE-----  …  -----BEGIN PRIVATE KEY-----  …",
            value
        ) { onChange(it) }

        when {
            problem != null -> Text(
                problem,
                color = Yellow,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 6.dp)
            )

            fingerprint != null -> Column(modifier = Modifier.padding(top = 8.dp)) {
                Text(
                    "Tell the network this is you, once you are connected and logged in:",
                    color = Subtext,
                    fontSize = 12.sp
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "/msg NickServ CERT ADD $fingerprint",
                    color = Green,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace
                )
            }

            else -> Text(
                "The certificate and its key, both in one box. Make one with:\n" +
                    "openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes " +
                    "-keyout cert.pem -out cert.pem",
                color = Overlay,
                fontSize = 12.sp,
                modifier = Modifier.padding(top = 6.dp)
            )
        }
        }
    }
}
