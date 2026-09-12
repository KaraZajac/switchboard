/**
 * What a message's `time` tag is allowed to be.
 *
 * `server-time` says the value is ISO 8601 in UTC with millisecond precision:
 * `2011-10-19T16:40:51.620Z`. Both clients took the tag on trust and stored
 * whatever was in it. On the phone that string later reaches `Instant.parse`,
 * which throws on anything malformed — so a server, or anything a server
 * relays, could put `@time=soon` on a line and crash the transcript export.
 * On the desktop it reaches `new Date`, which does not throw and instead
 * yields an Invalid Date that sorts anywhere and divides days nowhere.
 *
 * So: the tag if it is a real timestamp, and now if it is not. Milliseconds
 * are optional on the way in because some servers omit them; the year is
 * bounded because a message from 9999 is not a message, it is a sort key.
 */

const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/

/** A timestamp we are willing to store, or null */
export function validServerTime(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const m = ISO_UTC.exec(value)
  if (!m) return null

  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = Number(m[6])

  if (year < 1970 || year > 9000) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  // 60 would be a leap second. ISO 8601 allows one; neither `Date.parse` nor
  // `java.time` accepts it, so refusing here keeps the two clients identical.
  if (hour > 23 || minute > 59 || second > 59) return null

  // Real calendar check: 2026-02-30 matches the pattern and is not a day
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  const back = new Date(parsed)
  if (back.getUTCMonth() + 1 !== month || back.getUTCDate() !== day) return null

  return value
}

/** The tag's time where it is one, and the given clock otherwise */
export function serverTimeOf(value: string | null | undefined, now: () => string): string {
  return validServerTime(value) ?? now()
}
