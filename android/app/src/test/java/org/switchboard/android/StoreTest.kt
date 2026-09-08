package org.switchboard.android

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * The phone's copy of the world.
 *
 * Everything here is a case that shipped wrong at least once: a direct message
 * with nowhere to live, a scrollback page that arrived twice, an edit that
 * appeared as a second message. They are cheap to get right and expensive to
 * notice, which is exactly what tests are for.
 */
class StoreTest {

    private lateinit var store: SwitchboardStore
    private val server = "s1"

    @Before
    fun setUp() {
        store = SwitchboardStore()
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "me")
        store.channels[server] = mutableListOf(Channel("#lounge"))
        store.activeServerId = server
        store.activeChannel = "#lounge"
    }

    private fun message(id: String, nick: String, text: String, at: String): JsonElement =
        buildJsonObject {
            put("id", id)
            put("nick", nick)
            put("content", text)
            put("timestamp", at)
            put("type", "privmsg")
        }

    private fun incoming(channel: String, id: String, nick: String, text: String) =
        buildJsonObject {
            put("serverId", server)
            put("channel", channel)
            put("message", message(id, nick, text, "2026-09-08T12:00:00Z"))
        }

    // ── direct messages ──────────────────────────────────────────────

    @Test
    fun `a direct message creates a conversation to hold it`() {
        store.activeChannel = "#lounge"
        store.handleEvent("irc:message", incoming("robin", "m1", "robin", "are you there?"))

        assertEquals(listOf("robin"), store.directMessages(server))
        assertEquals(1, store.messagesFor(server, "robin").size)
    }

    @Test
    fun `a direct message counts as a mention even without your nick in it`() {
        store.handleEvent("irc:message", incoming("robin", "m1", "robin", "hello"))

        val conversation = store.channelsFor(server).first { it.name == "robin" }
        assertEquals(1, conversation.mentions)
    }

    @Test
    fun `people are not listed as channels`() {
        store.openConversation(server, "robin")

        assertTrue(store.channelsFor(server).any { it.name == "robin" })
        assertFalse(isChannel("robin"))
        assertTrue(isChannel("#lounge"))
        assertTrue(isChannel("&local"))
    }

    @Test
    fun `opening the same conversation twice does not duplicate it`() {
        store.openConversation(server, "robin")
        store.openConversation(server, "robin")

        assertEquals(1, store.channelsFor(server).count { it.name == "robin" })
    }

    // ── scrollback ───────────────────────────────────────────────────

    @Test
    fun `older messages go above the ones already held`() {
        store.setHistory(
            server, "#lounge",
            buildJsonArray { add(message("m3", "a", "third", "2026-09-08T12:03:00Z")) }
        )

        val added = store.prependHistory(
            server, "#lounge",
            buildJsonArray {
                add(message("m1", "a", "first", "2026-09-08T12:01:00Z"))
                add(message("m2", "a", "second", "2026-09-08T12:02:00Z"))
            }
        )

        assertEquals(2, added)
        assertEquals(
            listOf("first", "second", "third"),
            store.messagesFor(server, "#lounge").map { it.content }
        )
    }

    @Test
    fun `a page we already hold adds nothing, which is how paging ends`() {
        store.setHistory(
            server, "#lounge",
            buildJsonArray { add(message("m1", "a", "first", "2026-09-08T12:01:00Z")) }
        )

        val added = store.prependHistory(
            server, "#lounge",
            buildJsonArray { add(message("m1", "a", "first", "2026-09-08T12:01:00Z")) }
        )

        assertEquals(0, added)
        assertEquals(1, store.messagesFor(server, "#lounge").size)
    }

    // ── edits ────────────────────────────────────────────────────────

    @Test
    fun `an edit replaces the message rather than adding one`() {
        store.handleEvent("irc:message", incoming("#lounge", "m1", "me", "teh typo"))

        store.handleEvent("irc:edit", buildJsonObject {
            put("serverId", server)
            put("channel", "#lounge")
            put("originalId", "m1")
            put("newContent", "the typo")
            put("editedAt", "2026-09-08T12:05:00Z")
        })

        val held = store.messagesFor(server, "#lounge")
        assertEquals(1, held.size)
        assertEquals("the typo", held[0].content)
        assertEquals("2026-09-08T12:05:00Z", held[0].editedAt)
    }

    @Test
    fun `an edit for a message we never saw changes nothing`() {
        store.handleEvent("irc:edit", buildJsonObject {
            put("serverId", server)
            put("channel", "#lounge")
            put("originalId", "gone")
            put("newContent", "whatever")
        })

        assertTrue(store.messagesFor(server, "#lounge").isEmpty())
    }

    // ── search ───────────────────────────────────────────────────────

    @Test
    fun `local search finds what this phone is holding, newest first`() {
        store.handleEvent("irc:message", incoming("#lounge", "m1", "a", "the deploy went out"))
        store.handleEvent("irc:message", buildJsonObject {
            put("serverId", server)
            put("channel", "#dev")
            put("message", message("m2", "b", "deploy notes here", "2026-09-08T13:00:00Z"))
        })

        val everywhere = store.searchLocally(server, "deploy", null)
        assertEquals(2, everywhere.size)
        assertEquals("deploy notes here", everywhere[0].content)

        val oneChannel = store.searchLocally(server, "deploy", "#dev")
        assertEquals(1, oneChannel.size)
        assertEquals("#dev", oneChannel[0].channel)
    }

    @Test
    fun `local search ignores case`() {
        store.handleEvent("irc:message", incoming("#lounge", "m1", "a", "The Deploy Went Out"))

        assertEquals(1, store.searchLocally(server, "deploy", null).size)
    }

    // ── the channel browser ──────────────────────────────────────────

    @Test
    fun `a browse in progress is not an empty result`() {
        store.beginChannelList(server)

        assertFalse(store.channelListComplete)
        assertTrue(store.channelListing.isEmpty())

        store.handleEvent("irc:list-entry", buildJsonObject {
            put("serverId", server)
            put("channel", "#music")
            put("users", 12)
            put("topic", "songs")
        })
        store.handleEvent("irc:list-end", buildJsonObject { put("serverId", server) })

        assertTrue(store.channelListComplete)
        assertEquals(1, store.channelListing.size)
        assertEquals("#music", store.channelListing[0].name)
        assertEquals(12, store.channelListing[0].users)
    }

    @Test
    fun `a listing from another server is not ours`() {
        store.beginChannelList(server)
        store.handleEvent("irc:list-entry", buildJsonObject {
            put("serverId", "someone-else")
            put("channel", "#elsewhere")
            put("users", 3)
        })

        assertTrue(store.channelListing.isEmpty())
    }

    // ── the friend list ──────────────────────────────────────────────

    @Test
    fun `monitor tells us who is being watched and who is about`() {
        store.handleEvent("irc:monitor-list", buildJsonObject {
            put("serverId", server)
            put("targets", "robin,mara")
        })
        store.handleEvent("irc:monitor", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
            put("online", true)
        })

        assertEquals(listOf("robin", "mara"), store.watchedFor(server))
        assertTrue(store.isOnline(server, "ROBIN"))
        assertFalse(store.isOnline(server, "mara"))
    }

    // ── removing a network ───────────────────────────────────────────

    @Test
    fun `forgetting a server leaves nothing of it behind`() {
        store.handleEvent("irc:message", incoming("#lounge", "m1", "a", "hello"))
        store.metadata["$server:a"] = UserMetadata(displayName = "Ada")

        store.forgetServer(server)

        assertNull(store.servers[server])
        assertTrue(store.channelsFor(server).isEmpty())
        assertTrue(store.messagesFor(server, "#lounge").isEmpty())
        assertNull(store.metadata["$server:a"])
        assertNull(store.activeServerId)
    }

    // ── reactions in stored history ──────────────────────────────────

    @Test
    fun `history brings its reactions with it`() {
        store.setHistory(server, "#lounge", buildJsonArray {
            add(buildJsonObject {
                put("id", "m1")
                put("nick", "robin")
                put("content", "ship it")
                put("timestamp", "2026-09-08T12:00:00Z")
                put("reactions", buildJsonObject {
                    put("\uD83D\uDD25", buildJsonArray {
                        add(JsonPrimitive("kara"))
                        add(JsonPrimitive("jules"))
                    })
                })
            })
        })

        val held = store.messagesFor(server, "#lounge").single()
        assertEquals(setOf("kara", "jules"), held.reactions["\uD83D\uDD25"])
    }

    @Test
    fun `an empty reaction list is not a reaction`() {
        store.setHistory(server, "#lounge", buildJsonArray {
            add(buildJsonObject {
                put("id", "m1")
                put("nick", "robin")
                put("content", "ship it")
                put("timestamp", "2026-09-08T12:00:00Z")
                put("reactions", buildJsonObject { put("\uD83D\uDD25", buildJsonArray { }) })
            })
        })

        assertTrue(store.messagesFor(server, "#lounge").single().reactions.isEmpty())
    }

    // ── renames ──────────────────────────────────────────────────────

    @Test
    fun `a profile follows the person through a rename`() {
        store.metadata["$server:robin"] = UserMetadata(displayName = "Robin", pronouns = "she/her")

        store.handleEvent("irc:nick", buildJsonObject {
            put("serverId", server)
            put("oldNick", "robin")
            put("newNick", "robin_")
        })

        assertEquals("Robin", store.metadataFor(server, "robin_").displayName)
        assertNull(store.metadata["$server:robin"])
    }

    @Test
    fun `our own rename keeps our own profile`() {
        store.servers[server] = Server(id = server, name = "Test", host = "h", nick = "me_")
        store.metadata["$server:me_"] = UserMetadata(displayName = "Kara")

        store.handleEvent("irc:nick", buildJsonObject {
            put("serverId", server)
            put("oldNick", "me_")
            put("newNick", "me")
        })

        assertEquals("me", store.servers[server]?.nick)
        assertEquals("Kara", store.metadataFor(server, "me").displayName)
    }
}

private fun kotlinx.serialization.json.JsonArrayBuilder.add(element: JsonElement) {
    @Suppress("DEPRECATION")
    this.add(element as JsonElement)
}
