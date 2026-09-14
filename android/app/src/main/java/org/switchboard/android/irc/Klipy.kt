package org.switchboard.android.irc

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.Json
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Klipy, the GIF picker's source.
 *
 * The Kotlin half of `src/shared/klipy.ts`, checked against
 * `tests/fixtures/klipy.json`. Which of the several files in an answer to
 * draw and to send is decided the same way on both clients, because a GIF
 * picked on one device is a link the other has to show.
 */
object Klipy {

    const val API_KEY = "1xQDx9n6q39fXn2j7FbcqMfkyMycbdhu2TuekgY2olcinbjC5lhty6JV7ue1mK0l"
    const val API_BASE = "https://api.klipy.com/api/v1/$API_KEY"

    /** A tab of the picker: the API's own name for it, and what to call it */
    data class Tab(val id: String, val label: String)

    val TABS = listOf(
        Tab("gifs", "GIFs"),
        Tab("stickers", "Stickers"),
        Tab("clips", "Clips"),
        Tab("static-memes", "Memes"),
        Tab("emojis", "Emoji")
    )

    fun trendingUrl(tab: String, perPage: Int = 20): String = "$API_BASE/$tab/trending?per_page=$perPage"

    fun searchUrl(tab: String, query: String, perPage: Int = 20): String =
        "$API_BASE/$tab/search?q=${URLEncoder.encode(query, "UTF-8")}&per_page=$perPage"

    /** One item, as the API sent it */
    class Item(val json: JsonObject) {
        val url: String get() = json.text("url").orEmpty()
        val title: String get() = json.text("title").orEmpty()
        val slug: String get() = json.text("slug").orEmpty()
        private val file: JsonObject? get() = json["file"] as? JsonObject

        /** Whether the file object uses the flat format (clips) rather than size variants */
        private fun flat(f: JsonObject): Boolean =
            f["mp4"] is JsonPrimitive || f["gif"] is JsonPrimitive || f["webp"] is JsonPrimitive

        private fun JsonObject.size(name: String): JsonObject? = this[name] as? JsonObject
        private fun JsonObject.formatUrl(name: String): String? = (this[name] as? JsonObject)?.text("url")

        /** The best preview: a small animated format for a thumbnail */
        val previewUrl: String
            get() {
                val f = file ?: return url
                if (flat(f)) return f.text("webp") ?: f.text("gif") ?: f.text("mp4") ?: url
                val variant = f.size("sm") ?: f.size("md") ?: f.size("hd") ?: f.size("xs") ?: return url
                return variant.formatUrl("webp") ?: variant.formatUrl("gif") ?: variant.formatUrl("png")
                    ?: variant.formatUrl("mp4") ?: url
            }

        /** The best address to send: the HD animated one */
        val shareUrl: String
            get() {
                val f = file ?: return url
                if (flat(f)) return f.text("gif") ?: f.text("mp4") ?: f.text("webp") ?: url
                val variant = f.size("hd") ?: f.size("md") ?: f.size("sm") ?: return url
                return variant.formatUrl("gif") ?: variant.formatUrl("webp") ?: variant.formatUrl("mp4")
                    ?: variant.formatUrl("png") ?: url
            }

        /** Whether the item is a video with no still or animated image alongside */
        val hasVideo: Boolean
            get() {
                val f = file ?: return false
                if (flat(f)) return f.text("mp4") != null && f.text("gif") == null &&
                    f.text("webp") == null && f.text("png") == null
                val variant = f.size("sm") ?: f.size("md") ?: f.size("hd") ?: return false
                return variant.formatUrl("mp4") != null && variant.formatUrl("gif") == null &&
                    variant.formatUrl("webp") == null && variant.formatUrl("png") == null
            }
    }

    /** The items out of an answer, which the API wraps one way for trending and another for search */
    fun parseResults(json: JsonElement): List<Item> {
        val data = (json as? JsonObject)?.get("data") ?: return emptyList()
        val array = when (data) {
            is JsonArray -> data
            is JsonObject -> data["data"] as? JsonArray ?: return emptyList()
            else -> return emptyList()
        }
        return array.mapNotNull { (it as? JsonObject)?.let(::Item) }
    }

    /**
     * Ask Klipy.
     *
     * Blocking: the picker calls it off the main thread. Klipy is the one
     * third party the app talks to on its own account rather than the
     * user's, so it is named honestly in the request.
     */
    fun fetch(url: String, userAgent: String): List<Item> {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("User-Agent", userAgent)
            setRequestProperty("Accept", "application/json")
        }
        try {
            val code = connection.responseCode
            if (code !in 200..299) throw IOException("Klipy answered $code")
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            return parseResults(Json.parseToJsonElement(body))
        } finally {
            connection.disconnect()
        }
    }

    private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
}
