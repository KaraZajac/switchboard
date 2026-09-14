package org.switchboard.android.irc

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Emoji by name.
 *
 * The Kotlin half of `src/shared/emoji.ts`, checked against
 * `tests/fixtures/shortcodes.json`. The table is the desktop's `emoji.json`,
 * copied into this app's assets at build time like the network list, and
 * loaded once at start; the phone's keyboard has a picker of its own, so
 * here the point is `:smi` in the box offering `smile` above it, and
 * `:tada:` going out as the party popper.
 */
object Emoji {

    data class Entry(val emoji: String, val name: String, val keywords: List<String> = emptyList())

    /** The whole table, once [load] has run; empty until then */
    @Volatile
    var table: List<Entry> = emptyList()
        private set

    fun load(context: Context) {
        table = runCatching {
            val text = context.assets.open("emoji.json").bufferedReader().use { it.readText() }
            parse(Json.parseToJsonElement(text).jsonArray)
        }.getOrElse { emptyList() }
    }

    fun parse(array: JsonArray): List<Entry> = array.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        Entry(
            emoji = row["emoji"]?.jsonPrimitive?.content ?: return@mapNotNull null,
            name = row["name"]?.jsonPrimitive?.content ?: return@mapNotNull null,
            keywords = (row["keywords"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()
        )
    }

    /** A colon at the start of a word and at least two letters after it */
    private val SHORTCODE = Regex("(?:^|\\s):([a-z0-9_+-]{2,})$", RegexOption.IGNORE_CASE)

    /** The name being typed, or null when nothing is */
    fun query(draft: String): String? = SHORTCODE.find(draft)?.groupValues?.get(1)

    /**
     * What a name so far could be: names that start with it first, in
     * order, then anything whose name or keywords contain it.
     */
    fun candidates(query: String, entries: List<Entry> = table, limit: Int = 8): List<Entry> {
        val wanted = query.lowercase()
        if (wanted.isEmpty()) return entries.take(limit)
        // Shortest first: `sm` should offer `smile` before `small_orange_diamond`
        val starts = entries.filter { it.name.startsWith(wanted) }
            .sortedWith(compareBy({ it.name.length }, { it.name }))
        val mentions = entries.filter {
            !it.name.startsWith(wanted) &&
                (it.name.contains(wanted) || it.keywords.any { k -> k.contains(wanted) })
        }
        return (starts + mentions).take(limit)
    }

    /** The draft with the name being typed replaced by the emoji, and a space to go on */
    fun complete(draft: String, emoji: String): String {
        val match = SHORTCODE.find(draft) ?: return draft
        val at = match.range.first + if (match.value.startsWith(":")) 0 else 1
        return draft.substring(0, at) + emoji + " "
    }

    private val FINISHED = Regex("(^|[\\s(\\[])(:([a-z0-9_+-]+):)", RegexOption.IGNORE_CASE)

    /**
     * Every finished `:name:` in a line turned into its emoji, on the way
     * out. Only at the start of a word, and only names the table knows.
     */
    fun replaceShortcodes(text: String, entries: List<Entry> = table): String =
        FINISHED.replace(text) { match ->
            val name = match.groupValues[3].lowercase()
            val found = entries.firstOrNull { it.name == name }
            if (found != null) match.groupValues[1] + found.emoji else match.value
        }
}
