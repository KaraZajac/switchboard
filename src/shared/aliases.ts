/**
 * Commands you make up yourself.
 *
 * Every client has had these for decades — `/j` for join, `/wii` for a whois
 * on the server that knows, a one-word shortcut for the four lines you type
 * every time you sit down. Without them the only commands are the ones
 * somebody else decided you needed.
 *
 * Deliberately not a scripting language. An alias is text substitution with
 * numbered parameters, which covers what people actually write and cannot loop,
 * cannot read a file and cannot be a security question. A client that grows an
 * interpreter has grown a way for a pasted line to do something.
 */

export interface Alias {
  /** The word after the slash, without it, lowercase */
  name: string
  /**
   * What to run instead. May contain several commands separated by newlines,
   * and `$1`…`$9`, `$*` for everything, `$N-` for the Nth onwards.
   */
  expansion: string
}

/** How deep one alias may go into another before we call it a loop */
const MAX_DEPTH = 10

/**
 * Fill in the parameters of one expansion.
 *
 * `$1` is the first word after the alias, `$*` is all of them, `$2-` is the
 * second onwards. A parameter nobody supplied becomes nothing rather than the
 * literal `$3`, which would otherwise be sent to the server as text.
 *
 * `$$` is a literal dollar, because an alias that inserts a price is a
 * reasonable thing to want.
 */
export function fillParameters(expansion: string, args: readonly string[]): string {
  return expansion.replace(/\$(\$|\*|\d+-?)/g, (whole, token: string) => {
    if (token === '$') return '$'
    if (token === '*') return args.join(' ')

    if (token.endsWith('-')) {
      const from = Number(token.slice(0, -1))
      if (!Number.isFinite(from) || from < 1) return ''
      return args.slice(from - 1).join(' ')
    }

    const at = Number(token)
    if (!Number.isFinite(at) || at < 1) return whole
    return args[at - 1] ?? ''
  })
}

/**
 * What a typed line becomes once aliases are applied.
 *
 * Returns the lines to run, in order. Text that is not a command comes back
 * unchanged as a single line, and so does a command that is not an alias —
 * expansion happens here and dispatch happens elsewhere.
 *
 * An alias may call another, which is how `/j` can be built on `/join`. It may
 * not call itself, directly or in a ring: that is a hang, and a client that
 * hangs on something the user typed is worse than one that refuses it.
 */
export function expandAliases(
  text: string,
  aliases: readonly Alias[],
  depth = 0
): { lines: string[]; error?: string } {
  if (!text.startsWith('/') || text.startsWith('//')) return { lines: [text] }
  if (depth > MAX_DEPTH) {
    return { lines: [], error: 'That alias expands into itself' }
  }

  const space = text.indexOf(' ')
  const name = (space === -1 ? text.slice(1) : text.slice(1, space)).toLowerCase()
  const rest = space === -1 ? '' : text.slice(space + 1).trim()

  const alias = aliases.find((one) => one.name.toLowerCase() === name)
  if (!alias) return { lines: [text] }

  const args = rest.length > 0 ? rest.split(/\s+/) : []
  const filled = fillParameters(alias.expansion, args)

  // One alias may produce several lines, and each of those may be an alias.
  const lines: string[] = []
  for (const line of filled.split('\n')) {
    const one = line.trim()
    if (one.length === 0) continue

    // A line that is not a command is a message, which is the other useful
    // thing an alias does: `/shrug` should send a shrug, not run one.
    const next = expandAliases(one, aliases, depth + 1)
    if (next.error) return next
    lines.push(...next.lines)
  }

  return { lines }
}

/** Whether a name can be an alias at all */
export function validAliasName(name: string): boolean {
  return /^[a-z0-9_-]+$/i.test(name.trim())
}

/**
 * The lines to send when a connection is ready.
 *
 * One per line, a leading slash meaning a command and anything else being raw
 * IRC — which is what every other client's "perform" does. Blank lines and
 * comments are dropped so the box can be annotated.
 */
export function performLines(script: string | null | undefined): string[] {
  return (script ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}
