import { host } from './host'
import * as fs from 'fs'
import { join } from 'path'
import { getSetting } from './storage/models/settings'
import { getServer } from './storage/models/server'
import type { ChatMessage } from '@shared/types/message'

/**
 * Plain-text logs on disk.
 *
 * The database keeps everything and the transcript export writes any
 * conversation out — but a file per channel that grows as it happens, in a
 * folder you can grep, is what HexChat, irssi, WeeChat and mIRC have always
 * had, and it is what people who keep logs reach for. Off unless asked for:
 * it is a copy of everything said, on disk, in the clear. Machine-local,
 * because the folder is this computer's.
 *
 * One file per conversation under `logs/<network>/<channel>.log`, one line
 * per message in the shape every other client's logs take, so a tool that
 * reads theirs reads these.
 */

const LOG_TO_DISK = 'logToDisk'

export function logsFolder(): string {
  return join(host().dataDir(), 'logs')
}

export function loggingToDisk(): boolean {
  return getSetting<boolean>(LOG_TO_DISK) === true
}

/** A name safe to use as a file or folder name, whatever the network called it */
function fileSafe(name: string): string {
  return name.replace(/[^\w#&+.@-]/g, '_').toLowerCase() || '_'
}

/** `YYYY-MM-DD HH:MM:SS`, local time, the way logs are read by eye */
function stamp(iso: string): string {
  const when = new Date(iso)
  const d = Number.isNaN(when.getTime()) ? new Date() : when
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

/** The line as irssi would write it */
export function logLineFor(message: Pick<ChatMessage, 'nick' | 'content' | 'type' | 'timestamp'>): string {
  const when = stamp(message.timestamp)
  switch (message.type) {
    case 'action':
      return `${when}  * ${message.nick} ${message.content}`
    case 'notice':
      return `${when} -${message.nick}- ${message.content}`
    case 'system':
      return `${when} -!- ${message.content}`
    default:
      return `${when} <${message.nick}> ${message.content}`
  }
}

/** Write a message that just arrived or went out, if logging is on */
export function logMessage(serverId: string, channel: string, message: ChatMessage): void {
  if (!loggingToDisk()) return
  if (message.type === 'motd' || message.type === 'tagmsg') return
  const server = getServer(serverId)
  const folder = join(logsFolder(), fileSafe(server?.name || serverId))
  const file = join(folder, `${fileSafe(channel)}.log`)
  try {
    fs.mkdirSync(folder, { recursive: true })
    // Synchronous on purpose: a line is a few dozen bytes, and lines that
    // arrive together must land in the order they arrived
    fs.appendFileSync(file, logLineFor(message) + '\n')
  } catch (err) {
    // A folder that cannot be written is not worth stopping the conversation over
    console.error('Could not write the log:', err)
  }
}
