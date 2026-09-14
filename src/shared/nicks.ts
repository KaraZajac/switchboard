/**
 * Which nick to try when the one you asked for is taken.
 *
 * Every client since mIRC has had a second and third choice; both of ours
 * only ever put an underscore on the end, which on a busy network means
 * spending the evening as `kara__`. The alternatives are the user's, in
 * order, each tried once; the underscore is what is left when they run out.
 * One rule for both clients — the Kotlin half is `Nicks.kt`, checked
 * against `tests/fixtures/altnick.json`.
 */
export function nextNickToTry(
  attempted: string,
  alternatives: readonly string[],
  tried: readonly string[]
): string {
  const used = new Set([...tried, attempted].map((nick) => nick.toLowerCase()))
  for (const raw of alternatives) {
    const candidate = raw.trim()
    if (candidate.length === 0) continue
    if (!used.has(candidate.toLowerCase())) return candidate
  }
  return attempted + '_'
}
