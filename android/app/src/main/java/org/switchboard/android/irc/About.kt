package org.switchboard.android.irc

/**
 * What the About screen says, in the words both clients use.
 *
 * The Kotlin half of `src/shared/about.ts`. Only the date needs a rule, and it
 * needs one badly: `DateTimeFormatter` here and `toLocaleDateString` there
 * would put the same build under two different dates on the same person's two
 * devices, in an app whose whole point is that they are one client.
 */
object About {

    private val MONTHS = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    )

    private val ISO = Regex("""^(\d{4})-(\d{2})-(\d{2})([T ].*)?$""")

    /**
     * `2026-09-17T19:20:44.123Z` → `17 September 2026`.
     *
     * Empty for anything that is not a date: the About screen would rather
     * leave the line out than print nonsense, and an unbuilt or hand-edited
     * build is exactly when this gets read.
     */
    fun buildDate(iso: String): String {
        val match = ISO.find(iso.trim()) ?: return ""

        val year = match.groupValues[1].toInt()
        val month = match.groupValues[2].toInt()
        val day = match.groupValues[3].toInt()
        if (month !in 1..12) return ""
        if (day !in 1..31) return ""

        return "$day ${MONTHS[month - 1]} $year"
    }
}
