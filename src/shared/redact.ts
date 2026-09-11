/**
 * Taking the secrets out of a line before anything else sees it.
 *
 * Every line the client sends is emitted on a debug stream, and that stream
 * was handed to every paired device: `PASS`, and `AUTHENTICATE` — which for
 * SASL PLAIN is base64 of `user\0user\0password` and decodes in one step.
 * Meanwhile `sanitizeForRemote` was carefully stripping those same
 * credentials out of the config before it travelled, which is the rule this
 * broke while looking like it kept it.
 *
 * Two things fix that and this is one of them: the stream no longer goes to
 * paired devices at all, and what is left of it no longer carries the secret
 * to the renderer, a log, or a devtools window either.
 *
 * The line is still recognisable afterwards — the command and who it was
 * about survive, because a wire log with the command blanked out is no longer
 * a wire log. Only the secret goes.
 */

const HIDDEN = '***'

/** What a line with no secret in it looks like: itself */
export function redactLine(line: string): string {
  // An outbound line may carry client tags, and a verb is what follows them
  const tagged = line.startsWith('@') ? line.indexOf(' ') + 1 : 0
  if (tagged === 0 && line.startsWith('@')) return line

  const body = line.slice(tagged)
  const head = line.slice(0, tagged)

  const parts = body.split(' ')
  const verb = parts[0]?.toUpperCase()

  switch (verb) {
    // PASS :secret, or PASS secret
    case 'PASS':
      return parts.length < 2 ? line : `${head}${parts[0]} ${HIDDEN}`

    // The payload is the credential itself. `+` and `*` are protocol tokens —
    // an empty response and an abort — and blanking those makes a SASL
    // exchange unreadable while hiding nothing.
    case 'AUTHENTICATE': {
      const payload = parts[1]
      if (payload === undefined || payload === '+' || payload === '*') return line
      return `${head}${parts[0]} ${HIDDEN}`
    }

    // OPER <name> <password> — the name is who, the rest is the secret
    case 'OPER':
      return parts.length < 3 ? line : `${head}${parts[0]} ${parts[1]} ${HIDDEN}`

    // What people type at services, which is a password in a PRIVMSG
    case 'PRIVMSG':
    case 'NS':
    case 'NICKSERV':
      return redactServices(head, parts, line)

    default:
      return line
  }
}

/**
 * `/msg NickServ IDENTIFY hunter2`, and the rest of that family.
 *
 * A password typed at a bot is still a password. The verb and the account it
 * is about are kept; whatever follows them is not.
 */
/**
 * How many words after the verb are safe to keep.
 *
 * Not one rule for all of them: `IDENTIFY kara hunter2` names the account
 * first and `REGISTER hunter2 kara@example.org` names the password first, so
 * keeping "one argument" is right for one and hands over the secret in the
 * other. The count is per verb because the shapes genuinely differ.
 */
const SERVICE_SECRETS: Record<string, number> = {
  IDENTIFY: 1,
  GHOST: 1,
  RELEASE: 1,
  REGAIN: 1,
  SETPASS: 1,
  REGISTER: 0
}

function redactServices(head: string, parts: string[], line: string): string {
  // Where the words start: `PRIVMSG NickServ :IDENTIFY …` or `NS IDENTIFY …`
  const verb = parts[0].toUpperCase()
  const from = verb === 'PRIVMSG' ? 2 : 1
  if (parts.length <= from) return line

  // Only services, not a person who happens to say "identify"
  if (verb === 'PRIVMSG') {
    const target = parts[1].toLowerCase().replace(/^[@+]/, '')
    if (!target.startsWith('nickserv') && !target.startsWith('chanserv')) return line
  }

  const words = parts.slice(from)
  words[0] = words[0].replace(/^:/, '')
  const action = words[0].toUpperCase()
  const keep = SERVICE_SECRETS[action]
  if (keep === undefined) return line
  if (words.length < 2) return line

  // The password is the last word, always: `IDENTIFY hunter2` and
  // `IDENTIFY kara hunter2` are both real, so what comes before it is
  // sometimes an account and sometimes nothing. Keep up to what this verb
  // puts in front of its password, and never so much that nothing is hidden.
  //
  // `GHOST kara` with no password comes out as `GHOST ***`, which hides a
  // nick that was not secret. That is the safe direction of the two.
  const keepCount = Math.max(0, Math.min(keep, words.length - 2))
  const kept = words.slice(0, 1 + keepCount)
  const prefix = parts.slice(0, from).join(' ')
  const colon = parts[from].startsWith(':') ? ':' : ''
  return `${head}${prefix} ${colon}${kept.join(' ')} ${HIDDEN}`
}
