/**
 * The lines you have already sent, and getting one back.
 *
 * Up and Down in the composer. Every IRC client has had this since the first
 * one, it is the most-used key after Enter, and this had none — Up moved the
 * caret. Both clients behave the same way, which is why the rule lives here
 * rather than twice.
 *
 * Kept in memory and never written down. People type `/msg NickServ IDENTIFY`
 * into a composer, and a history file is a credential on disk; a history that
 * ends when the app does is the same trade every shell makes with `HISTFILE`
 * unset, and the one a chat client should default to.
 *
 * Per conversation, because recalling what you said in one channel while
 * typing in another is a way to say it in the wrong room.
 */

export interface History {
  /** What has been sent, newest first */
  lines: string[]
  /** Where we are: -1 is the half-typed line, 0 is the newest sent one */
  at: number
  /** What was in the box before Up was pressed */
  draft: string
}

/**
 * How many lines to keep.
 *
 * Enough to find the thing you sent a few minutes ago and not so many that
 * the list is a transcript.
 */
export const HISTORY_LIMIT = 100

export function emptyHistory(): History {
  return { lines: [], at: -1, draft: '' }
}

/**
 * Note a line that was sent.
 *
 * Blank lines are not history. Nor is the same line twice in a row — sending
 * `yes` three times should not need three presses of Up to get past, which is
 * the rule every shell uses and the one people already expect.
 *
 * Sending also ends whatever browsing was in progress: the box is empty again,
 * so there is no draft to come back to.
 */
export function remember(history: History, line: string): History {
  if (line.trim().length === 0) return { ...history, at: -1, draft: '' }
  if (history.lines[0] === line) return { ...history, at: -1, draft: '' }

  return {
    lines: [line, ...history.lines].slice(0, HISTORY_LIMIT),
    at: -1,
    draft: ''
  }
}

/**
 * Up: one line further back.
 *
 * [current] is what is in the box, kept so that coming back down returns the
 * half-written line rather than an empty box — which is the difference between
 * a history that helps and one people learn not to touch.
 */
export function older(history: History, current: string): History {
  // Nothing to recall: keep what is in the box as the draft so that reading
  // the text back gives the same line, and leave the position alone so the key
  // falls through and moves the caret the way it otherwise would.
  if (history.lines.length === 0) return { ...history, draft: current }

  if (history.at === -1) {
    return { ...history, at: 0, draft: current }
  }

  // At the oldest it stays there. Wrapping round to the newest looks like the
  // same key doing two different things.
  return { ...history, at: Math.min(history.at + 1, history.lines.length - 1) }
}

/** Down: one line forward, and past the newest is the line you were writing */
export function newer(history: History): History {
  if (history.at === -1) return history
  return { ...history, at: history.at - 1 }
}

/** What the box should show */
export function textOf(history: History): string {
  if (history.at === -1) return history.draft
  return history.lines[history.at] ?? history.draft
}

/** Whether Up or Down would do anything at all, so the key can fall through */
export function browsing(history: History): boolean {
  return history.at !== -1
}
