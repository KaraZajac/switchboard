import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { transcriptLine, transcriptFilename } from '@shared/transcript'
import type { ChatMessage } from '@shared/types/message'
import { getSetting } from './models/settings'

/**
 * Writing conversations to disk as they happen.
 *
 * Off unless somebody asks for it, and it should be: everything is already
 * kept in a database this machine encrypts, and a folder of plain text beside
 * it is strictly less protected than what it copies. Worth having anyway —
 * people grep their logs, feed them to other tools, and keep them after they
 * stop using the client that made them — but worth being asked for rather than
 * assumed.
 */

/** Where to write, or empty for nowhere */
const LOG_DIRECTORY = 'logDirectory'

/** Directories we have already made, so every line is not a syscall */
const ready = new Set<string>()

/** A queue per file, because appends to one file must not interleave */
const writing = new Map<string, Promise<void>>()

/**
 * Append one message to its network's log.
 *
 * Failures are swallowed after being said once: a full disk or a folder that
 * was deleted is not a reason to lose the message, which is safely in the
 * database either way.
 */
export function logMessage(network: string, message: ChatMessage): void {
  const directory = (getSetting<string>(LOG_DIRECTORY) || '').trim()
  if (!directory) return

  const file = join(directory, transcriptFilename(network, message.channel))
  const line =
    transcriptLine({
      nick: message.nick,
      content: message.content,
      timestamp: message.timestamp,
      type: message.type
    }) + '\n'

  // Serialised per file. Two appends racing produce interleaved bytes rather
  // than two lines, and a log with half a message in the middle of another is
  // worse than a missing one.
  const previous = writing.get(file) ?? Promise.resolve()
  const next = previous
    .then(async () => {
      if (!ready.has(directory)) {
        await mkdir(directory, { recursive: true })
        ready.add(directory)
      }
      await appendFile(file, line, 'utf8')
    })
    .catch((err) => complain(directory, err))

  writing.set(file, next)
}

let lastComplaint = ''
function complain(directory: string, err: unknown): void {
  const message = `Could not write the log in ${directory}: ${String(err)}`
  if (message === lastComplaint) return
  lastComplaint = message
  console.warn(message)
  // A folder that went away may come back, and the next line should try again
  ready.clear()
}
