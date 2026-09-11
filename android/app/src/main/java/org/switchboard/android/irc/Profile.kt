package org.switchboard.android.irc

/**
 * One profile for you, and a different one where you want it.
 *
 * The Kotlin half of `src/shared/profile.ts`, checked against
 * `tests/fixtures/profile.json`.
 *
 * IRC has no global anything: `draft/metadata-2` is per network, and a server
 * only knows what you told it. So "global" is the client's own idea, kept in
 * the vault where both devices can see it and published to each network on
 * connect.
 *
 * A network with no profile of its own uses yours. One with a profile of its
 * own uses that field by field — set a display name for a network and only the
 * name changes there; your pronouns and picture still come from the one
 * profile you keep.
 */
object Profile {

    /**
     * What to publish to one network.
     *
     * An override merges over the global rather than replacing it, so "call me
     * something else here" does not also mean "and forget everything else
     * about me". An empty value is a deliberate blank: it clears that field for
     * this network only, which is the only way to have something everywhere
     * except one place.
     */
    fun resolve(global: Map<String, String>?, override: Map<String, String>?): Map<String, String> {
        val merged = (global ?: emptyMap()).toMutableMap()
        for ((key, value) in override ?: emptyMap()) {
            val trimmed = value.trim()
            if (trimmed.isEmpty()) merged.remove(key) else merged[key] = trimmed
        }
        return merged
    }

    /** Whether this network has been given a profile of its own */
    fun hasOverride(override: Map<String, String>?): Boolean = !override.isNullOrEmpty()

    /**
     * Whether two profiles say the same thing.
     *
     * How a network *seeded* from the global — which is what adding one used to
     * do — is told from one somebody deliberately made different. A seeded copy
     * is not a choice.
     */
    fun same(a: Map<String, String>?, b: Map<String, String>?): Boolean {
        val left = (a ?: emptyMap()).filterValues { it.trim().isNotEmpty() }
            .mapValues { it.value.trim() }
        val right = (b ?: emptyMap()).filterValues { it.trim().isNotEmpty() }
            .mapValues { it.value.trim() }
        return left == right
    }

    /**
     * Which fields this network is still wearing that we no longer say.
     *
     * Clearing a field has to be published, not just stopped being sent: a SET
     * with no value is how `draft/metadata-2` deletes one, and without it
     * deleting your display name left every network still calling you by it
     * until something reconnected.
     *
     * @param keys the fields we manage, so a key the network set on us itself
     *   is left alone rather than deleted by a client that did not put it there
     * @param published what we last put up here, as the connection remembers it
     * @param next what the resolved profile says now
     */
    fun keysToClear(
        keys: List<String>,
        published: Map<String, String>?,
        next: Map<String, String>?
    ): List<String> = keys.filter { key ->
        (published ?: emptyMap())[key]?.trim().orEmpty().isNotEmpty() &&
            (next ?: emptyMap())[key]?.trim().orEmpty().isEmpty()
    }

    /**
     * What to store against a network, given what was typed there.
     *
     * Anything identical to the global is not an override, and storing it as
     * one is how a network stops following your profile without anybody asking.
     * Null means "this network just uses yours".
     */
    fun overrideFrom(
        global: Map<String, String>?,
        typed: Map<String, String>?
    ): Map<String, String>? {
        if (typed == null) return null
        val kept = mutableMapOf<String, String>()
        for ((key, value) in typed) {
            val trimmed = value.trim()
            val theirs = (global ?: emptyMap())[key]?.trim().orEmpty()
            if (trimmed == theirs) continue
            kept[key] = trimmed
        }
        return kept.ifEmpty { null }
    }
}
