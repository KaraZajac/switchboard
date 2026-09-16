package org.switchboard.android.push

import org.switchboard.android.SwitchboardEngine

/**
 * The engine's half of Web Push.
 *
 * Two directions. Outward: a network that offers `draft/webpush`, that we have
 * an account on, and that the user has asked to be pushed from, is told where
 * to push — `WEBPUSH REGISTER <endpoint> p256dh=<key>;auth=<secret>`, the keys
 * in one parameter because that is how the command reads them.
 *
 * Inward: a push arrives as one formatted IRC line and becomes a notification,
 * by the same rule an ordinary message would have. What makes it worth the
 * trouble is that it arrives when the client is *not* connected — which is
 * most of the day on a phone, and exactly when a message matters.
 */

/**
 * Tell this network where to push, if everything it needs is true.
 *
 * Called on connect and again whenever the endpoint changes. Quiet where any
 * of the conditions is missing, because each of them is somebody else's to
 * satisfy: the user has to want it and pick a distributor, the network has to
 * offer the capability, and there has to be an account — a push endpoint
 * outlives the connection that made it, so it belongs to a login rather than
 * to whoever currently holds a nick.
 */
fun SwitchboardEngine.offerPushEndpoint(serverId: String) {
    if (!Push.wanted(context)) return
    val connection = connections[serverId] ?: return
    if (!connection.state.capabilities.any { it == "draft/webpush" || it == "soju.im/webpush" }) return
    if (connection.state.account.isNullOrBlank()) return

    val endpoint = Push.endpointFor(context, serverId)
    if (endpoint == null) {
        // Nothing yet. Ask the distributor, and this runs again when it
        // answers — `onNewEndpoint` calls back through the application.
        Push.askForEndpoint(
            context,
            serverId,
            store.servers[serverId]?.name ?: "IRC",
            connection.state.isupport["VAPID"]
        )
        return
    }

    connection.send("WEBPUSH", "REGISTER", endpoint.url, endpoint.keys)
}

/** Stop being pushed to for a network — on turning it off, or removing it */
fun SwitchboardEngine.withdrawPushEndpoint(serverId: String) {
    Push.endpointFor(context, serverId)?.let { endpoint ->
        connections[serverId]?.send("WEBPUSH", "UNREGISTER", endpoint.url)
    }
    Push.giveUpEndpoint(context, serverId)
}

/**
 * A push arrived: draw it.
 *
 * The line is whatever the server would have sent had we been connected, so
 * this reads it the same way and shows the same notification. Nothing is shown
 * for a conversation already read — the read marker is shared, so a message
 * answered on the desktop does not buzz the phone a minute later.
 */
fun SwitchboardEngine.showPushed(serverId: String, line: String) {
    val me = store.servers[serverId]?.nick.orEmpty()
    val notice = Pushed.read(line, me, store.highlightWords) ?: return

    notifyPushed(
        serverId = serverId,
        conversation = notice.conversation,
        nick = notice.nick,
        text = notice.text,
        mentioned = notice.mentioned
    )
}

/** Offer the endpoint to every network that is connected and can take it */
fun SwitchboardEngine.offerPushEverywhere() {
    for (serverId in connections.keys.toList()) offerPushEndpoint(serverId)
}

/** Give every one of them up, on turning this off */
fun SwitchboardEngine.withdrawAllPushEndpoints() {
    for (serverId in Push.registered(context)) withdrawPushEndpoint(serverId)
}
