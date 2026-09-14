package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.ui.mentionedDraft
import org.switchboard.android.ui.mentionsFor

/**
 * Finishing somebody's name.
 *
 * A phone has no Tab key, so the answers go in a row above the composer —
 * and only once an `@` is typed, because a row that appeared for any two
 * letters sat over the keyboard while people typed ordinary words. Getting
 * the *ending* right matters as much as the matching: the `@` stays, the
 * name is spelt the way the channel spells it, and a space follows so the
 * sentence can go on.
 */
class CompletionTest {

    private val room = listOf("robin", "Robert", "mara", "rob")

    @Test
    fun `nothing is offered until an @ is typed`() {
        assertTrue(mentionsFor("ro", room).isEmpty())
        assertTrue(mentionsFor("robin", room).isEmpty())
        assertTrue(mentionsFor("", room).isEmpty())
    }

    @Test
    fun `an @ alone offers everyone here`() {
        assertEquals(listOf("mara", "rob", "Robert", "robin"), mentionsFor("@", room))
    }

    @Test
    fun `the letters after the @ narrow it down`() {
        assertEquals(listOf("rob", "Robert", "robin"), mentionsFor("hi @r", room))
        assertEquals(listOf("Robert", "robin"), mentionsFor("hi @robe", room).plus(mentionsFor("hi @robi", room)))
    }

    @Test
    fun `a name typed out in full still shows, to be finished`() {
        // Unlike Tab completion: the row is how the mention gets its ending
        assertEquals(listOf("rob", "Robert", "robin"), mentionsFor("hi @rob", room))
    }

    @Test
    fun `case does not have to match`() {
        assertEquals(listOf("Robert"), mentionsFor("@ROBE", room))
    }

    @Test
    fun `an address is not a mention`() {
        assertTrue(mentionsFor("write to me@ro", room).isEmpty())
    }

    @Test
    fun `a busy channel does not fill the screen`() {
        val crowd = (1..40).map { "person$it" }
        assertEquals(10, mentionsFor("@person", crowd).size)
    }

    // ── what the box ends up saying ──────────────────────────────────

    @Test
    fun `the name replaces what was typed after the @`() {
        assertEquals("@robin ", mentionedDraft("@rob", "robin"))
    }

    @Test
    fun `the rest of the sentence is left alone`() {
        assertEquals("did you ask @Robert ", mentionedDraft("did you ask @rober", "Robert"))
    }

    @Test
    fun `a bare @ is finished too`() {
        assertEquals("thanks @mara ", mentionedDraft("thanks @", "mara"))
    }
}
