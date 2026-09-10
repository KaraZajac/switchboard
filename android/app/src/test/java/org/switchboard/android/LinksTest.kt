package org.switchboard.android

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test
import org.switchboard.android.irc.Links
import java.io.File

/**
 * Finding the links in a line of text.
 *
 * The same corpus `tests/shared/links.test.ts` reads. Two clients that find
 * different links in the same message render it differently — and until this
 * they did: the desktop kept the sentence's full stop inside the URL and the
 * phone dropped it, and both truncated a Wikipedia link at its first bracket.
 */
class LinksTest {

    private val fixtures = File(
        System.getProperty("switchboard.fixtures")
            ?: error("switchboard.fixtures is not set; see app/build.gradle.kts")
    )

    private val corpus = Json { ignoreUnknownKeys = true }
        .parseToJsonElement(File(fixtures, "links.json").readText())
        .jsonObject

    @Test
    fun `finds the same links the desktop finds`() {
        for (entry in corpus["cases"]!!.jsonArray) {
            val case = entry.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val text = case["text"]!!.jsonPrimitive.content
            val expected = case["links"]!!.jsonArray.map { it.jsonPrimitive.content }

            assertEquals(name, expected, Links.find(text).map { it.url })
        }
    }

    @Test
    fun `reports where each link is, so a renderer can style exactly that run`() {
        val text = "see https://example.com/a. and https://two.example/b"
        for (link in Links.find(text)) {
            assertEquals(link.url, text.substring(link.start, link.end))
        }
    }
}
