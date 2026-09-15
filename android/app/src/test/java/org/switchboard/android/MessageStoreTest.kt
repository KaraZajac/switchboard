package org.switchboard.android

import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.switchboard.android.store.MessageStore

/**
 * The phone's own record of what was said.
 *
 * Two things have to hold. What the phone heard while it was the connection
 * must survive Android stopping the process, because it is the only copy
 * until the desktop is told. And the database must stay small, without ever
 * pruning away something still owed to the desktop.
 */
@RunWith(RobolectricTestRunner::class)
class MessageStoreTest {

    private lateinit var store: MessageStore

    private fun message(
        id: String,
        text: String = "hello",
        at: String = "2026-09-14T01:00:00.000Z",
        nick: String = "robin"
    ) = Message(id = id, nick = nick, content = text, timestamp = at, type = "privmsg")

    @Before
    fun setUp() {
        store = MessageStore(ApplicationProvider.getApplicationContext())
        store.forgetEverything()
    }

    @After
    fun tearDown() {
        store.forgetEverything()
    }

    @Test
    fun `keeps what it was told, in the order it is read`() {
        store.remember("srv", "#lobby", message("m1", "first", "2026-09-14T01:00:00.000Z"), false)
        store.remember("srv", "#lobby", message("m2", "second", "2026-09-14T01:00:01.000Z"), false)

        assertEquals(
            listOf("first", "second"),
            store.recent("srv", "#lobby").map { it.content }
        )
    }

    @Test
    fun `a channel is the same channel whatever its case`() {
        store.remember("srv", "#Lobby", message("m1"), false)
        assertEquals(1, store.recent("srv", "#LOBBY").size)
    }

    @Test
    fun `the same message twice is one message`() {
        store.remember("srv", "#lobby", message("m1"), false)
        store.remember("srv", "#lobby", message("m1"), false)
        assertEquals(1, store.recent("srv", "#lobby").size)
    }

    @Test
    fun `a replay does not undo a hand-over that already happened`() {
        store.remember("srv", "#lobby", message("m1"), needsHandover = true)
        store.markHandedOver(listOf("m1"))
        // The same message arriving again — live, then in a replay
        store.remember("srv", "#lobby", message("m1"), needsHandover = true)

        assertEquals(0, store.pendingCount())
    }

    @Test
    fun `conversations with people are kept apart from channels`() {
        store.remember("srv", "#lobby", message("m1", "in the channel"), false)
        store.remember("srv", "robin", message("m2", "a direct message"), false)

        assertEquals(listOf("in the channel"), store.recent("srv", "#lobby").map { it.content })
        assertEquals(listOf("a direct message"), store.recent("srv", "robin").map { it.content })
    }

    @Test
    fun `says what conversations there are, so a launch can put them back`() {
        store.remember("one", "#lobby", message("m1"), false)
        store.remember("one", "robin", message("m2"), false)
        store.remember("two", "#help", message("m3"), false)

        val found = store.conversations().map { it.serverId to it.channel }.toSet()
        assertEquals(setOf("one" to "#lobby", "one" to "robin", "two" to "#help"), found)
    }

    // ── what is still owed to the desktop ────────────────────────────

    @Test
    fun `only what this phone heard itself is owed`() {
        store.remember("srv", "#lobby", message("mine"), needsHandover = true)
        store.remember("srv", "#lobby", message("theirs"), needsHandover = false)

        assertEquals(1, store.pendingCount())
        assertEquals(listOf("mine"), store.pendingHandover()!!.rows.map { it.second.id })
    }

    @Test
    fun `a batch is one network, and says which`() {
        store.remember("one", "#lobby", message("m1"), true)
        store.remember("one", "#help", message("m2"), true)
        store.remember("two", "#lobby", message("m3"), true)

        val first = store.pendingHandover()!!
        assertEquals("one", first.serverId)
        assertEquals(listOf("m1", "m2"), first.rows.map { it.second.id })

        store.markHandedOver(first.rows.map { it.second.id })
        assertEquals("two", store.pendingHandover()!!.serverId)
    }

    @Test
    fun `the conversation travels with the message`() {
        store.remember("srv", "#lobby", message("m1"), true)
        assertEquals("#lobby", store.pendingHandover()!!.rows.first().first)
    }

    @Test
    fun `asking does not clear, so a send that fails loses nothing`() {
        store.remember("srv", "#lobby", message("m1"), true)

        store.pendingHandover()
        store.pendingHandover()

        assertEquals(1, store.pendingCount())
    }

    @Test
    fun `what the desktop took is no longer owed`() {
        store.remember("srv", "#lobby", message("m1"), true)
        store.markHandedOver(listOf("m1"))

        assertEquals(0, store.pendingCount())
        assertNull(store.pendingHandover())
        // Still readable here, though: handing it over is not forgetting it
        assertEquals(1, store.recent("srv", "#lobby").size)
    }

    @Test
    fun `nothing owed is nothing to send`() {
        assertNull(store.pendingHandover())
        assertEquals(0, store.pendingCount())
    }

    // ── staying small ───────────────────────────────────────────────

    @Test
    fun `a busy channel keeps the recent end, not all of it`() {
        for (i in 1..MessageStore.KEEP_PER_CONVERSATION + 40) {
            store.remember("srv", "#lobby", message("m$i", "line $i", "2026-09-14T01:%02d:00.000Z".format(i % 60)), false)
        }

        val kept = store.recent("srv", "#lobby", limit = 1000)
        assertTrue(kept.size <= MessageStore.KEEP_PER_CONVERSATION)
    }

    @Test
    fun `pruning never drops something the desktop has not been given`() {
        store.remember("srv", "#lobby", message("owed", "the only copy", "2026-09-14T00:00:00.000Z"), needsHandover = true)
        for (i in 1..MessageStore.KEEP_PER_CONVERSATION + 40) {
            store.remember("srv", "#lobby", message("m$i", "line $i", "2026-09-14T02:00:00.000Z"), false)
        }

        assertEquals(1, store.pendingCount())
        assertEquals(listOf("owed"), store.pendingHandover()!!.rows.map { it.second.id })
    }

    @Test
    fun `one busy channel does not push out another`() {
        store.remember("srv", "#quiet", message("q1", "still here"), false)
        for (i in 1..MessageStore.KEEP_PER_CONVERSATION + 20) {
            store.remember("srv", "#busy", message("b$i"), false)
        }

        assertEquals(listOf("still here"), store.recent("srv", "#quiet").map { it.content })
    }

    // ── corrections ─────────────────────────────────────────────────

    @Test
    fun `a correction is kept as one`() {
        store.remember("srv", "#lobby", message("m1", "teh"), false)
        store.edit("m1", "the", "2026-09-14T01:00:05.000Z")

        val kept = store.recent("srv", "#lobby").first()
        assertEquals("the", kept.content)
        assertEquals("2026-09-14T01:00:05.000Z", kept.editedAt)
    }

    @Test
    fun `a retraction leaves a tombstone rather than a hole`() {
        store.remember("srv", "#lobby", message("m1"), false)
        store.redact("m1", "robin")

        assertEquals("robin", store.recent("srv", "#lobby").first().redactedBy)
    }

    // ── read markers ────────────────────────────────────────────────

    @Test
    fun `remembers where a conversation was read up to`() {
        store.rememberReadMarker("srv", "#lobby", "2026-09-14T01:00:00.000Z")
        assertEquals("2026-09-14T01:00:00.000Z", store.readMarker("srv", "#lobby"))
    }

    @Test
    fun `a conversation nobody has read has no marker`() {
        assertNull(store.readMarker("srv", "#lobby"))
    }

    @Test
    fun `the marker is the same whatever case the channel is written in`() {
        store.rememberReadMarker("srv", "#Lobby", "2026-09-14T01:00:00.000Z")
        assertEquals("2026-09-14T01:00:00.000Z", store.readMarker("srv", "#LOBBY"))
    }

    @Test
    fun `reading further moves the marker down`() {
        store.rememberReadMarker("srv", "#lobby", "2026-09-14T01:00:00.000Z")
        store.rememberReadMarker("srv", "#lobby", "2026-09-14T02:00:00.000Z")
        assertEquals("2026-09-14T02:00:00.000Z", store.readMarker("srv", "#lobby"))
    }

    @Test
    fun `an older marker arriving late does not drag the line back up`() {
        // Three things set this — the phone reading, the desktop's copy, and
        // the server echoing MARKREAD — and they do not arrive in order
        store.rememberReadMarker("srv", "#lobby", "2026-09-14T02:00:00.000Z")
        store.rememberReadMarker("srv", "#lobby", "2026-09-14T01:00:00.000Z")
        assertEquals("2026-09-14T02:00:00.000Z", store.readMarker("srv", "#lobby"))
    }

    @Test
    fun `markers are kept per conversation and per network`() {
        store.rememberReadMarker("one", "#lobby", "2026-09-14T01:00:00.000Z")
        store.rememberReadMarker("one", "robin", "2026-09-14T02:00:00.000Z")
        store.rememberReadMarker("two", "#lobby", "2026-09-14T03:00:00.000Z")

        assertEquals("2026-09-14T01:00:00.000Z", store.readMarker("one", "#lobby"))
        assertEquals("2026-09-14T02:00:00.000Z", store.readMarker("one", "robin"))
        assertEquals("2026-09-14T03:00:00.000Z", store.readMarker("two", "#lobby"))
    }

    @Test
    fun `nothing is written for a marker with no timestamp`() {
        store.rememberReadMarker("srv", "#lobby", "")
        assertNull(store.readMarker("srv", "#lobby"))
    }

    // ── the same network under another id ───────────────────────────

    @Test
    fun `moving a network takes its messages with it`() {
        store.remember("old", "#lobby", message("m1", "still here"), needsHandover = false)

        store.reidentify("old", "new")

        assertTrue(store.recent("old", "#lobby").isEmpty())
        assertEquals(listOf("still here"), store.recent("new", "#lobby").map { it.content })
    }

    @Test
    fun `and what is still owed to the desktop`() {
        // The case that lost messages: handed over under an id the desktop had
        // never heard of, and dropped
        store.remember("old", "robin", message("m1"), needsHandover = true)

        store.reidentify("old", "new")

        assertEquals("new", store.pendingHandover()!!.serverId)
        assertEquals(1, store.pendingCount())
    }

    @Test
    fun `and its read markers`() {
        store.rememberReadMarker("old", "#lobby", "2026-09-14T01:00:00.000Z")

        store.reidentify("old", "new")

        assertNull(store.readMarker("old", "#lobby"))
        assertEquals("2026-09-14T01:00:00.000Z", store.readMarker("new", "#lobby"))
    }

    @Test
    fun `moving a network onto itself changes nothing`() {
        store.remember("srv", "#lobby", message("m1"), needsHandover = false)

        store.reidentify("srv", "srv")

        assertEquals(1, store.recent("srv", "#lobby").size)
    }

    // ── forgetting ──────────────────────────────────────────────────

    @Test
    fun `a network removed takes its conversations with it`() {
        store.remember("gone", "#lobby", message("m1"), false)
        store.remember("kept", "#lobby", message("m2"), false)

        store.forgetServer("gone")

        assertTrue(store.recent("gone", "#lobby").isEmpty())
        assertEquals(1, store.recent("kept", "#lobby").size)
    }

    @Test
    fun `a network removed takes its read markers with it`() {
        store.rememberReadMarker("gone", "#lobby", "2026-09-14T01:00:00.000Z")
        store.rememberReadMarker("kept", "#lobby", "2026-09-14T01:00:00.000Z")

        store.forgetServer("gone")

        assertNull(store.readMarker("gone", "#lobby"))
        assertEquals("2026-09-14T01:00:00.000Z", store.readMarker("kept", "#lobby"))
    }
}
