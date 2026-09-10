package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.switchboard.android.ui.completedDraft
import org.switchboard.android.ui.completionsFor

/**
 * Finishing somebody's name.
 *
 * Tab completion is how people address each other on IRC and a phone has no
 * tab, so the answers go in a row above the composer. Getting the *ending*
 * right matters as much as the matching: "robin: " at the start of a line is
 * what makes the highlight land on robin rather than reading as a passing
 * mention of them.
 */
class CompletionTest {

    private val room = listOf("robin", "Robert", "mara", "rob")

    @Test
    fun `a prefix offers everyone it could be`() {
        assertEquals(listOf("rob", "Robert", "robin"), completionsFor("ro", room))
    }

    @Test
    fun `case does not have to match`() {
        assertEquals(listOf("Robert"), completionsFor("rober", room))
        assertEquals(listOf("Robert"), completionsFor("ROBER", room))
    }

    @Test
    fun `one letter is not enough to offer anything`() {
        assertTrue(completionsFor("r", room).isEmpty())
        assertTrue(completionsFor("", room).isEmpty())
    }

    @Test
    fun `a name already finished is not offered back`() {
        assertEquals(listOf("Robert", "robin"), completionsFor("rob", room))
    }

    @Test
    fun `a busy channel does not fill the screen`() {
        val crowd = (1..40).map { "person$it" }
        assertEquals(6, completionsFor("person", crowd).size)
    }

    // ── what the box ends up saying ──────────────────────────────────

    @Test
    fun `a name at the start of a line is addressed to them`() {
        assertEquals("robin: ", completedDraft("rob", listOf("robin").first()))
    }

    @Test
    fun `a name in the middle of a sentence is just a name`() {
        assertEquals("ask robin ", completedDraft("ask rob", "robin"))
    }

    @Test
    fun `the rest of the sentence is left alone`() {
        assertEquals("did you ask Robert ", completedDraft("did you ask rober", "Robert"))
    }
}
