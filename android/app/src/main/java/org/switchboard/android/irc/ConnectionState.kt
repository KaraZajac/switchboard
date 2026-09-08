package org.switchboard.android.irc

/**
 * What this connection knows.
 *
 * Deliberately the same shape as the desktop's `ConnectionState` — the phone has
 * to reach the same conclusions about a channel as the desktop would, because
 * the two swap places and the user should not be able to tell which one is
 * currently on the network.
 */

/** One person in a channel, as the server described them */
data class ChannelUser(
    val nick: String,
    val user: String? = null,
    val host: String? = null,
    val account: String? = null,
    val realname: String? = null,
    /** Mode prefixes, most privileged first: ~ & @ % + */
    val prefixes: List<String> = emptyList(),
    val away: Boolean = false,
    val isBot: Boolean = false
)

class ChannelState(val name: String) {
    var topic: String? = null
    var topicSetBy: String? = null
    var topicSetAt: Long? = null
    var namesReceived = false
    val modes = mutableMapOf<String, String?>()
    val users = LinkedHashMap<String, ChannelUser>()

    private fun key(nick: String) = nick.lowercase()

    fun user(nick: String): ChannelUser? = users[key(nick)]

    fun setUser(nick: String, update: (ChannelUser) -> ChannelUser): ChannelUser {
        val existing = users[key(nick)] ?: ChannelUser(nick)
        val next = update(existing)
        users[key(nick)] = next
        return next
    }

    fun removeUser(nick: String) {
        users.remove(key(nick))
    }

    fun renameUser(from: String, to: String) {
        val existing = users.remove(key(from)) ?: return
        users[key(to)] = existing.copy(nick = to)
    }
}

/** A BATCH the server opened and has not yet closed */
class BatchState(
    val id: String,
    val type: String,
    val params: List<String>,
    val parent: String?
) {
    val messages = mutableListOf<IrcMessage>()
}

class ConnectionState(val serverId: String) {

    var nick = ""
    var desiredNick = ""

    /**
     * A nick we have asked for and not yet had an answer to.
     *
     * A NICK carries the *old* nick in its prefix, which is how a client knows
     * a change is its own. Not every server does that — at least one sends the
     * new nick there, matching nobody, which leaves the client believing it is
     * still called something it is not for the rest of the session.
     */
    var pendingNick: String? = null
    var account: String? = null
    var registered = false
    var serverName = ""
    var away = false

    /** Prefix symbols from ISUPPORT PREFIX, most privileged first */
    var prefixSymbols = "@+"
    /** Mode letters matching [prefixSymbols], same order */
    var prefixModes = "ov"

    var pendingCapRequests = 0

    val available = mutableMapOf<String, String>()
    val capabilities = mutableSetOf<String>()
    val isupport = mutableMapOf<String, String>()
    val channels = LinkedHashMap<String, ChannelState>()
    val batches = mutableMapOf<String, BatchState>()

    /** Everyone's draft/metadata-2 values, by lowercased target */
    val metadata = mutableMapOf<String, MutableMap<String, String>>()

    val motd = mutableListOf<String>()
    var motdInProgress = false

    /** NAMES replies accumulate here until 366 says the list is complete */
    val pendingNames = mutableMapOf<String, MutableList<String>>()

    fun channel(name: String): ChannelState =
        channels.getOrPut(name.lowercase()) { ChannelState(name) }

    fun findChannel(name: String?): ChannelState? =
        name?.let { channels[it.lowercase()] }

    fun isMe(nick: String?): Boolean = nick != null && nick.equals(this.nick, ignoreCase = true)

    /**
     * Split a NAMES entry into its mode prefixes and the nick.
     *
     * With multi-prefix a name can carry several (`@+kara`), and with
     * userhost-in-names it arrives as a full `nick!user@host`.
     */
    fun parseNamesEntry(entry: String): ChannelUser {
        val prefixes = entry.takeWhile { prefixSymbols.contains(it) }
        val rest = entry.drop(prefixes.length)

        val bang = rest.indexOf('!')
        val at = rest.indexOf('@')
        return if (bang != -1 && at > bang) {
            ChannelUser(
                nick = rest.substring(0, bang),
                user = rest.substring(bang + 1, at),
                host = rest.substring(at + 1),
                prefixes = prefixes.map { it.toString() }
            )
        } else {
            ChannelUser(nick = rest, prefixes = prefixes.map { it.toString() })
        }
    }

    /** The mode letter a prefix symbol stands for, e.g. '@' -> 'o' */
    fun modeForPrefix(symbol: Char): Char? {
        val index = prefixSymbols.indexOf(symbol)
        return if (index >= 0 && index < prefixModes.length) prefixModes[index] else null
    }

    /** The prefix symbol a mode letter grants, e.g. 'o' -> '@' */
    fun prefixForMode(mode: Char): String? {
        val index = prefixModes.indexOf(mode)
        return if (index >= 0 && index < prefixSymbols.length) prefixSymbols[index].toString() else null
    }

    fun reset(startingNick: String) {
        nick = startingNick
        desiredNick = startingNick
        account = null
        registered = false
        serverName = ""
        away = false
        prefixSymbols = "@+"
        prefixModes = "ov"
        pendingCapRequests = 0
        available.clear()
        capabilities.clear()
        isupport.clear()
        channels.clear()
        batches.clear()
        metadata.clear()
        motd.clear()
        motdInProgress = false
        pendingNames.clear()
    }
}
