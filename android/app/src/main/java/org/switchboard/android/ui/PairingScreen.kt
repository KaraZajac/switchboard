package org.switchboard.android.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.switchboard.android.pairing.Pairing

/**
 * First run: point this phone at a desktop.
 *
 * The pairing code is checked on the desktop, not here, and it only works while
 * that window is open — so a ticket alone is not enough to join, which is what
 * makes it safe to paste one into a chat window to get it across.
 */
@Composable
fun PairingScreen(
    status: String,
    onScan: () -> Unit,
    onPair: (ticket: String, code: String) -> Unit,
    onGoItAlone: (passphrase: String) -> Unit
) {
    var ticket by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var alonePassphrase by remember { mutableStateOf("") }
    var aloneError by remember { mutableStateOf<String?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Base)
            .statusBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp)
    ) {
        Spacer(Modifier.height(48.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(44.dp).background(Blue, RoundedCornerShape(14.dp)),
                contentAlignment = Alignment.Center
            ) {
                Text("SB", color = Crust, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column {
                Text("Switchboard", color = Text0, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                Text("IRC, on both your devices", color = Overlay, fontSize = 13.sp)
            }
        }

        Spacer(Modifier.height(28.dp))

        Text(
            "This phone is an IRC client in its own right — it can connect to networks on its " +
                "own and never needs a desktop. Pairing with one is how the two come to share " +
                "the same servers and settings, and how either can be the one that is " +
                "actually connected.",
            color = Subtext,
            fontSize = 14.sp,
            lineHeight = 21.sp
        )

        Spacer(Modifier.height(24.dp))

        // Scanning is the whole of pairing: the QR carries the code too.
        Button(
            onClick = onScan,
            colors = ButtonDefaults.buttonColors(containerColor = Blue, contentColor = Crust),
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth().height(52.dp)
        ) {
            Text("Scan the QR code", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }

        Spacer(Modifier.height(20.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f).height(1.dp).background(Surface0))
            Text(
                "  or enter it by hand  ",
                color = Overlay,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
            Box(Modifier.weight(1f).height(1.dp).background(Surface0))
        }

        Spacer(Modifier.height(20.dp))

        Field(
            value = ticket,
            onChange = { ticket = it; error = null },
            label = "Pairing ticket",
            hint = "Paste the ticket from the desktop",
            monospace = true,
            lines = 3
        )

        Spacer(Modifier.height(12.dp))

        Field(
            value = code,
            onChange = { code = it },
            label = "Pairing code",
            hint = "The six digits on screen",
            monospace = true,
            lines = 1
        )

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Red, fontSize = 12.sp)
        }

        Spacer(Modifier.height(20.dp))

        Button(
            onClick = {
                // A pasted ticket may itself be a pairing link, which carries
                // the code — so read it rather than assuming it is bare.
                val payload = Pairing.parse(ticket)
                if (payload == null) {
                    error = "That does not look like a pairing ticket"
                } else {
                    onPair(payload.ticket, payload.code ?: code.trim())
                }
            },
            enabled = ticket.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = Surface0, contentColor = Text0),
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth().height(50.dp)
        ) {
            Text("Pair with desktop", fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }

        Spacer(Modifier.height(28.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f).height(1.dp).background(Surface0))
            Text(
                "  or use this phone on its own  ",
                color = Overlay,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
            Box(Modifier.weight(1f).height(1.dp).background(Surface0))
        }

        Spacer(Modifier.height(16.dp))

        Text(
            "Set up your networks here and connect straight from this phone. Choose a " +
                "passphrase now and you can pair a desktop later without starting again — it " +
                "is what the two devices use to share one config.",
            color = Subtext,
            fontSize = 13.sp,
            lineHeight = 19.sp
        )

        Spacer(Modifier.height(14.dp))

        Field(
            value = alonePassphrase,
            onChange = { alonePassphrase = it; aloneError = null },
            label = "Passphrase",
            hint = "Protects your servers and passwords on this phone",
            monospace = false,
            lines = 1
        )

        aloneError?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = Red, fontSize = 12.sp)
        }

        Spacer(Modifier.height(14.dp))

        Button(
            onClick = {
                val chosen = alonePassphrase
                if (chosen.length < 8) {
                    aloneError = "Use at least eight characters — this is what protects your passwords"
                } else {
                    onGoItAlone(chosen)
                }
            },
            enabled = alonePassphrase.isNotBlank(),
            colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Crust),
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth().height(50.dp)
        ) {
            Text("Start using it on this phone", fontWeight = FontWeight.Bold, fontSize = 15.sp)
        }

        Spacer(Modifier.height(24.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Mantle, RoundedCornerShape(10.dp))
                .padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(Modifier.width(3.dp).height(34.dp).background(Blue, RoundedCornerShape(2.dp)))
            Text(
                "On the desktop: Settings → Devices → Pair a device.\n" +
                    "The code expires after five minutes.",
                color = Overlay,
                fontSize = 12.sp,
                lineHeight = 18.sp
            )
        }

        if (status.isNotBlank()) {
            Spacer(Modifier.height(14.dp))
            Text(status, color = Subtext, fontSize = 12.sp)
        }

        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun Field(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    hint: String,
    monospace: Boolean,
    lines: Int
) {
    Column {
        Text(
            label.uppercase(),
            color = Overlay,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold
        )
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            placeholder = { Text(hint, color = Overlay, fontSize = 14.sp) },
            maxLines = lines,
            singleLine = lines == 1,
            shape = RoundedCornerShape(10.dp),
            textStyle = androidx.compose.ui.text.TextStyle(
                color = Text0,
                fontSize = 14.sp,
                fontFamily = if (monospace) FontFamily.Monospace else FontFamily.Default
            ),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Mantle,
                unfocusedContainerColor = Mantle,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                cursorColor = Blue
            ),
            modifier = Modifier.fillMaxWidth()
        )
    }
}
