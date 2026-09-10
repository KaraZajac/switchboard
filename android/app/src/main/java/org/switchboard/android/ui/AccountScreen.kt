@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.switchboard.android.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.switchboard.android.SwitchboardEngine
import org.switchboard.android.AccountView
import org.switchboard.android.accountAbilities
import org.switchboard.android.accountView
import org.switchboard.android.identifyWithServices
import org.switchboard.android.logsInAutomatically
import org.switchboard.android.registerAccount
import org.switchboard.android.rememberAccount
import org.switchboard.android.verifyAccount

/**
 * Your account on one network.
 *
 * IRC's identity model is two things wearing one coat: the nick is what you are
 * called this minute, the account is what the network agrees you own. Almost
 * everything people ask NickServ is really a question about the second one, and
 * until now the phone could neither show it nor change it — there was no way to
 * register, no way to log in, and no way to find out whether you were logged in
 * at all.
 *
 * Which half of the screen you get depends on what the network can do:
 *
 * - `draft/account-registration` and the whole thing happens in the client, with
 *   the password saved as SASL so every later connection logs in before it is
 *   even on the network.
 * - Everywhere else, NickServ. Same two boxes, but the client knows the phrase
 *   and saves it as the network's identify command, which is the part people
 *   actually want when they ask for friendly services support.
 */
@Composable
fun AccountScreen(engine: SwitchboardEngine, serverId: String, onClose: () -> Unit) {
    val store = engine.store
    val server = store.servers[serverId]
    val abilities = remember(serverId, server?.connected) { engine.accountAbilities(serverId) }
    val scope = rememberCoroutineScope()

    var account by remember { mutableStateOf(server?.nick.orEmpty()) }
    var password by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var remembered by remember(serverId) { mutableStateOf(engine.logsInAutomatically(serverId)) }

    // The network's answer to REGISTER or VERIFY arrives whenever it arrives.
    val reply = store.accountReply?.takeIf { it.serverId == serverId }
    LaunchedEffect(reply?.at) {
        if (reply != null) busy = false
    }

    Column(modifier = Modifier.fillMaxSize().background(Base)) {
        Header("Account", onClose)

        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 20.dp)
        ) {
            Spacer(Modifier.height(8.dp))
            Standing(server?.nick.orEmpty(), server?.account, server?.connected == true)

            val view = accountView(
                connected = server?.connected == true,
                account = server?.account,
                remembered = remembered,
                canRegister = abilities.canRegister
            )

            when (view) {
                AccountView.OFFLINE -> Explain(
                    "Connect to this network first. What it can do about accounts is " +
                        "something it tells us when we get there."
                )

                AccountView.SETTLED -> Explain(
                    "This network logs you in as ${server?.account} on its own, " +
                        "before anything is said or joined under the wrong name."
                )

                AccountView.REMEMBER -> {
                    Explain(
                        "You are logged in as ${server?.account}, but only for now — " +
                            "the next connection will start out as nobody."
                    )
                    Spacer(Modifier.height(12.dp))
                    Field("Password", "To log in automatically next time", password, secret = true) {
                        password = it
                    }
                    Spacer(Modifier.height(16.dp))
                    Action("Remember this account", enabled = password.isNotBlank() && !busy) {
                        scope.launch {
                            engine.rememberAccount(serverId, server?.account.orEmpty(), password)
                            password = ""
                            remembered = true
                            note = "Saved. This network will log you in on its own from now on."
                        }
                    }
                }

                // The server will make the account itself, and the whole flow
                // fits on one screen.
                AccountView.REGISTER -> {
                    val waitingForCode = reply?.status == "VERIFICATION_REQUIRED"

                    Explain(
                        if (waitingForCode) {
                            "Check your email for a code and put it in below."
                        } else {
                            "This network can register your nick for you. " +
                                "Choose a password and it is yours."
                        }
                    )

                    if (waitingForCode) {
                        Field("Code", "From the email", code, KeyboardType.Number) { code = it }
                        Spacer(Modifier.height(16.dp))
                        Action("Finish", enabled = code.isNotBlank() && !busy) {
                            busy = true
                            engine.verifyAccount(serverId, reply?.account ?: account, code)
                        }
                    } else {
                        Field("Nick to register", "", account) { account = it }
                        Field(
                            "Password",
                            abilities.minPasswordLength
                                ?.let { "At least $it characters" }
                                ?: "Pick something new",
                            password,
                            secret = true
                        ) { password = it }
                        if (abilities.emailRequired) {
                            Field("Email", "This network needs one", email, KeyboardType.Email) {
                                email = it
                            }
                        }

                        Spacer(Modifier.height(16.dp))
                        Action(
                            "Register $account",
                            enabled = !busy && password.length >= (abilities.minPasswordLength ?: 1) &&
                                (!abilities.emailRequired || email.isNotBlank())
                        ) {
                            busy = true
                            store.clearAccountReply()
                            // Saved first: the reply comes back over the same
                            // connection, and a phone that loses the app in
                            // between should still be able to log in.
                            scope.launch {
                                engine.rememberAccount(serverId, account, password)
                                remembered = true
                                engine.registerAccount(
                                    serverId,
                                    email.takeIf { it.isNotBlank() },
                                    password
                                )
                            }
                        }
                    }
                }

                // NickServ, which is most of IRC.
                AccountView.NICKSERV -> {
                    Explain(
                        "This network uses NickServ. Log in here and it will be done for " +
                            "you every time you connect."
                    )
                    Field("Account", "Usually your nick", account) { account = it }
                    Field("Password", "", password, secret = true) { password = it }

                    Spacer(Modifier.height(16.dp))
                    Action(
                        "Log in to NickServ",
                        enabled = account.isNotBlank() && password.isNotBlank() && !busy
                    ) {
                        scope.launch {
                            engine.identifyWithServices(serverId, account, password)
                            password = ""
                            note = "Sent. NickServ will answer in a moment."
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Explain(
                        "No account yet? Send NickServ a message saying " +
                            "REGISTER <password> <email>."
                    )
                }
            }

            reply?.let { Outcome(it.text ?: it.status, failed = it.failed) }
            note?.let { Outcome(it, failed = false) }

            Spacer(Modifier.height(32.dp))
        }
    }
}

/** Who the network currently thinks you are */
@Composable
private fun Standing(nick: String, account: String?, connected: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .background(if (account != null) Green else if (connected) Yellow else Overlay, CircleShape)
        )
        Spacer(Modifier.width(10.dp))
        Column {
            Text(nick.ifBlank { "Not connected" }, color = Text0, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Text(
                when {
                    account != null -> "Logged in as $account"
                    connected -> "Not logged in — this nick is not protected"
                    else -> "Offline"
                },
                color = if (account != null) Green else Overlay,
                fontSize = 12.sp
            )
        }
    }
}

@Composable
private fun Explain(text: String) {
    Spacer(Modifier.height(10.dp))
    Text(text, color = Overlay, fontSize = 13.sp, lineHeight = 19.sp)
}

/** What the network said back, in its own words where it gave any */
@Composable
private fun Outcome(text: String, failed: Boolean) {
    Spacer(Modifier.height(18.dp))
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background((if (failed) Red else Green).copy(alpha = 0.12f), RoundedCornerShape(10.dp))
            .padding(14.dp)
    ) {
        Text(text, color = if (failed) Red else Green, fontSize = 13.sp, lineHeight = 19.sp)
    }
}

@Composable
private fun Action(label: String, enabled: Boolean, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        colors = ButtonDefaults.buttonColors(
            containerColor = Blue,
            contentColor = Crust,
            disabledContainerColor = Surface0,
            disabledContentColor = Overlay
        ),
        shape = RoundedCornerShape(10.dp),
        modifier = Modifier.fillMaxWidth().height(48.dp)
    ) {
        Text(label, fontWeight = FontWeight.Bold, fontSize = 15.sp)
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
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
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
