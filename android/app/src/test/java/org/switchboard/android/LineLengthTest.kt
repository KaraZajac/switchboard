package org.switchboard.android

import org.junit.Assert.assertEquals
import org.junit.Test
import org.switchboard.android.irc.LineLength

/**
 * Where a long line may be cut.
 *
 * `tests/fixtures/multiline.json` already holds this client and the desktop to
 * the same answers, but it took a machine with different Unicode data to show
 * that the old implementation disagreed with itself: the same thumbs-up stayed
 * whole on one JVM and came apart on another, because it asked
 * `BreakIterator` rather than working the joins out. On Android that data
 * changes with the API level, so the same message would have been cut
 * differently on two phones.
 *
 * These pin the clusters directly, so a regression shows up here as well as in
 * the corpus.
 */
class LineLengthTest {

    /** Cut so small that every cluster lands in a piece of its own */
    private fun clusters(text: String): List<String> = LineLength.split(text, 1)

    @Test
    fun `a skin tone is part of the hand it colours`() {
        assertEquals(listOf("👍🏽"), clusters("👍🏽"))
    }

    @Test
    fun `a flag is one thing, not two letters`() {
        assertEquals(listOf("🇬🇧"), clusters("🇬🇧"))
    }

    @Test
    fun `two flags in a row are two flags`() {
        assertEquals(listOf("🇬🇧", "🇳🇴"), clusters("🇬🇧🇳🇴"))
    }

    @Test
    fun `a family joined by zero-width joiners stays one cluster`() {
        val family = "👩‍👩‍👧"
        assertEquals(listOf(family), clusters(family))
    }

    @Test
    fun `a combining accent stays on its letter`() {
        assertEquals(listOf("é"), clusters("é"))
    }

    @Test
    fun `a variation selector does not become a piece of its own`() {
        assertEquals(listOf("❤️"), clusters("❤️"))
    }

    @Test
    fun `a keycap keeps its digit`() {
        assertEquals(listOf("1️⃣"), clusters("1️⃣"))
    }

    @Test
    fun `ordinary letters are still one cluster each`() {
        assertEquals(listOf("a", "b", "c"), clusters("abc"))
    }

    @Test
    fun `a line short enough is left alone`() {
        assertEquals(listOf("hello there"), LineLength.split("hello there", 50))
    }

    @Test
    fun `the pieces always join back up to what went in`() {
        for (text in listOf("ab 👍🏽 cd", "hi 🇬🇧", "日本語です", "é and 1️⃣")) {
            for (budget in 1..12) {
                assertEquals(text, LineLength.split(text, budget).joinToString(""))
            }
        }
    }
}
