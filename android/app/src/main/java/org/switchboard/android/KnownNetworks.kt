package org.switchboard.android

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Networks to offer somebody who has none.
 *
 * IRC's worst moment is the first one: a client that opens on an empty screen
 * and a box wanting a hostname is asking a question most people cannot answer,
 * and nothing in the app helps them answer it. You are expected to already know
 * that irc.libera.chat exists, and which of the dozen networks is the one your
 * people are on.
 *
 * The list is the desktop's `src/shared/networks.json`, copied into this app's
 * assets at build time rather than written out again here — one file, so the
 * two clients cannot come to disagree about where Libera is.
 */
@Serializable
data class KnownNetwork(
    val id: String,
    val name: String,
    val host: String,
    val port: Int,
    val tls: Boolean,
    /** One line on what the network is for */
    val description: String,
    /** Roughly where its servers are */
    val region: String,
    val homepage: String? = null,
    /** Somewhere to land, so the first screen is not empty either */
    val channels: List<String> = emptyList(),
    /** What answered when this entry was last checked, and any caveat */
    val checked: String? = null
)

@Serializable
private data class NetworkList(
    val checkedAt: String = "",
    val networks: List<KnownNetwork> = emptyList()
)

object KnownNetworks {

    private val json = Json { ignoreUnknownKeys = true }
    private var loaded: NetworkList? = null

    /**
     * Read the list once.
     *
     * A missing or unreadable asset is not worth crashing over: the whole
     * feature is a convenience, and adding a network by hand still works.
     */
    private fun load(context: Context): NetworkList {
        loaded?.let { return it }

        val parsed = runCatching {
            context.assets.open("networks.json").bufferedReader().use { reader ->
                json.decodeFromString(NetworkList.serializer(), reader.readText())
            }
        }.getOrElse { NetworkList() }

        loaded = parsed
        return parsed
    }

    fun all(context: Context): List<KnownNetwork> = load(context).networks

    /** When the list was last confirmed by connecting to each of them */
    fun checkedAt(context: Context): String = load(context).checkedAt

    /**
     * The ones worth showing, in the order written.
     *
     * Not sorted: the file is in rough size order, and "the biggest one for
     * what you are here for" is more useful than alphabetical to somebody who
     * does not yet know any of these names.
     */
    fun matching(context: Context, query: String): List<KnownNetwork> {
        val wanted = query.trim().lowercase()
        if (wanted.isEmpty()) return all(context)

        return all(context).filter {
            it.name.lowercase().contains(wanted) ||
                it.description.lowercase().contains(wanted) ||
                it.region.lowercase().contains(wanted) ||
                it.host.lowercase().contains(wanted)
        }
    }
}
