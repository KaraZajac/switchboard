package org.switchboard.android

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
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
        store.handleEvent("irc:monitor-online", buildJsonObject {
            put("serverId", server)
            put("nick", "robin")
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
    // ── pairing before the desktop has connected ─────────────────────

    /**
     * Pair the phone before the desktop has dialled anything and the snapshot
     * it pulls is empty — so nothing gets selected, and nothing ever selected
     * one afterwards. The desktop would connect, join channels, send messages,
     * and the phone went on showing "nothing joined yet" until it was
     * restarted.
     */
    @Test
    fun `a server that connects later is the one we show`() {
        val empty = SwitchboardStore()
        empty.servers["s2"] = Server(id = "s2", name = "Doll", host = "h", nick = "me")
        assertNull("nothing is connected yet, so nothing is chosen", empty.activeServerId)

        empty.handleEvent("irc:connected", buildJsonObject {
            put("serverId", "s2")
            put("nick", "me")
        })

        assertEquals("s2", empty.activeServerId)
    }

    @Test
    fun `a channel joined on the desktop is the one we open`() {
        val empty = SwitchboardStore()
        empty.servers["s2"] = Server(id = "s2", name = "Doll", host = "h", nick = "me")

        empty.handleEvent("irc:connected", buildJsonObject {
            put("serverId", "s2"); put("nick", "me")
        })
        empty.handleEvent("irc:join", buildJsonObject {
            put("serverId", "s2")
            put("channel", "#after-pairing")
        })

        assertEquals("s2", empty.activeServerId)
        assertEquals("#after-pairing", empty.activeChannel)
        assertEquals(listOf("#after-pairing"), empty.channelsFor("s2").map { it.name })
    }

    /** Choosing one must not steal the screen from a server already open */
    @Test
    fun `another server connecting does not move us`() {
        store.handleEvent("irc:connected", buildJsonObject {
            put("serverId", "other"); put("nick", "me")
        })

        assertEquals(server, store.activeServerId)
        assertEquals("#lounge", store.activeChannel)
    }


    // ── a conversation that keeps up with itself ─────────────────────

    /**
     * Arriving messages have to *replace* the list, never edit it in place.
     *
     * The list used to be appended to and then "published" by writing a copy
     * back to the map. Neither half of that tells Compose anything: a plain
     * list mutated in place is not snapshot state, and a map write whose value
     * is equal to what is already there is a no-op — so the write did not even
     * replace the plain list with the state list it meant to.
     *
     * What it looked like: a channel froze after its first message and caught
     * up only when something else forced a redraw, which for a person meant
     * leaving the channel and coming back. It hid on every server with
     * `draft/chathistory`, because loading history replaces this value
     * wholesale and reset the conditions.
     *
     * So this asserts the property rather than the symptom: the list handed
     * out before a message arrives is not the list handed out after.
     */
    @Test
    fun `an arriving message replaces the list rather than editing it`() {
        store.handleEvent("irc:message", incoming("#lounge", "m1", "robin", "first"))
        val afterFirst = store.messagesFor(server, "#lounge")
        assertEquals(1, afterFirst.size)

        store.handleEvent("irc:message", incoming("#lounge", "m2", "robin", "second"))
        val afterSecond = store.messagesFor(server, "#lounge")

        assertEquals(2, afterSecond.size)
        // The one the screen was already holding must not have grown under it:
        // if it did, nothing told the screen anything.
        assertEquals(1, afterFirst.size)
        assertNotSame(afterFirst, afterSecond)
    }

    /** And it keeps doing it, however many arrive */
    @Test
    fun `a conversation keeps up over a run of messages`() {
        val seen = mutableListOf<List<Message>>()
        for (i in 1..5) {
            store.handleEvent("irc:message", incoming("#lounge", "m$i", "robin", "line $i"))
            seen.add(store.messagesFor(server, "#lounge"))
        }

        assertEquals(listOf(1, 2, 3, 4, 5), seen.map { it.size })
        // Five distinct lists, not one list five times
        assertEquals(5, seen.distinctBy { System.identityHashCode(it) }.size)
    }

    /** The same message twice is still one message, and changes nothing */
    @Test
    fun `a message that is already there does not replace anything`() {
        store.handleEvent("irc:message", incoming("#lounge", "m1", "robin", "first"))
        val before = store.messagesFor(server, "#lounge")

        store.handleEvent("irc:message", incoming("#lounge", "m1", "robin", "first"))
        val after = store.messagesFor(server, "#lounge")

        assertEquals(1, after.size)
        assertSame(before, after)
    }

    // ── what a snapshot from the desktop may and may not throw away ──

    /**
     * A snapshot says what the desktop is *in*. That is channels, and only
     * channels — the desktop's own state has no notion of the conversation
     * somebody opened by writing to you, so its snapshot cannot carry one.
     *
     * Applying it by replacing the list wholesale therefore deleted every
     * direct message on that network, every time the link to the desktop came
     * back. The conversation was still on the desktop and gone from the phone,
     * with nothing on screen to say why.
     */
    @Test
    fun `a snapshot from the desktop does not take the direct messages with it`() {
        store.handleEvent("irc:message", incoming("robin", "m1", "robin", "are you there?"))
        assertEquals(listOf("robin"), store.directMessages(server))

        store.applySnapshot(
            buildJsonArray {
                add(buildJsonObject {
                    put("serverId", server)
                    put("nick", "me")
                    put("channels", buildJsonArray {
                        add(buildJsonObject { put("name", "#lounge") })
                    })
                })
            },
            buildJsonArray {
                add(buildJsonObject {
                    put("id", server)
                    put("name", "Test")
                    put("host", "h")
                    put("nick", "me")
                })
            }
        )

        assertEquals(listOf("robin"), store.directMessages(server))
        assertEquals(1, store.messagesFor(server, "robin").size)
        // And the channels it did declare are there
        assertTrue(store.channelsFor(server).any { it.name == "#lounge" })
    }

    /** A channel the desktop has left is the desktop's to drop, and goes */
    @Test
    fun `a snapshot is still the last word on which channels there are`() {
        store.handleEvent("irc:join", buildJsonObject {
            put("serverId", server)
            put("channel", "#old")
        })
        assertTrue(store.channelsFor(server).any { it.name == "#old" })

        store.applySnapshot(
            buildJsonArray {
                add(buildJsonObject {
                    put("serverId", server)
                    put("nick", "me")
                    put("channels", buildJsonArray {
                        add(buildJsonObject { put("name", "#new") })
                    })
                })
            },
            buildJsonArray {
                add(buildJsonObject {
                    put("id", server); put("name", "Test"); put("host", "h"); put("nick", "me")
                })
            }
        )

        assertFalse(store.channelsFor(server).any { it.name == "#old" })
        assertTrue(store.channelsFor(server).any { it.name == "#new" })
    }

    /**
     * Selecting clears the counts by replacing the entry.
     *
     * It used to edit the `Channel` where it sat and write the same list back,
     * neither of which Compose notices — so a badge could stay lit on a
     * conversation you were looking at.
     */
    @Test
    fun `opening a conversation clears its badge in a way the screen can see`() {
        // Looking somewhere else, or the message would be read as it arrives
        store.activeChannel = "#elsewhere"
        store.handleEvent("irc:message", incoming("#lounge", "m1", "robin", "hello"))
        val before = store.channelsFor(server)
        assertTrue(before.first { it.name == "#lounge" }.unread > 0)

        store.select(server, "#lounge")
        val after = store.channelsFor(server)

        assertEquals(0, after.first { it.name == "#lounge" }.unread)
        assertNotSame(before, after)
        // The entry the screen was holding did not change under it
        assertTrue(before.first { it.name == "#lounge" }.unread > 0)
    }


    // ── everybody who has written to you, in one list ────────────────

    /**
     * The order both clients show conversations in.
     *
     * Unread first, so anything waiting on an answer is at the top, then by
     * name so the rest do not move around underneath it. The desktop used to
     * show them in whatever order the servers and their channels happened to
     * be walked in, which reshuffled as channels came and went.
     */
    @Test
    fun `conversations are ordered by what is waiting, then by name`() {
        store.activeChannel = "#elsewhere"
        store.handleEvent("irc:message", incoming("zoe", "m1", "zoe", "hi"))
        store.handleEvent("irc:message", incoming("adam", "m2", "adam", "hi"))
        store.handleEvent("irc:message", incoming("robin", "m3", "robin", "hi"))

        // adam has been read; the other two are still waiting
        store.select(server, "adam")
        store.activeChannel = "#elsewhere"

        assertEquals(
            listOf("robin", "zoe", "adam"),
            store.allDirectMessages().map { it.nick }
        )
    }

    /** A channel is not a conversation, and neither is NickServ */
    @Test
    fun `the list is people, not rooms or services`() {
        store.handleEvent("irc:message", incoming("#lounge", "m1", "robin", "in the room"))
        store.handleEvent("irc:message", incoming("robin", "m2", "robin", "and privately"))
        store.handleEvent("irc:message", incoming("NickServ", "m3", "NickServ", "please identify"))

        assertEquals(listOf("robin"), store.allDirectMessages().map { it.nick })
    }

    /**
     * The same nick on two networks is two people.
     *
     * This is the one place the shape cannot be copied from apps where an
     * account is the same account everywhere: a row that merges them is a row
     * you can answer wrongly, so each carries the network it belongs to.
     */
    @Test
    fun `the same name on two networks is two conversations`() {
        val other = "s2"
        store.servers[other] = Server(id = other, name = "Other", host = "h2", nick = "me")
        store.channels[other] = listOf(Channel("#hall"))

        store.handleEvent("irc:message", incoming("robin", "m1", "robin", "here"))
        store.handleEvent("irc:message", buildJsonObject {
            put("serverId", other)
            put("channel", "robin")
            put("message", message("m2", "robin", "and here", "2026-09-08T12:00:00Z"))
        })

        val all = store.allDirectMessages()
        assertEquals(2, all.size)
        assertEquals(setOf("Test", "Other"), all.map { it.serverName }.toSet())
        assertEquals(setOf(server, other), all.map { it.serverId }.toSet())
    }


    // ── the network's own picture ────────────────────────────────────

    /** What the rail draws instead of two letters, when a network offers one */
    @Test
    fun `keeps the network icon against the server`() {
        store.handleEvent("irc:network-icon", buildJsonObject {
            put("serverId", server)
            put("url", "https://example.org/net.png")
        })

        assertEquals("https://example.org/net.png", store.servers[server]?.icon)
    }

    /** And an icon for a network that is not here changes nothing */
    @Test
    fun `an icon for a server we do not have is ignored`() {
        store.handleEvent("irc:network-icon", buildJsonObject {
            put("serverId", "nosuch")
            put("url", "https://example.org/net.png")
        })

        assertNull(store.servers["nosuch"])
        assertNull(store.servers[server]?.icon)
    }

}

private fun kotlinx.serialization.json.JsonArrayBuilder.add(element: JsonElement) {
    @Suppress("DEPRECATION")
    this.add(element as JsonElement)
}
