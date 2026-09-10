package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import org.switchboard.android.irc.Handlers
import java.io.File

/**
 * What the two clients answer.
 *
 * The same list `tests/main/parity.test.ts` checks the desktop against. Two
 * clients that handle different messages behave differently on the same
 * network, and the seam shows up exactly when one takes over from the other —
 * which is when nobody is watching. The desktop was missing four numerics this
 * client already had, and nothing was watching for that either.
 */
class HandlerParityTest {

    private val fixtures = File(
        System.getProperty("switchboard.fixtures")
            ?: error("switchboard.fixtures is not set; see app/build.gradle.kts")
    )

    private val corpus = Json { ignoreUnknownKeys = true }
        .parseToJsonElement(File(fixtures, "handlers-parity.json").readText())
        .jsonObject

    @Test
    fun `answers exactly what the shared list says`() {
        Handlers.installAll()

        val expected = corpus["handled"]!!.jsonArray
            .map { it.jsonPrimitive.content }
            .toSet()

        val desktopOnly = corpus["desktopOnly"]!!.jsonObject.keys
        val phoneOnly = corpus["phoneOnly"]!!.jsonObject.keys

        val mine = Handlers.registered()

        assertEquals(
            "handled on the desktop and not here",
            emptySet<String>(),
            expected - desktopOnly - mine
        )
        assertEquals(
            "handled here and not on the desktop, with no reason recorded",
            emptySet<String>(),
            mine - expected - phoneOnly
        )
    }
}
