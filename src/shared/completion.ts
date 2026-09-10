/**
 * Finishing a half-typed name.
 *
 * The two clients complete differently on purpose — the desktop cycles with
 * Tab, the phone offers a row to tap, and a touchscreen has no Tab key. What
 * they should not differ on is the answer: which names match what has been
 * typed, and what goes after the one that is chosen.
 *
 * They did. The phone put a colon after anything completed at the start of a
 * line, including a channel, so tapping `#switchboard` gave `#switchboard: `
 * — which reads as addressing a person who is not there. The desktop had it
 * right and nothing said so, because the desktop's is buried in a component
 * with a cursor and a ref and was never tested at all.
 */

/**
 * Who or what matches what has been typed so far.
 *
 * Case-insensitively, because nobody types capitals into a nick on purpose,
 * and sorted, so the same prefix offers the same order every time — a list
 * that reshuffles between keystrokes cannot be aimed at.
 *
 * Two characters before offering anything: one letter matches most of a busy
 * channel, and a row of forty names is not a suggestion.
 */
export function completionsFor(
  partial: string,
  candidates: readonly string[],
  limit = 6
): string[] {
  if (partial.length < 2) return []

  const wanted = partial.toLowerCase()
  return candidates
    .filter((name) => {
      const lower = name.toLowerCase()
      return lower.startsWith(wanted) && lower !== wanted
    })
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .slice(0, limit)
}

/**
 * What goes after a completed word.
 *
 * `robin: ` at the start of a line and `robin ` anywhere else — the convention
 * every IRC client follows, and what makes a highlight land on the person
 * rather than reading as a passing mention.
 *
 * A command or a channel never takes the colon. `/join: ` is not a command and
 * `#switchboard: ` is not addressing anybody.
 */
export function completionSuffix(atStartOfLine: boolean, completion: string): string {
  if (!atStartOfLine) return ' '
  if (completion.startsWith('/') || completion.startsWith('#')) return ' '
  return ': '
}

/** The draft with the half-typed word replaced by the whole one */
export function completedDraft(draft: string, completion: string): string {
  const lastSpace = draft.lastIndexOf(' ')
  const head = draft.slice(0, lastSpace + 1)
  return head + completion + completionSuffix(head.length === 0, completion)
}
