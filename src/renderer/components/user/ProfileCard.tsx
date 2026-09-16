import { useState, useEffect } from 'react'
import { MessageSquare, UserPlus, UserMinus, Loader2 } from 'lucide-react'
import { actionsFor, banMask, maskIsWeak, modeForRole, roleOf, quietMode, parsePrefix, type MemberAction } from '@shared/powers'
import { safeExternalUrl } from '@shared/links'
import { ICON } from '../common/IconButton'
import { nickStyle } from '../../utils/nickColor'
import { displayNameFor, metadataColor } from '@shared/types/metadata'
import { useUIStore } from '../../stores/uiStore'
import { useUserStore, type MonitoredNick } from '../../stores/userStore'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'

/**
 * Everything the client knows about one person, in a card.
 *
 * Clicking a name used to do one of three things depending on where you
 * clicked it: open a modal from the member list, show a hover card over a
 * message, or nothing at all. This is the one card, and it is what both the
 * member list and a name in a message now open.
 *
 * Three sources meet here and each knows something the others do not:
 *
 *  - `draft/metadata-2` — the display name, pronouns, status, homepage and
 *    colour a person set for themselves.
 *  - `WHOIS` — what the network says: their account, their server, how long
 *    they have been idle, whether they are an operator or a bot.
 *  - the channel roster — what they are wearing *here*, which is the only one
 *    of the three that changes from room to room, and the one a moderator
 *    actually needs.
 *
 * That last one is why the moderation actions live on the card rather than
 * only in the member list's right-click menu. On a network with founders the
 * menu stopped at Make operator, so the person who could hand the channel on
 * had nowhere to do it from — see `@shared/powers`.
 */
export function ProfileCard({
  nick,
  serverId,
  onClose
}: {
  nick: string
  serverId: string
  onClose: () => void
}) {
  const whois = useUIStore((s) =>
    s.popupWhoisData?.nick.toLowerCase() === nick.toLowerCase() ? s.popupWhoisData : null
  )
  const metadata = useServerStore((s) => s.userMetadata)[`${serverId}:${nick.toLowerCase()}`] ?? {}
  const shownName = displayNameFor(nick, metadata)
  const nameColor = metadataColor(metadata.color)

  if (!whois) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <Loader2 size={ICON.sm} strokeWidth={2} className="animate-spin" aria-hidden="true" />
        Loading…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <CardAvatar nick={whois.nick} avatarUrl={metadata.avatar ?? null} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="font-semibold text-gray-100"
              style={nameColor ? { color: nameColor } : undefined}
            >
              {shownName}
            </span>
            {metadata.pronouns && <span className="text-xs text-gray-400">{metadata.pronouns}</span>}
            {whois.isOperator && (
              <span className="rounded bg-red-500/20 px-1 py-0.5 text-[10px] font-semibold text-gray-100">
                OPER
              </span>
            )}
            {whois.isBot && (
              <span className="rounded bg-indigo-500/20 px-1 py-0.5 text-[10px] font-semibold text-gray-100">
                BOT
              </span>
            )}
          </div>
          {whois.user && whois.host && (
            <div className="truncate text-xs text-gray-500">
              {whois.user}@{whois.host}
            </div>
          )}
        </div>
      </div>

      {shownName !== whois.nick && (
        <div className="text-xs text-gray-500">also known as {whois.nick}</div>
      )}

      {metadata.status && <div className="text-sm italic text-gray-300">{metadata.status}</div>}
      {whois.realname && <div className="text-sm text-gray-300">{whois.realname}</div>}

      {/*
        A homepage comes from metadata, so a stranger chose the string. Shown
        as text either way; only a link we would actually open gets to be one.
      */}
      {metadata.homepage &&
        (safeExternalUrl(metadata.homepage) ? (
          <a
            href={safeExternalUrl(metadata.homepage)!}
            target="_blank"
            rel="noreferrer noopener"
            className="block truncate text-xs text-indigo-400 hover:underline"
          >
            {metadata.homepage}
          </a>
        ) : (
          <div className="block truncate text-xs text-gray-400">{metadata.homepage}</div>
        ))}

      <ChannelRole nick={whois.nick} serverId={serverId} />

      <div className="space-y-1 border-t border-gray-700 pt-2 text-xs">
        {whois.account && (
          <div className="flex justify-between">
            <span className="text-gray-500">Account</span>
            <span className="text-gray-300">{whois.account}</span>
          </div>
        )}
        {whois.server && (
          <div className="flex justify-between">
            <span className="text-gray-500">Server</span>
            <span className="ml-2 truncate text-gray-300">{whois.server}</span>
          </div>
        )}
        {whois.idle && (
          <div className="flex justify-between">
            <span className="text-gray-500">Idle</span>
            <span className="text-gray-300">{idleFor(parseInt(whois.idle))}</span>
          </div>
        )}
        {whois.channels && (
          <div>
            <span className="text-gray-500">Channels</span>
            <div className="mt-0.5 break-words text-gray-300">{whois.channels}</div>
          </div>
        )}
      </div>

      <CardActions nick={whois.nick} serverId={serverId} onClose={onClose} />
      <ModeratorActions nick={whois.nick} serverId={serverId} onClose={onClose} />
    </div>
  )
}

/**
 * What they are in this channel, named the way this network names it.
 *
 * The one fact on the card that changes from room to room: somebody is a
 * founder in one channel and nobody in particular in the next. Nothing at all
 * where they hold no rank, which is most people — a row reading "Members"
 * carries no information.
 */
function ChannelRole({ nick, serverId }: { nick: string; serverId: string }) {
  const channel = useChannelStore((s) => s.activeChannel[serverId])
  const users = useUserStore((s) => s.users)[`${serverId}:${(channel ?? '').toLowerCase()}`] ?? []
  const prefix = useServerStore((s) => s.isupport[serverId]?.['PREFIX'])

  const them = users.find((u) => u.nick.toLowerCase() === nick.toLowerCase())
  if (!them) return null

  const role = roleOf(them.prefixes ?? [], prefix)
  if (role.rank === 0) return null

  return (
    <div className="border-t border-gray-700 pt-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        Role in {channel}
      </div>
      <span className="mt-1 inline-block rounded bg-indigo-500/20 px-1.5 py-0.5 text-[11px] font-medium text-gray-100">
        {role.label}
      </span>
    </div>
  )
}

/** Message and Add Friend, which need no rank and which no network can refuse */
function CardActions({
  nick,
  serverId,
  onClose
}: {
  nick: string
  serverId: string
  onClose: () => void
}) {
  const currentNick = useServerStore((s) => s.currentNick[serverId] ?? '')
  const EMPTY: MonitoredNick[] = []
  const monitored = useUserStore((s) => s.monitoredNicks[serverId] ?? EMPTY)
  const isFriend = monitored.some((m) => m.nick.toLowerCase() === nick.toLowerCase())

  if (currentNick.toLowerCase() === nick.toLowerCase()) return null

  const message = (): void => {
    useChannelStore.getState().addChannel(serverId, nick)
    useChannelStore.getState().setActiveChannel(serverId, nick)
    useServerStore.getState().setActiveServer(serverId)
    useUIStore.getState().setDmMode(false)
    onClose()
  }

  const toggleFriend = (): void => {
    if (isFriend) {
      useUserStore.getState().removeMonitorNick(serverId, nick)
      window.switchboard.invoke('monitor:remove', serverId, [nick])
    } else {
      useUserStore.getState().addMonitorNick(serverId, nick)
      window.switchboard.invoke('monitor:add', serverId, [nick])
    }
  }

  return (
    <div className="flex gap-2 border-t border-gray-700 pt-2">
      <button
        onClick={message}
        className="flex flex-1 items-center justify-center gap-1.5 rounded bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-400"
      >
        <MessageSquare size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        Message
      </button>
      <button
        onClick={toggleFriend}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${
          isFriend
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        }`}
      >
        {isFriend ? (
          <UserMinus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        ) : (
          <UserPlus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        )}
        {isFriend ? 'Unfriend' : 'Add Friend'}
      </button>
    </div>
  )
}

/**
 * What you may do to them here, if anything.
 *
 * The same list the member list's right-click menu offers, from the same rule
 * — `actionsFor` reads the network's own ladder out of ISUPPORT and what the
 * two of you are wearing. Nothing at all for somebody with no rank, which is
 * the one case that can be answered for certain.
 *
 * Kicking, banning and handing over the channel ask twice. The other way round
 * — a confirm on giving somebody voice — is noise, because pressing it again
 * undoes it.
 */
function ModeratorActions({
  nick,
  serverId,
  onClose
}: {
  nick: string
  serverId: string
  onClose: () => void
}) {
  const channel = useChannelStore((s) => s.activeChannel[serverId])
  const users = useUserStore((s) => s.users)[`${serverId}:${(channel ?? '').toLowerCase()}`] ?? []
  const tokens = useServerStore((s) => s.isupport[serverId]) ?? {}
  const myNick = useServerStore((s) => s.currentNick[serverId] ?? '')
  const [confirming, setConfirming] = useState<MemberAction | null>(null)

  useEffect(() => setConfirming(null), [nick, channel])

  if (!channel || !channel.startsWith('#')) return null

  const them = users.find((u) => u.nick.toLowerCase() === nick.toLowerCase())
  const me = users.find((u) => u.nick.toLowerCase() === myNick.toLowerCase())
  const isSelf = nick.toLowerCase() === myNick.toLowerCase()

  const offered = actionsFor({
    prefix: tokens.PREFIX,
    chanmodes: tokens.CHANMODES,
    mine: (me?.prefixes ?? []).join(''),
    theirs: (them?.prefixes ?? []).join(''),
    isSelf
  }).filter(
    (action) =>
      action !== 'whois' &&
      action !== 'message' &&
      action !== 'ignore' &&
      action !== 'unignore'
  )

  if (offered.length === 0) return null

  const target = { nick, user: them?.user, host: them?.host }
  const mask = banMask(target)
  const weak = maskIsWeak(target)
  const quiet = quietMode(tokens.CHANMODES, parsePrefix(tokens.PREFIX))
  const adminMode = modeForRole(tokens.PREFIX, 'admin') ?? 'a'
  const founderMode = modeForRole(tokens.PREFIX, 'founder') ?? 'q'

  const setMode = (change: string, who: string): void => {
    window.switchboard.invoke('user:mode', serverId, channel, change, who)
  }

  const label: Partial<Record<MemberAction, string>> = {
    voice: 'Give voice',
    devoice: 'Take voice',
    halfop: 'Make half-operator',
    dehalfop: 'Remove half-operator',
    op: 'Make operator',
    deop: 'Remove operator',
    admin: 'Make admin',
    deadmin: 'Remove admin',
    founder: isSelf ? 'Step down as founder' : 'Make founder',
    defounder: isSelf ? 'Step down as founder' : 'Remove founder',
    kick: `Kick from ${channel}`,
    ban: weak ? `Ban ${mask} (nick only)` : `Ban ${mask}`,
    mute: weak ? `Mute ${mask} (nick only)` : `Mute ${mask}`
  }

  const run: Partial<Record<MemberAction, () => void>> = {
    voice: () => setMode('+v', nick),
    devoice: () => setMode('-v', nick),
    halfop: () => setMode('+h', nick),
    dehalfop: () => setMode('-h', nick),
    op: () => setMode('+o', nick),
    deop: () => setMode('-o', nick),
    admin: () => setMode(`+${adminMode}`, nick),
    deadmin: () => setMode(`-${adminMode}`, nick),
    founder: () => setMode(`+${founderMode}`, nick),
    defounder: () => setMode(`-${founderMode}`, nick),
    kick: () => window.switchboard.invoke('user:kick', serverId, channel, nick),
    ban: () => setMode('+b', mask),
    mute: () => setMode(`+${quiet ?? 'q'}`, mask)
  }

  const asks = (action: MemberAction): boolean =>
    action === 'kick' || action === 'ban' || action === 'founder'

  return (
    <div className="space-y-0.5 border-t border-gray-700 pt-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        In {channel}
      </div>
      {offered.map((action) => (
        <button
          key={action}
          onClick={() => {
            if (asks(action) && confirming !== action) {
              setConfirming(action)
              return
            }
            run[action]?.()
            onClose()
          }}
          className={`w-full rounded px-2 py-1 text-left text-xs hover:bg-gray-700 ${
            asks(action) ? 'text-red-400' : 'text-gray-300'
          }`}
        >
          {asks(action) && confirming === action ? 'Click again to confirm' : label[action] ?? action}
        </button>
      ))}
    </div>
  )
}

function CardAvatar({ nick, avatarUrl }: { nick: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [avatarUrl])

  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt={nick}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        className="h-10 w-10 shrink-0 rounded-full object-cover"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
      style={nickStyle(nick)}
    >
      {nick.charAt(0).toUpperCase()}
    </div>
  )
}

/** `1h 4m` rather than `3840`, which is what the server sends */
function idleFor(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return `${Math.max(0, seconds | 0)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}
