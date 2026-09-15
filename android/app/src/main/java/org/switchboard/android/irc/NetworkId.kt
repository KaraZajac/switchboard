package org.switchboard.android.irc

/**
 * Which network a server entry *is*, independent of the id it was given.
 *
 * The Kotlin twin of `src/shared/netid.ts`; `tests/fixtures/netid.json` holds
 * the two to the same answers.
 *
 * Every device generates its own id when a network is added, so the same
 * server set up twice — once on the desktop, once here — is two entries with
 * nothing in common but where they point. The phone showed both, connected on
 * whichever it happened to have, and handed messages to the desktop under an
 * id the desktop had never heard of.
 *
 * Host and port alone are not enough. Two accounts on one server is ordinary,
 * and merging those would throw one away. The nick separates them, folded the
 * way the IRC casemap folds it.
 */
object NetworkId {

    fun key(host: String, port: Int, nick: String): String =
        "${host.trim().lowercase()}:$port/${Casemap.fold(nick.trim())}"

    fun key(config: ServerConfig): String = key(config.host, config.port, config.nick)

    fun same(a: ServerConfig, b: ServerConfig): Boolean = key(a) == key(b)

    /**
     * Old id → new id, for a config about to be adopted.
     *
     * Only where the two disagree: an entry already under the right id is not
     * a move, and a network that is genuinely new has nothing to move.
     */
    fun reidentified(mine: List<ServerConfig>, theirs: List<ServerConfig>): Map<String, String> {
        val incoming = theirs.associate { key(it) to it.id }
        val known = theirs.map { it.id }.toSet()

        return mine.mapNotNull { server ->
            if (server.id in known) return@mapNotNull null
            val id = incoming[key(server)] ?: return@mapNotNull null
            if (id == server.id) null else server.id to id
        }.toMap()
    }
}
