package org.switchboard.android.irc

/**
 * Slash commands typed into the composer.
 *
 * The phone had none. Following a desktop that did not matter — `message:send`
 * went over the link and `commands.ts` ran there — but holding the connection
 * itself, every one of them was sent to the channel as ordinary text. Typing
 * `/msg NickServ IDENTIFY hunter2` published the password to the room.
 *
 * So this mirrors `src/main/irc/commands.ts`, command for command and message
 * for message: the same client on two devices should not answer `/topic`
 * differently depending on which one you picked up.
 */
/**
 * What a slash command is allowed to do.
 *
 * The same seam as [IrcSession], one level up: that one is what a *protocol
 * handler* may do, this is what a *typed command* may do. [IrcConnection]
 * implements it, and a test can stand in for it without a socket — which
 * matters here more than most places, because the bug this file exists to fix
 * was a password going to a channel.
 */
interface IrcCommandTarget {
    val state: ConnectionState

    fun send(command: String, vararg params: String)
    fun sendRaw(line: String)
    fun say(target: String, text: String)
    fun action(target: String, text: String)
    fun notice(target: String, text: String)
    fun join(channel: String, key: String? = null)
    fun part(channel: String, reason: String? = null)
    fun setTopic(channel: String, topic: String)
    fun setNick(nick: String)
    fun whois(nick: String)
    fun setAway(message: String?)
    fun setMode(target: String, mode: String, vararg args: String)
    fun kick(channel: String, nick: String, reason: String?)
    fun invite(nick: String, channel: String)
    fun stop(quitMessage: String = "Switchboard")
}

object Commands {

    /**
     * What to do with what was typed.
     *
     * [handled] false means it was never a command and should be sent as a
     * message; [message] is the text to send instead, which the `//` escape
     * uses; [error] is something to tell the user rather than the network.
     */
    data class Result(
        val handled: Boolean,
        val message: String? = null,
        val error: String? = null
    )

    private const val CHANNEL_PREFIXES = "#&+!"

    private fun isChannel(name: String): Boolean =
        name.isNotEmpty() && CHANNEL_PREFIXES.contains(name[0])

    /**
     * Refuse text the server would silently cut, and say by how much.
     *
     * `TOPICLEN`, `AWAYLEN` and `KICKLEN` are not refusals — go over one and
     * the server accepts the command and quietly keeps the first N bytes. The
     * user finds out later, if at all.
     */
    private fun tooLongFor(
        connection: IrcCommandTarget,
        token: String,
        /** The whole noun phrase, article and all — "an away message" */
        what: String,
        text: String
    ): String? {
        val limit = Isupport.number(connection.state.isupport, token)
        if (Isupport.fits(text, limit)) return null

        val length = text.toByteArray(Charsets.UTF_8).size
        return "This network allows $limit characters in $what and yours is $length."
    }

    fun run(connection: IrcCommandTarget, target: String, text: String): Result {
        if (!text.startsWith("/")) return Result(handled = false)

        // "//text" sends a literal message beginning with a slash
        if (text.startsWith("//")) return Result(handled = false, message = text.substring(1))

        val space = text.indexOf(' ')
        val name = (if (space == -1) text.substring(1) else text.substring(1, space)).lowercase()
        val rest = if (space == -1) "" else text.substring(space + 1).trim()
        val args = if (rest.isEmpty()) emptyList() else rest.split(Regex("\\s+"))

        /** Splits off the first word, keeping the remainder intact */
        fun firstAndRest(): Pair<String, String> {
            val at = rest.indexOf(' ')
            return if (at == -1) rest to ""
            else rest.substring(0, at) to rest.substring(at + 1).trim()
        }

        return when (name) {
            "me" -> {
                if (rest.isEmpty()) Result(true, error = "/me needs something to do")
                else {
                    connection.action(target, rest)
                    Result(true)
                }
            }

            "join", "j" -> {
                val first = args.getOrNull(0)
                if (first == null) Result(true, error = "Usage: /join #channel [key]")
                else {
                    connection.join(if (isChannel(first)) first else "#$first", args.getOrNull(1))
                    Result(true)
                }
            }

            "part", "leave" -> {
                val named = args.getOrNull(0)?.takeIf { isChannel(it) }
                val channel = named ?: target
                val reason = if (named != null) args.drop(1).joinToString(" ") else rest
                if (!isChannel(channel)) Result(true, error = "Usage: /part #channel [reason]")
                else {
                    connection.part(channel, reason.ifBlank { null })
                    Result(true)
                }
            }

            "nick" -> {
                val nick = args.getOrNull(0)
                if (nick == null) Result(true, error = "Usage: /nick <nickname>")
                else {
                    connection.setNick(nick)
                    Result(true)
                }
            }

            "msg", "query" -> {
                val (to, body) = firstAndRest()
                when {
                    to.isEmpty() -> Result(true, error = "Usage: /msg <nick|#channel> <message>")
                    body.isEmpty() -> Result(true, error = "Nothing to send to $to")
                    else -> {
                        connection.say(to, body)
                        Result(true)
                    }
                }
            }

            "notice" -> {
                val (to, body) = firstAndRest()
                if (to.isEmpty() || body.isEmpty()) {
                    Result(true, error = "Usage: /notice <target> <message>")
                } else {
                    connection.notice(to, body)
                    Result(true)
                }
            }

            "whois" -> {
                val nick = args.getOrNull(0)
                if (nick == null) Result(true, error = "Usage: /whois <nick>")
                else {
                    connection.whois(nick)
                    Result(true)
                }
            }

            "topic" -> {
                if (!isChannel(target)) Result(true, error = "/topic only works in a channel")
                else if (rest.isEmpty()) {
                    connection.send("TOPIC", target)
                    Result(true)
                } else {
                    val tooLong = tooLongFor(connection, "TOPICLEN", "a topic", rest)
                    if (tooLong != null) Result(true, error = tooLong)
                    else {
                        connection.setTopic(target, rest)
                        Result(true)
                    }
                }
            }

            "mode" -> {
                if (args.isEmpty()) Result(true, error = "Usage: /mode <target> <modes>")
                else {
                    // "/mode +o nick" applies to the current channel. A mode
                    // string and a channel name can both start with "+", so
                    // match the mode shape first.
                    if (Regex("^[+-][a-zA-Z]+$").matches(args[0])) {
                        connection.setMode(target, args[0], *args.drop(1).toTypedArray())
                    } else if (args.size == 1) {
                        connection.send("MODE", args[0])
                    } else {
                        connection.setMode(args[0], args[1], *args.drop(2).toTypedArray())
                    }
                    Result(true)
                }
            }

            "kick" -> {
                if (!isChannel(target)) Result(true, error = "/kick only works in a channel")
                else {
                    val (nick, reason) = firstAndRest()
                    val tooLong = reason.takeIf { it.isNotEmpty() }
                        ?.let { tooLongFor(connection, "KICKLEN", "a kick reason", it) }
                    when {
                        nick.isEmpty() -> Result(true, error = "Usage: /kick <nick> [reason]")
                        tooLong != null -> Result(true, error = tooLong)
                        else -> {
                            connection.kick(target, nick, reason.ifBlank { null })
                            Result(true)
                        }
                    }
                }
            }

            "invite" -> {
                val (nick, channel) = firstAndRest()
                if (nick.isEmpty()) Result(true, error = "Usage: /invite <nick> [#channel]")
                else {
                    connection.invite(nick, channel.ifBlank { target })
                    Result(true)
                }
            }

            "away" -> {
                // AWAY with no message clears it
                if (rest.isEmpty()) {
                    connection.setAway(null)
                    Result(true)
                } else {
                    val tooLong = tooLongFor(connection, "AWAYLEN", "an away message", rest)
                    if (tooLong != null) Result(true, error = tooLong)
                    else {
                        connection.setAway(rest)
                        Result(true)
                    }
                }
            }

            "back" -> {
                connection.setAway(null)
                Result(true)
            }

            "quit" -> {
                connection.stop(rest.ifBlank { "Switchboard" })
                Result(true)
            }

            /**
             * Become a server operator.
             *
             * The password goes on the wire and nowhere else — the one
             * command here whose argument is a credential.
             */
            "oper" -> {
                val name = rest.substringBefore(' ').trim()
                val password = rest.substringAfter(' ', "").trim()
                if (name.isEmpty() || password.isEmpty()) {
                    Result(true, error = "Usage: /oper <name> <password>")
                } else {
                    connection.send("OPER", name, password)
                    Result(true)
                }
            }

            /**
             * Send text as a message, whatever it starts with.
             *
             * What makes an alias able to produce a line beginning with a
             * slash, and the reason `//` exists as an escape in the first
             * place.
             */
            "say" -> {
                if (rest.isEmpty()) Result(true, error = "/say needs something to say")
                else Result(false, message = rest)
            }

            "raw", "quote" -> {
                if (rest.isEmpty()) Result(true, error = "Usage: /raw <IRC line>")
                else {
                    connection.sendRaw(rest)
                    Result(true)
                }
            }

            // ── Ranks ──────────────────────────────────────────────
            //
            // The everyday ones. Every client has had these for thirty years
            // and this one made you type `/mode #channel +o nick`, which is
            // the same thing with more to get wrong.
            "op", "deop", "voice", "devoice", "halfop", "dehalfop",
            "owner", "deowner", "admin", "deadmin" -> {
                val letters = mapOf("op" to "o", "voice" to "v", "halfop" to "h",
                    "owner" to "q", "admin" to "a")
                val adding = !name.startsWith("de")
                val letter = letters[if (adding) name else name.drop(2)]!!
                val words = args.toMutableList()
                val channel = if (isChannel(words.firstOrNull().orEmpty())) words.removeAt(0) else target

                if (!isChannel(channel)) Result(true, error = "/$name only works in a channel")
                else {
                    val nicks = words.ifEmpty { listOf(connection.state.nick) }
                    // One MODE per MODES-worth: a server that takes four at a
                    // time silently drops the fifth.
                    val perLine = Isupport.number(connection.state.isupport, "MODES") ?: 4
                    nicks.chunked(perLine).forEach { batch ->
                        connection.setMode(
                            channel,
                            (if (adding) "+" else "-") + letter.repeat(batch.size),
                            *batch.toTypedArray()
                        )
                    }
                    Result(true)
                }
            }

            // ── Lists ──────────────────────────────────────────────
            "ban", "unban", "quiet", "unquiet" -> {
                val scheme = Powers.parsePrefix(connection.state.isupport["PREFIX"])
                val quieting = name.endsWith("quiet")
                val letter: String? = if (quieting)
                    Powers.quietMode(connection.state.isupport["CHANMODES"], scheme)?.toString()
                else "b"

                val words = args.toMutableList()
                val channel = if (isChannel(words.firstOrNull().orEmpty())) words.removeAt(0) else target

                when {
                    letter == null -> Result(true, error = "This network does not have a quiet mode")
                    !isChannel(channel) -> Result(true, error = "/$name only works in a channel")
                    words.isEmpty() -> Result(true, error = "Usage: /$name <nick or mask>")
                    else -> {
                        val adding = !name.startsWith("un")
                        // A bare nick becomes `nick!*@*`, which is what almost
                        // every server would have done anyway.
                        words.forEach { who ->
                            connection.setMode(
                                channel,
                                (if (adding) "+" else "-") + letter,
                                MaskLists.maskToSet(who)
                            )
                        }
                        Result(true)
                    }
                }
            }

            "kickban" -> {
                val words = args.toMutableList()
                val channel = if (isChannel(words.firstOrNull().orEmpty())) words.removeAt(0) else target
                val who = if (words.isEmpty()) null else words.removeAt(0)

                when {
                    !isChannel(channel) -> Result(true, error = "/kickban only works in a channel")
                    who == null -> Result(true, error = "Usage: /kickban <nick> [reason]")
                    else -> {
                        // Ban first. Kicking first leaves a window — short but
                        // real — in which they can rejoin before the ban lands,
                        // which is the one thing kickban exists to prevent.
                        val host = connection.state.findChannel(channel)
                            ?.users?.get(connection.state.casemap(who))?.host
                        connection.setMode(channel, "+b", Powers.banMask(who, host))
                        connection.kick(channel, who, words.joinToString(" ").ifEmpty { who })
                        Result(true)
                    }
                }
            }

            "banlist", "bans" -> {
                val channel = if (isChannel(args.firstOrNull().orEmpty())) args[0] else target
                if (!isChannel(channel)) Result(true, error = "/banlist only works in a channel")
                else {
                    connection.setMode(channel, "+b")
                    Result(true)
                }
            }

            // ── Channels ───────────────────────────────────────────
            "cycle", "hop" -> {
                val channel = if (isChannel(args.firstOrNull().orEmpty())) args[0] else target
                if (!isChannel(channel)) Result(true, error = "/$name only works in a channel")
                else {
                    connection.part(channel)
                    connection.join(channel)
                    Result(true)
                }
            }

            "knock" -> {
                val channel = args.firstOrNull().orEmpty()
                if (!isChannel(channel)) Result(true, error = "Usage: /knock <#channel> [reason]")
                else {
                    val why = args.drop(1).joinToString(" ").ifEmpty { "Please let me in" }
                    connection.send("KNOCK", channel, why)
                    Result(true)
                }
            }

            "names" -> {
                val channel = if (isChannel(args.firstOrNull().orEmpty())) args[0] else target
                if (!isChannel(channel)) Result(true, error = "/names only works in a channel")
                else {
                    connection.send("NAMES", channel)
                    Result(true)
                }
            }

            "list" -> {
                // With no arguments this is every channel on the network,
                // which on a large one is tens of thousands of lines.
                connection.send("LIST", *args.toTypedArray())
                Result(true)
            }

            // ── People ─────────────────────────────────────────────
            "whowas" -> {
                if (rest.isEmpty()) Result(true, error = "Usage: /whowas <nick> [count]")
                else {
                    connection.send("WHOWAS", *args.toTypedArray())
                    Result(true)
                }
            }

            "who" -> {
                if (rest.isEmpty()) Result(true, error = "Usage: /who <nick, #channel or mask>")
                else {
                    connection.send("WHO", *args.toTypedArray())
                    Result(true)
                }
            }

            "ctcp" -> {
                val who = args.getOrNull(0)
                val verb = args.getOrNull(1)
                if (who == null || verb == null)
                    Result(true, error = "Usage: /ctcp <nick> <VERSION|PING|TIME|…>")
                else {
                    val body = args.drop(2).joinToString(" ")
                    val payload = verb.uppercase() + if (body.isEmpty()) "" else " $body"
                    connection.sendRaw("PRIVMSG $who :\u0001$payload\u0001")
                    Result(true)
                }
            }

            "setname" -> {
                if (rest.isEmpty()) Result(true, error = "Usage: /setname <real name>")
                else {
                    connection.send("SETNAME", rest)
                    Result(true)
                }
            }

            // ── The server ─────────────────────────────────────────
            "motd", "lusers", "time", "version", "links", "stats", "info", "admininfo" -> {
                val verb = if (name == "admininfo") "ADMIN" else name.uppercase()
                connection.send(verb, *args.toTypedArray())
                Result(true)
            }

            "wallops" -> {
                if (rest.isEmpty()) Result(true, error = "Usage: /wallops <message>")
                else {
                    connection.send("WALLOPS", rest)
                    Result(true)
                }
            }

            "ping" -> {
                val who = args.firstOrNull()
                if (who != null) {
                    // A CTCP PING to a person, which is what /ping means
                    // everywhere — stamped so the reply is a round trip.
                    connection.sendRaw("PRIVMSG $who :\u0001PING ${System.currentTimeMillis()}\u0001")
                } else {
                    connection.send("PING", System.currentTimeMillis().toString())
                }
                Result(true)
            }

            else -> Result(true, error = "Unknown command: /$name")
        }
    }
}
