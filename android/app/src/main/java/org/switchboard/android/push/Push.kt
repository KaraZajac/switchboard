package org.switchboard.android.push

import android.content.Context
import org.unifiedpush.android.connector.UnifiedPush

/**
 * Being told about a message while the app is asleep.
 *
 * An IRC client on a phone has one hard problem: Android will not let it hold
 * a socket open indefinitely, and the alternative most clients take is a push
 * service that reads your messages on the way past. Web Push is the way out —
 * the server encrypts to keys only this device holds (RFC 8291) and hands the
 * ciphertext to a service that cannot read it.
 *
 * UnifiedPush is how the endpoint is got without Google: the user has a
 * distributor app (ntfy, Conversations, a self-hosted one), that app gives out
 * endpoints, and the connector handles the registration dance and the
 * decryption. What is left for this app is small and is here:
 *
 *  - one registration per network, because an endpoint belongs to a server and
 *    a push has to say which one it came from. The connector's `instance` is
 *    exactly that, and is the server's id.
 *  - the endpoint, once it arrives, told to that server as `WEBPUSH REGISTER`.
 *  - the endpoint remembered, so a server connected to later is told about it
 *    without waiting for the distributor to say it again.
 */
object Push {

    private const val PREFS = "switchboard.push"
    private const val ENABLED = "enabled"
    private const val ENDPOINT = "endpoint."
    private const val KEYS = "keys."

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /**
     * Whether the user has asked for this.
     *
     * Off until asked. Registering an endpoint is a standing instruction to a
     * stranger's server to send somebody your messages, which is not a thing
     * to arrange on a user's behalf because it would be convenient.
     */
    fun wanted(context: Context): Boolean = prefs(context).getBoolean(ENABLED, false)

    fun setWanted(context: Context, on: Boolean) {
        prefs(context).edit().putBoolean(ENABLED, on).apply()
    }

    /** Distributor apps installed on this device, by package name */
    fun distributors(context: Context): List<String> = UnifiedPush.getDistributors(context)

    /** The one in use, or null where none has been chosen */
    fun distributor(context: Context): String? = UnifiedPush.getSavedDistributor(context)

    fun useDistributor(context: Context, packageName: String) {
        UnifiedPush.saveDistributor(context, packageName)
    }

    /**
     * Ask for an endpoint for one network.
     *
     * [vapid] is the key that network signs its pushes with, from its `VAPID`
     * ISUPPORT token. The distributor is given it so it can tell a push from
     * that server apart from anything else arriving at the same endpoint —
     * some distributors refuse a registration without one, which is the
     * `VAPID_REQUIRED` failure.
     *
     * Quiet where there is no distributor: the answer to "nobody has installed
     * one" is a line in settings, not an attempt that fails in a receiver.
     */
    fun askForEndpoint(context: Context, serverId: String, network: String, vapid: String?) {
        if (!wanted(context)) return
        if (UnifiedPush.getSavedDistributor(context) == null) return

        UnifiedPush.register(
            context,
            serverId,
            "Switchboard, to tell you about messages on $network",
            vapid
        )
    }

    /** Give the endpoint up, on turning this off or removing the network */
    fun giveUpEndpoint(context: Context, serverId: String) {
        forget(context, serverId)
        runCatching { UnifiedPush.unregister(context, serverId) }
    }

    /** What the distributor gave us for a network, if anything yet */
    fun endpointFor(context: Context, serverId: String): Endpoint? {
        val url = prefs(context).getString(ENDPOINT + serverId, null) ?: return null
        val keys = prefs(context).getString(KEYS + serverId, null) ?: return null
        return Endpoint(url, keys)
    }

    /**
     * An endpoint and the keys to reach it, as the server is told them.
     *
     * [keys] is already one parameter — `p256dh=<key>;auth=<secret>` — because
     * that is how `WEBPUSH REGISTER` takes them. Sending the two as separate
     * parameters is how the desktop's half of this never once worked.
     */
    data class Endpoint(val url: String, val keys: String)

    internal fun remember(context: Context, serverId: String, url: String, keys: String) {
        prefs(context).edit()
            .putString(ENDPOINT + serverId, url)
            .putString(KEYS + serverId, keys)
            .apply()
    }

    internal fun forget(context: Context, serverId: String) {
        prefs(context).edit()
            .remove(ENDPOINT + serverId)
            .remove(KEYS + serverId)
            .apply()
    }

    /** Every network with an endpoint, for telling servers as they connect */
    fun registered(context: Context): Set<String> =
        prefs(context).all.keys
            .filter { it.startsWith(ENDPOINT) }
            .map { it.removePrefix(ENDPOINT) }
            .toSet()
}
