/**
 * What you may do to somebody in a channel.
 *
 * There is no IRCv3 specification for this. It is worth saying plainly,
 * because it shapes everything below: no extension tells a client "you may
 * kick here". What the network does tell us, in ISUPPORT, is:
 *
 *   PREFIX=(qaohv)~&@%+   the roles this network has, most privileged first
 *   CHANMODES=beIq,k,l,…  which modes take a mask, a parameter, or nothing
 *
 * From those two, and from what you and the other person are wearing in this
 * channel, a client can work out what is *plausible*. It cannot be certain:
 * rIRCd requires op to kick, while InspIRCd and UnrealIRCd let a halfop do
 * it. So this errs toward offering an action a network might refuse, and
 * never toward hiding one it would have allowed — with one exception, which
 * is the case that prompted all this: with no rank at all you get none of
 * them, because that is the one situation where we can be sure.
 *
 * The alternative — showing Kick to everybody and letting the server say no —
 * is what both clients did. It teaches people that half the menu is a lie.
 */

/** Everything a member menu can offer */
export type MemberAction =
  | 'whois'
  | 'message'
  | 'ignore'
  | 'unignore'
  | 'voice'
  | 'devoice'
  | 'halfop'
  | 'dehalfop'
  | 'op'
  | 'deop'
  | 'admin'
  | 'deadmin'
  | 'founder'
  | 'defounder'
  | 'kick'
  | 'ban'
  | 'mute'
  | 'unmute'

/** The rungs a menu has words for, weakest first */
export type Rung = 'voice' | 'halfop' | 'op' | 'admin' | 'founder'

/**
 * The mode letter this network uses for a rung, or null where it has none.
 *
 * Asked by name rather than by position because position is not portable: the
 * top rung is `q` on the servers that have one and `x` on rIRCd, which keeps
 * `q` for its quiet list. A client that assumed `q` sent `MODE #chan +q nick`
 * to promote somebody and silenced them instead.
 *
 * Only the letters a person has a word for. A network whose top prefix is some
 * other letter has no founder as far as this is concerned, and nothing will be
 * offered for it — which is the honest answer: granting a mode nobody can name
 * is worse than not offering to.
 */
export function modeForRole(prefix: string | undefined | null, rung: Rung): string | null {
  const { modes } = parsePrefix(prefix)
  const candidates: Record<Rung, string[]> = {
    founder: ['q', 'x'],
    admin: ['a'],
    op: ['o'],
    halfop: ['h'],
    voice: ['v']
  }
  for (const letter of candidates[rung]) {
    if (modes.includes(letter)) return letter
  }
  return null
}

export interface PrefixScheme {
  /** Mode letters, most privileged first: `qaohv` */
  modes: string
  /** The symbols that go with them: `~&@%+` */
  symbols: string
}

/**
 * `PREFIX=(qaohv)~&@%+` into its two halves.
 *
 * A network that sends something unparseable gets the classic pair, which is
 * what every ircd has had since before ISUPPORT existed.
 */
export function parsePrefix(value: string | undefined | null): PrefixScheme {
  const match = /^\(([^)]*)\)(.*)$/.exec((value || '').trim())
  if (!match || match[1].length === 0 || match[1].length !== match[2].length) {
    return { modes: 'ov', symbols: '@+' }
  }
  return { modes: match[1], symbols: match[2] }
}

/**
 * How high somebody stands, as an index into the prefix scheme.
 *
 * 0 is the most privileged. Somebody wearing nothing is one past the end,
 * which makes "outranks" a plain comparison.
 */
export function rankOf(symbols: string, scheme: PrefixScheme): number {
  let best = scheme.symbols.length
  for (const symbol of symbols) {
    const at = scheme.symbols.indexOf(symbol)
    if (at !== -1 && at < best) best = at
  }
  return best
}

/**
 * Whether you could change a channel's settings and lists.
 *
 * Half-operator upwards where the network has one, operator upwards where it
 * does not — the same line `actionsFor` draws before offering a kick, and here
 * so that a panel does not draw it again by hand.
 *
 * It was drawn by hand twice, and both times backwards: `rankOf` returns 0 for
 * the *most* privileged, so a `>= 2` test meant "voiced or nothing". On the
 * desktop that was hidden by a second bug — the roster lookup failed, `rankOf`
 * of an empty string returned one-past-the-end, and the backwards test turned
 * that into a yes. The panel appeared to work and would have offered Lift and
 * Add to somebody with no rank at all.
 */
export function canModerate(
  prefix: string | undefined | null,
  mine: string
): boolean {
  const scheme = parsePrefix(prefix)
  const opRank = rankOfMode('o', scheme)
  if (opRank === null) return false

  const halfopRank = rankOfMode('h', scheme)
  return rankOf(mine, scheme) <= (halfopRank ?? opRank)
}

/**
 * What to call the people standing on one rung.
 *
 * By mode letter rather than by symbol, because the letters are the portable
 * half: every network that has an admin calls the mode `a` and they disagree
 * about whether it shows as `&` or `!`. `q` and `x` are both the top — `q` on
 * the servers that have it, `x` on rIRCd, which keeps `q` for its quiet list
 * and says so in ISUPPORT rather than expecting anyone to guess.
 *
 * A letter with no name is named after itself. `Mode +z` says something true
 * about a group nobody has a word for, where "Members" would say something
 * false — which is what both clients did with rIRCd's `^`: a founder fell to
 * the bottom of the list and into the heading meant for people wearing
 * nothing, and on the desktop that produced two headings both reading
 * "Members".
 */
export function roleName(mode: string): string {
  switch (mode) {
    case 'q':
    case 'x':
      return 'Founders'
    case 'a':
      return 'Admins'
    case 'o':
      return 'Operators'
    case 'h':
      return 'Half-ops'
    case 'v':
      return 'Voiced'
    default:
      return `Mode +${mode}`
  }
}

export interface Role {
  /** Higher is more privileged; 0 is somebody wearing nothing */
  rank: number
  /** What a group of them is called */
  label: string
}

/** Somebody with no prefix at all, which is most people */
export const NO_ROLE: Role = { rank: 0, label: 'Members' }

/**
 * The group a member belongs in, and how high it sits.
 *
 * Only the strongest prefix counts: somebody who is both an operator and
 * voiced is an operator, and belongs in one group rather than two. Ranked the
 * other way up from [rankOf] on purpose — a list is drawn from the top down,
 * and "higher number is higher up" is the arithmetic a caller wants.
 */
export function roleOf(prefixes: readonly string[], prefixValue?: string | null): Role {
  const scheme = parsePrefix(prefixValue)
  const at = rankOf(prefixes.join(''), scheme)
  if (at >= scheme.symbols.length) return NO_ROLE

  return { rank: scheme.symbols.length - at, label: roleName(scheme.modes[at]) }
}

/** The rank a given mode letter confers, or null where the network has no such role */
function rankOfMode(mode: string, scheme: PrefixScheme): number | null {
  const at = scheme.modes.indexOf(mode)
  return at === -1 ? null : at
}

/**
 * Whether this network has a separate "quiet" mode, and which letter it is.
 *
 * `q` is the trap. On Unreal and InspIRCd it is a *prefix* — channel owner —
 * and on Solanum and rIRCd it is a list mode meaning quiet. The same letter,
 * opposite meanings, and offering "mute" on a network where it makes somebody
 * the owner would be a memorable bug.
 *
 * So: a letter is a quiet mode when it takes a mask (CHANMODES type A) and is
 * *not* one of the prefixes.
 */
export function quietMode(
  chanmodes: string | undefined | null,
  scheme: PrefixScheme
): string | null {
  const typeA = (chanmodes || '').split(',')[0] || ''
  for (const candidate of ['q', 'b']) {
    if (candidate === 'b') continue // `b` is ban, which is its own action
    if (typeA.includes(candidate) && !scheme.modes.includes(candidate)) return candidate
  }
  return null
}

/** Whether the network keeps a ban list at all */
function hasBans(chanmodes: string | undefined | null): boolean {
  return ((chanmodes || '').split(',')[0] || '').includes('b')
}

export interface PowerQuestion {
  /** ISUPPORT PREFIX */
  prefix?: string | null
  /** ISUPPORT CHANMODES */
  chanmodes?: string | null
  /** The prefix symbols you are wearing in this channel */
  mine: string
  /** The prefix symbols they are wearing */
  theirs: string
  /** Whether the person is you */
  isSelf: boolean
  /** Whether you already have them muted client-side */
  ignored?: boolean
}

/**
 * The menu for one person, in order.
 *
 * Talking to somebody is always on offer, and so is ignoring them — that is a
 * decision about your own client that no network has a say in. Everything
 * after is about rank.
 */
export function actionsFor(question: PowerQuestion): MemberAction[] {
  const scheme = parsePrefix(question.prefix)
  const mine = rankOf(question.mine, scheme)
  const theirs = rankOf(question.theirs, scheme)

  const actions: MemberAction[] = ['whois']
  if (!question.isSelf) actions.push('message')

  // Ignoring somebody is a decision about your own client rather than about
  // the channel, so no rank is needed and no network can refuse it. Never
  // against yourself, which would silence your own messages.
  if (!question.isSelf) actions.push(question.ignored ? 'unignore' : 'ignore')

  const rungRank = (rung: Rung): number | null => {
    const letter = modeForRole(question.prefix, rung)
    return letter === null ? null : rankOfMode(letter, scheme)
  }
  const opRank = rungRank('op')
  const halfopRank = rungRank('halfop')
  const voiceRank = rungRank('voice')
  const adminRank = rungRank('admin')
  const founderRank = rungRank('founder')

  // No rank, nothing to offer. The one case we can be certain about, and the
  // one that had people pressing Kick and reading an error.
  if (opRank === null || mine > (halfopRank ?? opRank)) return actions

  const amOp = mine <= opRank
  const amHalfop = halfopRank !== null && mine <= halfopRank

  // Never against somebody standing above you. Every ircd refuses this, and
  // it is the one permission rule they agree on.
  const outranked = theirs < mine
  if (outranked && !question.isSelf) return actions

  // On yourself the only sensible half is standing down. Offering to give
  // yourself halfop while you are already op is noise, and giving yourself
  // anything at all is something the server would refuse anyway.
  const wearing = (rank: number): boolean => question.theirs.includes(scheme.symbols[rank])
  const offer = (rank: number | null, give: MemberAction, take: MemberAction): void => {
    if (rank === null) return
    if (wearing(rank)) actions.push(take)
    else if (!question.isSelf) actions.push(give)
  }

  // Giving and taking voice is what a halfop is *for*, where one exists.
  if (amOp || amHalfop) offer(voiceRank, 'voice', 'devoice')
  if (amOp) offer(halfopRank, 'halfop', 'dehalfop')
  if (amOp) offer(opRank, 'op', 'deop')

  /*
   * And the rungs above operator, where the network has them.
   *
   * These were missing entirely, which on a network with founders meant the
   * one person who could hand the channel on had no way to do it — the menu
   * stopped at Make operator. rIRCd has both, Unreal and InspIRCd have both,
   * and `/owner` sent `+q` on all of them, which on rIRCd is the quiet list.
   *
   * You need the rung to grant it: only a founder makes a founder. That is
   * what every ircd that has these does, and unlike kicking they agree about
   * it — so this is the one place it is safe to be strict.
   */
  if (adminRank !== null && mine <= adminRank) offer(adminRank, 'admin', 'deadmin')
  if (founderRank !== null && mine <= founderRank) offer(founderRank, 'founder', 'defounder')

  // Kicking is where the networks disagree: rIRCd wants op, InspIRCd and
  // UnrealIRCd let a halfop do it. Offered to halfops, because a network that
  // has the role usually means it to moderate — and a refusal costs a line,
  // where hiding it costs the feature.
  if (amOp || amHalfop) {
    if (!question.isSelf) actions.push('kick')

    const quiet = quietMode(question.chanmodes, scheme)
    if (quiet && !question.isSelf) actions.push('mute')
  }

  if (amOp && !question.isSelf && hasBans(question.chanmodes)) actions.push('ban')

  return actions
}

/**
 * The mask to ban or quiet somebody with.
 *
 * `*!*@host` where the host is known, because a ban on the nick is undone by
 * changing it — which takes one command and no privileges at all. Falling back
 * to `nick!*@*` when the host is not known is worth doing rather than
 * refusing, but it is the weaker thing and the menu should say so.
 */
export function banMask(user: {
  nick: string
  user?: string | null
  host?: string | null
}): string {
  const host = (user.host || '').trim()
  if (host.length > 0) return `*!*@${host}`
  return `${user.nick}!*@*`
}

/** Whether that mask is the weak kind, for a menu that would rather be honest */
export function maskIsWeak(user: { host?: string | null }): boolean {
  return (user.host || '').trim().length === 0
}
