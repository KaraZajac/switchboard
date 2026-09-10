package org.switchboard.android.irc

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Base64

/**
 * Getting on to the network: capability negotiation, SASL, registration.
 *
 * The order matters and is not obvious. CAP holds registration open; SASL runs
 * inside that window; nothing else may be sent until 001, because a server
 * answers anything earlier with 451 and drops it on the floor.
 */

internal fun registerCapabilityHandlers() {

    Handlers.on("CAP") { session, message ->
        val state = session.state
        val listed = message.params.lastOrNull() ?: return@on

        when (message.param(1)?.uppercase()) {
            "LS" -> {
                // "CAP * LS *" means another line is coming
                val more = message.param(2) == "*"
                for (entry in listed.split(" ").filter { it.isNotEmpty() }) {
                    state.available[entry.substringBefore("=")] = entry.substringAfter("=", "")
                }
                if (more) return@on

                // Strict Transport Security, before anything else is said.
                //
                // The server is telling us it is TLS-only. Nothing sensitive
                // has gone out yet — SASL comes later — and the point is to
                // keep it that way: note the policy, and reconnect secured
                // rather than carrying on in the clear.
                val sts = Sts.parse(state.available["sts"])
                if (sts != null) {
                    val (port, duration) = sts
                    Sts.remember(session.config.host, port, duration)
                    if (session.requireTls(port)) return@on
                }

                requestCapabilities(session)
            }

            "ACK" -> {
                for (cap in listed.split(" ").filter { it.isNotEmpty() }) {
                    if (cap.startsWith("-")) state.capabilities.remove(cap.drop(1))
                    else state.capabilities.add(cap)
                }

                // A long wish list goes out as several lines; registration must
                // not proceed until the last one has been answered.
                if (state.pendingCapRequests > 0) state.pendingCapRequests--
                if (state.pendingCapRequests > 0) return@on

                // draft/pre-away: be away before we are even visible, which is
                // what a bouncer wants when it reconnects for you.
                if (state.capabilities.contains("draft/pre-away")) {
                    session.config.preAwayMessage?.takeIf { it.isNotBlank() }?.let {
                        session.send("AWAY", it)
                    }
                }

                if (state.capabilities.contains("sasl") && session.config.saslPassword != null) {
                    val wanted = session.config.saslMechanism ?: "PLAIN"

                    // The capability value lists what the server will actually
                    // take — `sasl=PLAIN,SCRAM-SHA-256`. Sending a mechanism
                    // that is not on it gets a bare 904, and a user staring at
                    // "authentication failed" with no way to know their account
                    // was never the problem.
                    val offered = Sasl.mechanismsFrom(state.available["sasl"])
                    if (offered != null && wanted !in offered) {
                        session.emit("irc:error", buildJsonObject {
                            put("serverId", state.serverId)
                            put("code", "SASL")
                            put(
                                "message",
                                "This server does not offer $wanted. " +
                                    "It accepts ${offered.joinToString(", ")}."
                            )
                        })
                        session.sendRaw("CAP END")
                        return@on
                    }

                    session.send("AUTHENTICATE", wanted)
                    // CAP END waits for the SASL exchange to finish
                    return@on
                }
                session.sendRaw("CAP END")
            }

            "NAK" -> {
                // The whole line is refused together, so there is nothing to
                // salvage from it — but other lines may still be outstanding.
                if (state.pendingCapRequests > 0) state.pendingCapRequests--
                if (state.pendingCapRequests > 0) return@on
                session.sendRaw("CAP END")
            }

            "NEW" -> {
                // cap-notify: the server has more to offer than it did
                for (entry in listed.split(" ").filter { it.isNotEmpty() }) {
                    state.available[entry.substringBefore("=")] = entry.substringAfter("=", "")
                }
                requestCapabilities(session, onlyNew = true)
            }

            "DEL" -> {
                for (cap in listed.split(" ").filter { it.isNotEmpty() }) {
                    state.capabilities.remove(cap)
                    state.available.remove(cap)
                }
                session.emit("irc:cap", buildJsonObject {
                    put("serverId", state.serverId)
                    put("capabilities", buildJsonArray {
                        for (cap in state.capabilities) add(JsonPrimitive(cap))
                    })
                })
            }
        }
    }

    Handlers.on("AUTHENTICATE") { session, message ->
        Sasl.step(session, message.param(0) ?: "")
    }

    // RPL_LOGGEDIN / RPL_LOGGEDOUT
    // Logged in, and logged out. Both were recorded and neither was announced,
    // so nothing above the connection could say whose account this was — which
    // is the one fact an account screen is for.
    Handlers.on("900") { session, message ->
        session.state.account = message.param(2)
        session.emit("irc:account", buildJsonObject {
            put("serverId", session.state.serverId)
            put("nick", session.state.nick)
            put("account", session.state.account)
        })
    }
    Handlers.on("901") { session, _ ->
        session.state.account = null
        session.emit("irc:account", buildJsonObject {
            put("serverId", session.state.serverId)
            put("nick", session.state.nick)
            put("account", null as String?)
        })
    }

    // SASL succeeded
    Handlers.on("903") { session, _ ->
        Sasl.finish(session, succeeded = true, reason = null)
    }

    // Aborted, failed, too long, already authenticated, mechanisms
    for (numeric in listOf("902", "904", "905", "906", "907")) {
        Handlers.on(numeric) { session, message ->
            Sasl.finish(session, succeeded = false, reason = message.params.lastOrNull())
        }
    }

    // RPL_SASLMECHS — the server listing what it will accept
    Handlers.on("908") { session, message ->
        session.state.available["sasl"] = message.param(1).orEmpty()
    }
}

/**
 * Ask for capabilities, in as many CAP REQ lines as it takes.
 *
 * A wish list past the 512-byte line limit is answered with
 * `417 ERR_INPUTTOOLONG`, registration never completes, and the client simply
 * never connects. Each CAP REQ is atomic, so splitting changes nothing except
 * that it fits.
 */
internal fun requestCapabilities(session: IrcSession, onlyNew: Boolean = false) {
    val state = session.state
    val wanted = IrcConnection.WANTED_CAPABILITIES.filter {
        state.available.containsKey(it) && (!onlyNew || !state.capabilities.contains(it))
    }

    if (wanted.isEmpty()) {
        if (!onlyNew) session.sendRaw("CAP END")
        return
    }

    val budget = IrcConnection.MAX_LINE_BYTES - "CAP REQ :".toByteArray().size - 2 // CRLF
    val lines = mutableListOf<String>()
    var current = ""

    for (cap in wanted) {
        val candidate = if (current.isEmpty()) cap else "$current $cap"
        if (candidate.toByteArray().size > budget && current.isNotEmpty()) {
            lines.add(current)
            current = cap
        } else {
            current = candidate
        }
    }
    if (current.isNotEmpty()) lines.add(current)

    state.pendingCapRequests = lines.size
    for (line in lines) session.send("CAP", "REQ", line)
}

internal fun registerRegistrationHandlers() {

    // RPL_WELCOME — we are on the network
    Handlers.on("001") { session, message ->
        val state = session.state
        state.nick = message.param(0) ?: state.nick
        state.registered = true
        state.serverName = message.prefix ?: state.serverName

        // We are called something, and it is not always what was asked for.
        // Say so now, once it is settled — being quietly renamed and left to
        // notice is how someone spends an evening wondering why nobody
        // answers them.
        if (state.desiredNick.isNotBlank() && state.casemap(state.nick) != state.casemap(state.desiredNick)) {
            val why = state.nickRefusedReason
            session.emit("irc:error", buildJsonObject {
                put("serverId", state.serverId)
                put(
                    "message",
                    "Connected as ${state.nick} rather than ${state.desiredNick}" +
                        (if (why != null) " — $why" else "")
                )
            })
        }
        state.nickRefusedReason = null

        session.emit("irc:connected", buildJsonObject {
            put("serverId", state.serverId)
            put("nick", state.nick)
            put("account", state.account)
        })
        session.emit("irc:cap", buildJsonObject {
            put("serverId", state.serverId)
            put("capabilities", buildJsonArray {
                for (cap in state.capabilities) add(JsonPrimitive(cap))
            })
        })

        // Everything that was waiting for registration happens here, not at the
        // end of capability negotiation: with SASL the two are seconds apart,
        // and anything sent between comes back as 451 and is lost.
        Metadata.publishProfile(session)
        for (channel in session.config.autoJoin) session.send("JOIN", channel)
    }

    Handlers.on("002") { session, message -> session.state.serverName = message.prefix.orEmpty() }

    // RPL_CREATED / RPL_MYINFO — kept for the server info panel
    Handlers.on("003") { session, message ->
        session.emit("irc:server-info", buildJsonObject {
            put("serverId", session.state.serverId)
            put("field", "created")
            put("value", message.params.lastOrNull())
        })
    }
    Handlers.on("004") { session, message ->
        session.state.serverName = message.param(1) ?: session.state.serverName
        session.emit("irc:server-info", buildJsonObject {
            put("serverId", session.state.serverId)
            put("field", "version")
            put("value", message.param(2))
        })
    }

    // ERR_ERRONEUSNICKNAME — the nick is not merely taken, it is not allowed
    Handlers.on("432") { session, message ->
        session.emit("irc:error", buildJsonObject {
            put("serverId", session.state.serverId)
            put("code", "432")
            put("message", message.params.lastOrNull() ?: "That nickname is not allowed")
        })
    }

    // RPL_LIST / RPL_LISTEND — browsing what is on the network
    Handlers.on("322") { session, message ->
        session.emit("irc:list-entry", buildJsonObject {
            put("serverId", session.state.serverId)
            put("channel", message.param(1))
            put("users", message.param(2)?.toIntOrNull() ?: 0)
            put("topic", message.params.lastOrNull())
        })
    }
    Handlers.on("323") { session, _ ->
        session.emit("irc:list-end", buildJsonObject {
            put("serverId", session.state.serverId)
        })
    }

    // draft/account-registration
    Handlers.on("REGISTER") { session, message ->
        session.emit("irc:register", buildJsonObject {
            put("serverId", session.state.serverId)
            put("status", message.param(0))
            put("account", message.param(1))
            put("message", message.params.lastOrNull())
        })
    }
    Handlers.on("VERIFY") { session, message ->
        session.emit("irc:verify", buildJsonObject {
            put("serverId", session.state.serverId)
            put("status", message.param(0))
            put("account", message.param(1))
            put("message", message.params.lastOrNull())
        })
    }

    // RPL_ISUPPORT
    Handlers.on("005") { session, message ->
        val state = session.state
        // The first parameter is our nick and the last is the human sentence
        for (token in message.params.drop(1).dropLast(1)) {
            val key = token.substringBefore("=")
            val value = token.substringAfter("=", "")
            state.isupport[key] = value

            when (key) {
                "PREFIX" -> {
                    // PREFIX=(ohv)@%+ — modes in brackets, symbols after
                    val modes = value.substringAfter("(", "").substringBefore(")", "")
                    val symbols = value.substringAfter(")", "")
                    if (modes.isNotEmpty() && modes.length == symbols.length) {
                        state.prefixModes = modes
                        state.prefixSymbols = symbols
                    }
                }
                "NETWORK" -> session.emit("irc:network", buildJsonObject {
                    put("serverId", state.serverId)
                    put("network", value)
                })
            }
        }
    }

    // MOTD
    Handlers.on("375") { session, _ ->
        session.state.motd.clear()
        session.state.motdInProgress = true
    }
    Handlers.on("372") { session, message ->
        session.state.motd.add(message.params.lastOrNull().orEmpty())
    }
    Handlers.on("376") { session, _ -> session.state.motdInProgress = false }
    Handlers.on("422") { session, _ -> session.state.motdInProgress = false }

    // ERR_NICKNAMEINUSE
    Handlers.on("433") { session, message ->
        val state = session.state

        // We did not get what we asked for; forget it, so that somebody else
        // taking that name later is not mistaken for us.
        if (state.pendingNick.equals(message.param(1), ignoreCase = true)) {
            state.pendingNick = null
        }

        // The server's own words: "already in use" and "registered to another
        // account" are different problems and only one of them is the user's
        // to solve.
        state.nickRefusedReason = message.params.lastOrNull()

        if (!state.registered) {
            val attempted = message.param(1) ?: state.nick
            state.nick = "${attempted}_"
            session.send("NICK", state.nick)
            // Nothing is settled yet — SASL may still win the name back, and
            // saying so now would be a warning about something that did not
            // happen. 001 reports it, once it is final.
            return@on
        }

        session.emit("irc:error", buildJsonObject {
            put("serverId", state.serverId)
            put("message", state.nickRefusedReason ?: "Nickname ${message.param(1)} is already in use")
        })
    }

    Handlers.on("ERROR") { session, message ->
        session.emit("irc:error", buildJsonObject {
            put("serverId", session.state.serverId)
            put("message", message.params.lastOrNull() ?: "Server closed the connection")
        })
    }
}

/**
 * SASL.
 *
 * PLAIN and SCRAM-SHA-256, matching what the desktop offers — a phone that
 * cannot log in to the network the desktop logs in to is not a failover.
 */
internal object Sasl {

    private val encoder: Base64.Encoder = Base64.getEncoder()

    /**
     * The mechanisms the server named, or null if it named none.
     *
     * `sasl` with no value means the server will take whatever it takes and
     * has not said what — which is not the same as taking nothing, so the
     * caller has to go ahead and find out.
     */
    fun mechanismsFrom(value: String?): List<String>? {
        if (value.isNullOrBlank()) return null
        val named = value.split(',').map { it.trim().uppercase() }.filter { it.isNotEmpty() }
        return named.ifEmpty { null }
    }

    /** In-flight SCRAM exchange, one per connection at a time */
    private val scram = mutableMapOf<String, Scram>()

    fun step(session: IrcSession, payload: String) {
        val mechanism = (session.config.saslMechanism ?: "PLAIN").uppercase()
        val password = session.config.saslPassword ?: return
        val account = session.config.saslUsername ?: session.config.nick

        when (mechanism) {
            "PLAIN" -> {
                if (payload != "+") return
                // authzid NUL authcid NUL password
                val bytes = account.toByteArray() + 0 + account.toByteArray() + 0 +
                    password.toByteArray()
                sendPayload(session, encoder.encodeToString(bytes))
            }

            "EXTERNAL" -> if (payload == "+") sendPayload(session, "")

            "SCRAM-SHA-256", "SCRAM-SHA-512" -> {
                val key = session.state.serverId
                if (payload == "+") {
                    val exchange = Scram(account, password, mechanism)
                    scram[key] = exchange
                    sendPayload(session, encoder.encodeToString(exchange.first().toByteArray()))
                    return
                }

                val exchange = scram[key] ?: return
                val decoded = String(Base64.getDecoder().decode(payload))
                val reply = exchange.next(decoded)
                if (reply == null) {
                    scram.remove(key)

                    // SCRAM proves both sides knew the password, and the
                    // server's half was computed here and thrown away — so a
                    // server that could not prove it was treated exactly like
                    // one that could, which is the whole point of the exchange
                    // given up at the last step. Abort rather than let the 903
                    // that follows count as a login.
                    if (!exchange.serverVerified) {
                        session.send("AUTHENTICATE", "*")
                        session.emit("irc:error", buildJsonObject {
                            put("serverId", session.state.serverId)
                            put("command", "SASL")
                            put(
                                "message",
                                "This server could not prove it knew your password."
                            )
                        })
                    }
                    return
                }
                sendPayload(session, encoder.encodeToString(reply.toByteArray()))
            }
        }
    }

    fun finish(session: IrcSession, succeeded: Boolean, reason: String?) {
        scram.remove(session.state.serverId)
        if (!succeeded) {
            // Named, not anonymous: a login that failed is not one refusal
            // among many. It leaves the user on their own network as a
            // stranger, and nothing else on screen would say why.
            session.emit("irc:error", buildJsonObject {
                put("serverId", session.state.serverId)
                put("command", "SASL")
                put("message", reason ?: "SASL authentication failed")
            })
        }

        // Take the name we actually asked for, now that there is an account
        // behind the request. A server that protects registered nicks refuses
        // one to a connection that has not authenticated yet, and NICK goes
        // out before SASL can even begin — so for anyone with an account that
        // is the ordinary case, not a corner of one.
        if (succeeded) reclaimDesiredNick(session)

        if (!session.state.registered) session.sendRaw("CAP END")
    }

    /** Ask again for the nick we wanted, if we settled for another one */
    private fun reclaimDesiredNick(session: IrcSession) {
        val state = session.state
        if (state.desiredNick.isBlank()) return
        if (state.casemap(state.nick) == state.casemap(state.desiredNick)) return

        state.pendingNick = state.desiredNick
        session.send("NICK", state.desiredNick)
    }

    /**
     * Send a payload, split across lines if it is long.
     *
     * AUTHENTICATE carries at most 400 bytes per line, and a payload that is an
     * exact multiple of 400 needs a trailing "+" or the server waits forever
     * for a continuation that never comes.
     */
    private fun sendPayload(session: IrcSession, encoded: String) {
        if (encoded.isEmpty()) {
            session.send("AUTHENTICATE", "+")
            return
        }

        var offset = 0
        while (offset < encoded.length) {
            val end = minOf(offset + 400, encoded.length)
            session.send("AUTHENTICATE", encoded.substring(offset, end))
            offset = end
        }
        if (encoded.length % 400 == 0) session.send("AUTHENTICATE", "+")
    }
}
