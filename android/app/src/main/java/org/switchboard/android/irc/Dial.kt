package org.switchboard.android.irc

/**
 * Whether a change to a network means dialling it again.
 *
 * The Kotlin half of `src/shared/dial.ts`, checked against
 * `tests/fixtures/dial.json`. Editing a server wrote the new settings down and
 * left the running connection exactly as it was — so changing the address and
 * pressing save left you connected to the old one, with the list showing the
 * new address and a green dot beside it.
 *
 * Not every edit deserves that. Turning off "connect automatically", editing
 * the join list, setting a profile — none of those touch the socket, and
 * dropping someone out of a conversation to apply them would be worse than the
 * bug. A nick is deliberately not on the list either: it is changed on a live
 * connection with NICK, which is the better answer.
 */
fun dialChanged(before: ServerConfig, after: ServerConfig): Boolean =
    before.host != after.host ||
        before.port != after.port ||
        before.tls != after.tls ||
        before.websocketUrl != after.websocketUrl
