package org.switchboard.android

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.switchboard.android.irc.IrcConnection
import org.switchboard.android.irc.ServerConfig
import java.util.Collections

/**
 * The phone's engine against a real IRC server.
 *
 * Skipped unless one is pointed at: run with
 * `-Dswitchboard.irc=127.0.0.1:16667`. Everything else in this suite proves the
 * engine agrees with a corpus; this proves it agrees with an ircd, which is a
 * different and harder thing — the desktop's worst bugs were all of the second
 * kind and none of them showed up against a fixture.
 */
class LiveIrcTest {

    private val target: String? = System.getProperty("switchboard.irc")?.takeIf { it.isNotBlank() }

    private class Recorder {
        val events: MutableList<Pair<String, JsonObject>> = Collections.synchronizedList(mutableListOf())

        fun record(channel: String, data: JsonElement) {
            events.add(channel to data.jsonObject)
        }

        fun on(channel: String) = synchronized(events) {
            events.filter { it.first == channel }.map { it.second }
        }

        fun waitFor(channel: String, seconds: Int = 20, predicate: (JsonObject) -> Boolean = { true }): JsonObject? {
            val deadline = System.currentTimeMillis() + seconds * 1000
            while (System.currentTimeMillis() < deadline) {
                on(channel).firstOrNull(predicate)?.let { return it }
                Thread.sleep(100)
            }
            return null
        }
    }

    private fun JsonObject.str(key: String) = this[key]?.jsonPrimitive?.contentOrNull

    @Test
    fun `registers, joins and talks to a real server`() {
        assumeTrue("set -Dswitchboard.irc=host:port to run", target != null)
        val (host, port) = target!!.split(":").let { it[0] to it[1].toInt() }

        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val recorder = Recorder()
        val channel = "#kt-live-${System.currentTimeMillis() % 100000}"

        val connection = IrcConnection(
            ServerConfig(
                id = "live",
                name = "Live",
                host = host,
                port = port,
                tls = false,
                nick = "sbkotlin",
                username = "sbkotlin",
                realname = "Switchboard Android engine",
                autoConnect = true,
                autoJoin = listOf(channel),
                profile = mapOf(
                    "display-name" to "Android Engine",
                    "pronouns" to "they/them",
                    "color" to "#a6e3a1"
                )
            ),
            scope,
            recorder::record
        )

        try {
            connection.start()

            val connected = recorder.waitFor("irc:connected")
            assertNotNull("never registered", connected)
            assertEquals("sbkotlin", connected!!.str("nick"))

            // The roster arrives, and we are in it
            val names = recorder.waitFor("irc:names") { it.str("channel").equals(channel, true) }
            assertNotNull("no roster for $channel", names)

            // Nothing the server refused
            val errors = recorder.on("irc:error").map { it.str("error") }
            assertTrue("server complained: $errors", errors.isEmpty())

            // Say something and hear it come back
            connection.say(channel, "hello from the android engine")
            val echoed = recorder.waitFor("irc:message") {
                it["message"]?.jsonObject?.str("content") == "hello from the android engine"
            }
            assertNotNull("our own message never came back", echoed)

            // A multiline message reassembles into one
            connection.say(channel, "alpha\nbeta\ngamma")
            val multiline = recorder.waitFor("irc:message") {
                it["message"]?.jsonObject?.str("content")?.contains("\n") == true
            }
            assertEquals("alpha\nbeta\ngamma", multiline?.get("message")?.jsonObject?.str("content"))

            // Our own profile went up and came back
            val metadata = recorder.waitFor("irc:metadata", seconds = 10) {
                it.str("key") == "display-name"
            }
            assertEquals("Android Engine", metadata?.str("value"))
        } finally {
            connection.stop("test over")
            scope.cancel()
        }
    }

    @Test
    fun `authenticates with SCRAM-SHA-256 against a real server`() {
        assumeTrue("set -Dswitchboard.irc=host:port to run", target != null)
        // A bare `return` here would report as a pass, which is worse than not
        // having the test at all
        val account = System.getProperty("switchboard.irc.account")
        val password = System.getProperty("switchboard.irc.password")
        assumeTrue("set -Dswitchboard.irc.account and .password to run", account != null && password != null)

        val (host, port) = target!!.split(":").let { it[0] to it[1].toInt() }
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        val recorder = Recorder()

        val connection = IrcConnection(
            ServerConfig(
                id = "live-sasl",
                name = "Live",
                host = host,
                port = port,
                tls = false,
                nick = "sbkotsasl",
                saslMechanism = "SCRAM-SHA-256",
                saslUsername = account,
                saslPassword = password
            ),
            scope,
            recorder::record
        )

        try {
            connection.start()
            assertNotNull("never registered", recorder.waitFor("irc:connected"))
            assertEquals(account, connection.state.account)
            assertTrue(recorder.on("irc:error").isEmpty())
        } finally {
            connection.stop("test over")
            scope.cancel()
        }
    }
}
