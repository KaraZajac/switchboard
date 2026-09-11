/**
 * A conversation as text.
 *
 * Everything said is in the database and nothing could get it out. No log
 * files, no "save this conversation", no way to hand a channel to somebody who
 * does not run this client — and an encrypted history you cannot export is a
 * history you cannot keep when you stop using the app.
 *
 * One format, produced the same way wherever it is asked for: the desktop
 * writing a file and the phone offering a share sheet are the same lines.
 * Close enough to what every other client logs that existing tools can read
 * it, which is most of the point of having it.
 */

import { stripFormatting } from './formatting'

export interface TranscriptMessage {
  nick: string
  content: string
  /** ISO 8601 */
  timestamp: string
  /** `privmsg`, `notice`, `action`, `system` */
  type: string
}

export interface TranscriptOptions {
  /** Leave mIRC colour and bold codes in, for a faithful copy */
  keepFormatting?: boolean
  /** Local time rather than UTC, which is what a person reading it expects */
  localTime?: boolean
}

/**
 * One line.
 *
 * `[HH:MM:SS] <nick> text` for a message, `* nick text` for an action, and a
 * bare `-!- text` for everything the server said — the shapes irssi and
 * WeeChat use, because a log nothing else can read is a log with one reader.
 */
export function transcriptLine(
  message: TranscriptMessage,
  options: TranscriptOptions = {}
): string {
  const at = new Date(message.timestamp)
  const clock = Number.isNaN(at.getTime()) ? '--:--:--' : timeOf(at, options.localTime === true)

  const text = options.keepFormatting ? message.content : stripFormatting(message.content)

  switch (message.type) {
    case 'action':
      return `[${clock}] * ${message.nick} ${text}`
    case 'notice':
      return `[${clock}] -${message.nick}- ${text}`
    case 'system':
      return `[${clock}] -!- ${text}`
    default:
      return `[${clock}] <${message.nick}> ${text}`
  }
}

/**
 * A whole conversation, with a header saying what it is.
 *
 * The header matters more than it looks: a file called `#general.txt` on
 * somebody's desktop in a year has no way to say which network it came from,
 * and two networks have a `#general`.
 */
export function transcript(
  network: string,
  channel: string,
  messages: readonly TranscriptMessage[],
  options: TranscriptOptions = {}
): string {
  const header = [
    `# ${channel} on ${network}`,
    `# ${messages.length} message${messages.length === 1 ? '' : 's'}`,
    ...(messages.length > 0
      ? [`# ${dayOf(messages[0].timestamp)} to ${dayOf(messages[messages.length - 1].timestamp)}`]
      : []),
    ''
  ]

  // A day marker between days, so a month of scrollback is readable rather
  // than a wall of timestamps that all look alike.
  const lines: string[] = []
  let day = ''
  for (const message of messages) {
    const today = dayOf(message.timestamp)
    if (today !== day) {
      if (day !== '') lines.push('')
      lines.push(`--- ${today} ---`)
      day = today
    }
    lines.push(transcriptLine(message, options))
  }

  return [...header, ...lines, ''].join('\n')
}

/**
 * What to call the file.
 *
 * Network and channel, because the channel alone is ambiguous, and every
 * character a filesystem might object to replaced rather than dropped — two
 * channels differing only in punctuation must not become one file.
 */
export function transcriptFilename(network: string, channel: string): string {
  const safe = (value: string): string =>
    value
      .replace(/[^a-zA-Z0-9#&_.-]+/g, '_')
      // No run of dots survives. Nothing here can escape a directory — the
      // separators are already gone — but a filename is handed to the
      // operating system, and leaving `..` in one to be reasoned about later
      // is how that stops being true.
      .replace(/\.{2,}/g, '.')

  // Trimmed at both ends: a trailing dot meets the extension and makes the
  // `..` this just removed, and everything might have been punctuation.
  const name = `${safe(network)}-${safe(channel)}`.replace(/^[._-]+|[._-]+$/g, '')
  return `${name || 'conversation'}.txt`
}

function timeOf(at: Date, local: boolean): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return local
    ? `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
    : `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}`
}

function dayOf(timestamp: string): string {
  const at = new Date(timestamp)
  if (Number.isNaN(at.getTime())) return 'unknown date'
  return at.toISOString().slice(0, 10)
}
