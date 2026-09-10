package org.switchboard.android.irc

import kotlinx.serialization.json.JsonElement

/**
 * What a handler is allowed to do.
 *
 * The same split the desktop makes: handlers read and update state, send lines,
 * and emit events — they never touch the socket or the send queue directly.
 * Keeping that boundary is what lets the whole protocol layer be tested without
 * a network.
 */
interface IrcSession {
    val config: ServerConfig
    val state: ConnectionState

    /** Queue a command. Ordering is preserved; pacing is the connection's job. */
    fun send(command: String, vararg params: String)

    /** Queue an already-formed line, for the few places that build their own */
    fun sendRaw(line: String)

    /**
     * Drop this connection and come back over TLS on [port].
     *
     * Returns true when a reconnect is under way, so the caller stops talking
     * to a socket that is going away. False when we are already secured, and
     * negotiation should simply continue.
     */
    fun requireTls(port: Int): Boolean = false

    /**
     * Emit an event in the desktop's vocabulary.
     *
     * The phone's UI is fed by the same events whether the desktop is relaying
     * them or this engine is producing them, so these names and shapes have to
     * match `src/main/irc/manager.ts` exactly.
     */
    fun emit(channel: String, data: JsonElement)
}

typealias IrcHandler = (session: IrcSession, message: IrcMessage) -> Unit

/**
 * Command and numeric handlers, by name.
 *
 * A registry rather than one enormous `when`, so the protocol can be read a
 * subject at a time and a new extension is a new file rather than another
 * branch in the middle of something else.
 */
object Handlers {

    private val handlers = mutableMapOf<String, MutableList<IrcHandler>>()

    /**
     * Register a handler for a command or numeric.
     *
     * Several may claim the same command: `JOIN` is interesting to the channel
     * roster and to the metadata layer for different reasons, and neither
     * should have to know about the other.
     */
    fun on(command: String, handler: IrcHandler) {
        handlers.getOrPut(command.uppercase()) { mutableListOf() }.add(handler)
    }

    fun dispatch(session: IrcSession, message: IrcMessage) {
        val registered = handlers[message.command] ?: return
        for (handler in registered) {
            try {
                handler(session, message)
            } catch (e: Exception) {
                // One handler failing is not a reason to drop the connection or
                // to skip the others that care about this message.
                android.util.Log.w("Switchboard", "handler for ${message.command} failed", e)
            }
        }
    }

    /** Commands anything is listening for, for tests and diagnostics */
    fun registered(): Set<String> = handlers.keys.toSet()

    private var installed = false

    /**
     * Install every handler, once.
     *
     * Kotlin has no module-load side effects to rely on the way the desktop
     * does, so registration is explicit and idempotent.
     */
    @Synchronized
    fun installAll() {
        if (installed) return
        installed = true

        registerRegistrationHandlers()
        registerCapabilityHandlers()
        registerChannelHandlers()
        registerMessagingHandlers()
        registerChatHistoryTargetHandler()
        registerUserHandlers()
        registerBatchHandlers()
        registerMetadataHandlers()
        registerMonitorHandlers()
        registerErrorHandlers()
        Whox.registerHandlers()
    }
}
