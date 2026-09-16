/**
 * Every slash command, with what it takes and what it does.
 *
 * The client answered sixty-odd commands and offered seventeen of them in the
 * composer's completion list, which is a strange way to keep a secret: `/ban`,
 * `/kickban`, `/cycle`, `/knock`, `/founder` and the rest worked perfectly and
 * were findable only by already knowing they were there. The list was written
 * out by hand next to the switch that handles them, so it fell behind the
 * moment anybody added one.
 *
 * So this is the catalogue, and `tests/main/commandlist.test.ts` holds it to
 * the switch: a command the client handles and this does not list, or the
 * other way round, fails. That is the whole point — the completion list and
 * `/help` read from here, so adding a command adds it to both.
 */

export interface CommandHelp {
  /** What you type after the slash */
  name: string
  /** Other spellings of the same command */
  aliases?: string[]
  /** What comes after the name, in the usual angle-and-square notation */
  usage?: string
  /** One line, in the imperative */
  summary: string
  /** Only meaningful with a channel open */
  channel?: boolean
}

import catalogue from './commands.json'

/**
 * The commands themselves live in `commands.json` beside this file.
 *
 * Data rather than code because two clients need it: `scripts/commands.py`
 * carries the same file over to Kotlin, the way `scripts/themes.py` carries
 * the palettes, so the phone answers `/help` with the list the desktop
 * answers with rather than a second list that drifts.
 */
export const COMMANDS: CommandHelp[] = catalogue.commands as CommandHelp[]

/** Every name and alias, sorted — what a completion list offers */
export function commandNames(): string[] {
  const names: string[] = []
  for (const command of COMMANDS) {
    names.push(command.name)
    for (const alias of command.aliases ?? []) names.push(alias)
  }
  return names.sort()
}

/** The entry for a name or one of its aliases */
export function findCommand(name: string): CommandHelp | null {
  const wanted = name.trim().replace(/^\//, '').toLowerCase()
  for (const command of COMMANDS) {
    if (command.name === wanted) return command
    if ((command.aliases ?? []).includes(wanted)) return command
  }
  return null
}

/** One command as a line: `/kick <nick> [reason] — put somebody out` */
export function commandLine(command: CommandHelp): string {
  const names = [command.name, ...(command.aliases ?? [])].map((n) => `/${n}`).join(', ')
  const usage = command.usage ? ` ${command.usage}` : ''
  return `${names}${usage} — ${command.summary}`
}

/**
 * What `/help` prints.
 *
 * With a name, that one command. Without, all of them — which is long, and is
 * the point: the answer to "what can I type here" should be readable in one
 * place rather than guessed at.
 */
export function helpLines(query?: string): string[] {
  const wanted = (query ?? '').trim()
  if (wanted.length > 0) {
    const found = findCommand(wanted)
    return found
      ? [commandLine(found)]
      : [`No command called /${wanted.replace(/^\//, '')}. Type /help for the list.`]
  }
  return COMMANDS.map(commandLine)
}
