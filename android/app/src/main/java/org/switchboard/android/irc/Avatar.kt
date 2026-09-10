package org.switchboard.android.irc

import java.net.URI

/**
 * Whether an avatar is something we are willing to fetch.
 *
 * The Kotlin half of `src/shared/avatar.ts`, checked against
 * `tests/fixtures/avatar.json`. An avatar arrives as a metadata key, which
 * means it is a string a stranger typed, and an image loader will attempt
 * whatever it is given: every `http://` avatar in a four-hundred-person
 * channel is that many strangers learning your address the moment you open the
 * member list.
 *
 * So: https only, and nothing that resolves anywhere but out. `data:` is
 * refused as well — it cannot leak anything, but it is unbounded.
 */
fun avatarUrl(value: String?): String? {
    val trimmed = value?.trim().orEmpty()
    if (trimmed.isEmpty()) return null

    // A URL long enough to be a problem is not an avatar
    if (trimmed.length > 2048) return null

    val uri = runCatching { URI(trimmed) }.getOrNull() ?: return null
    if (!uri.isAbsolute) return null
    if (!"https".equals(uri.scheme, ignoreCase = true)) return null
    // A host is what makes it a fetch rather than a path
    if (uri.host.isNullOrEmpty()) return null

    return trimmed
}
