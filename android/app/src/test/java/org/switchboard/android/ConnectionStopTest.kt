package org.switchboard.android

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.irc.IrcConnection
import org.switchboard.android.irc.ServerConfig
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import kotlin.concurrent.thread

/**
 * Stopping a connection on purpose is not a failure.
 *
 * `stop()` cancels the read job, so every deliberate stop — handing the
 * connection back to the desktop, leaving a network, the foreground service
 * going away — lands in the same catch a dropped socket does. It was reported
 * like one, and because a cancelled coroutine's message is
 * `StandaloneCoroutine was cancelled`, that sentence went on screen in red.
 * Kara saw it on her phone in a channel she was only reading.
 *
 * A real socket rather than a fake, because the bug is in what the coroutine
 * does when it is cancelled mid-read, and a fake that never blocks never gets
 * cancelled mid-anything.
 */
class ConnectionStopTest {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var server: ServerSocket? = null
    private val accepted = Collections.synchronizedList(mutableListOf<Socket>())

    @After
    fun tearDown() {
        for (socket in accepted) runCatching { socket.close() }
        runCatching { server?.close() }
        scope.cancel()
    }

    /** A server that accepts, optionally lets registration finish, and waits */
    private fun listening(welcome: Boolean = true): Int {
        val socket = ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())
        server = socket
        thread(isDaemon = true) {
            runCatching {
                while (true) {
                    val client = socket.accept()
                    accepted.add(client)
                    thread(isDaemon = true) {
                        runCatching {
                            if (welcome) {
                                val out = client.getOutputStream()
                                out.write(
                                    (":test 001 sbkotlin :Welcome\r\n" +
                                        ":test 376 sbkotlin :End of MOTD\r\n").toByteArray()
                                )
                                out.flush()
                            }
                            // Then hold it open, so the client sits in its read
                            // loop — which is where `stop()` has to cancel it
                            client.getInputStream().readBytes()
                        }
                    }
                }
            }
        }
        return socket.localPort
    }

    private fun connection(port: Int, record: (String, JsonElement) -> Unit) = IrcConnection(
        ServerConfig(
            id = "stoptest",
            name = "Stop test",
            host = "127.0.0.1",
            port = port,
            tls = false,
            nick = "sbkotlin",
            username = "sbkotlin",
            realname = "Switchboard Android engine",
            autoConnect = false,
            autoJoin = emptyList()
        ),
        scope,
        emitEvent = record
    )

    private fun errors(events: List<Pair<String, JsonObject>>): List<String> =
        events.filter { it.first == "irc:error" }
            .mapNotNull { it.second["message"]?.jsonPrimitive?.contentOrNull }

    @Test
    fun `handing the connection over reports nothing to the user`() {
        val events = Collections.synchronizedList(mutableListOf<Pair<String, JsonObject>>())
        val port = listening()
        val connection = connection(port) { channel, data -> events.add(channel to data.jsonObject) }

        connection.start()

        // Let it get as far as the read loop, which is what gets cancelled
        val deadline = System.currentTimeMillis() + 10_000
        while (System.currentTimeMillis() < deadline &&
            events.none { it.first == "irc:connected" }
        ) {
            Thread.sleep(50)
        }

        connection.stop("Handing over to desktop")
        Thread.sleep(600)

        // Nothing at all. "Socket closed" in red is as wrong as the
        // coroutine's own words: the user asked for this.
        val reported = errors(events)
        assertTrue("a deliberate stop reported: $reported", reported.isEmpty())
    }

    @Test
    fun `stopping one that never finished registering is quiet too`() {
        val events = Collections.synchronizedList(mutableListOf<Pair<String, JsonObject>>())
        // Accepts, then says nothing: the client is left waiting on 001, which
        // is where a hand-over catches it if the desktop appears mid-dial
        val port = listening(welcome = false)

        val connection = connection(port) { channel, data -> events.add(channel to data.jsonObject) }
        connection.start()
        Thread.sleep(400)
        connection.stop("Leaving")
        Thread.sleep(600)

        assertTrue("a stop mid-registration reported: ${errors(events)}", errors(events).isEmpty())
    }

    @Test
    fun `a connection that genuinely fails still says so`() {
        val events = Collections.synchronizedList(mutableListOf<Pair<String, JsonObject>>())
        // Nothing listening, so this is a real failure and the user's business
        val dead = ServerSocket(0, 1, java.net.InetAddress.getLoopbackAddress())
        val port = dead.localPort
        dead.close()

        val connection = connection(port) { channel, data -> events.add(channel to data.jsonObject) }
        connection.start()
        Thread.sleep(800)
        connection.stop("done")

        assertTrue("a refused connection said nothing", errors(events).isNotEmpty())
    }
}
