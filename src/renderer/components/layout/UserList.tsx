import { useState, useCallback, useEffect, useMemo } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUserStore } from '../../stores/userStore'
import { useUIStore } from '../../stores/uiStore'
import { nickColor } from '../../utils/nickColor'
import { displayNameFor, metadataColor, type UserMetadata } from '@shared/types/metadata'
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu'
import {
  actionsFor,
  parsePrefix,
  quietMode,
  banMask,
  maskIsWeak,
  type MemberAction
} from '@shared/powers'
import type { ChannelUser } from '@shared/types/channel'
import { PREFIX_RANKS } from '@shared/types/channel'
import { avatarUrl as safeAvatarUrl } from '@shared/avatar'
import { ignoresFor, DEFAULT_SCOPE, type IgnoreEntry } from '@shared/ignore'

const EMPTY_USERS: ChannelUser[] = []

interface UserContextState {
  x: number
  y: number
  user: ChannelUser
}

export function UserList() {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )

  const key = activeServerId && activeChannel
    ? `${activeServerId}:${activeChannel.toLowerCase()}`
    : null
  const users = useUserStore((s) => (key ? s.users[key] ?? EMPTY_USERS : EMPTY_USERS))
  const isupport = useServerStore((s) => s.isupport)
  // What *you* are wearing in this channel is the whole of what you may do
  const myNick = useServerStore((s) =>
    activeServerId ? s.currentNick[activeServerId] || '' : ''
  )

  // Group users by highest prefix
  const groups = groupUsersByPrefix(users)
  const [contextMenu, setContextMenu] = useState<UserContextState | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, user: ChannelUser) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, user })
  }, [])

  const handleWhois = useCallback((nick: string) => {
    if (!activeServerId) return
    window.switchboard.invoke('user:whois', activeServerId, nick)
  }, [activeServerId])

  const handleMessage = useCallback((nick: string) => {
    if (!activeServerId) return
    useChannelStore.getState().addChannel(activeServerId, nick)
    useChannelStore.getState().setActiveChannel(activeServerId, nick)
    useUIStore.getState().setDmMode(true)
  }, [activeServerId])

  const handleKick = useCallback((nick: string) => {
    if (!activeServerId || !activeChannel) return
    window.switchboard.invoke('user:kick', activeServerId, activeChannel, nick)
  }, [activeServerId, activeChannel])

  const handleMode = useCallback((change: string, target: string) => {
    if (!activeServerId || !activeChannel) return
    window.switchboard.invoke('user:mode', activeServerId, activeChannel, change, target)
  }, [activeServerId, activeChannel])

  /**
   * Everybody this client has been told not to hear from.
   *
   * Loaded once and kept in step by hand rather than subscribed to: the list
   * is small, changes only from a menu like this one, and a store of its own
   * would be a third copy of something the vault already owns.
   */
  const [ignores, setIgnores] = useState<IgnoreEntry[]>([])
  useEffect(() => {
    void window.switchboard.invoke('ignore:list').then(setIgnores)
  }, [])

  const handleIgnore = useCallback(async (mask: string) => {
    // This network only. Ignoring somebody everywhere is a bigger decision
    // than a right-click, and the settings list is where it is offered.
    if (!activeServerId) return
    setIgnores(await window.switchboard.invoke('ignore:add', mask, activeServerId, DEFAULT_SCOPE))
  }, [activeServerId])

  const handleUnignore = useCallback(async (target: { nick: string; user?: string | null; host?: string | null }) => {
    if (!activeServerId) return
    // Lift every entry that was silencing them, not just the one whose mask
    // happens to look like their nick — otherwise "stop ignoring" leaves them
    // ignored and the menu says so again a moment later.
    let list = ignores
    for (const entry of ignoresFor(ignores, activeServerId, target)) {
      list = await window.switchboard.invoke('ignore:remove', entry.mask, entry.network)
    }
    setIgnores(list)
  }, [activeServerId, ignores])

  /**
   * The menu for one person, from `@shared/powers`.
   *
   * Kick used to be on it unconditionally, so somebody with no rank in the
   * channel could press it and read `482 You're not channel operator`. What a
   * client can work out, it should: there is no IRCv3 extension that says
   * whether you may kick, but ISUPPORT says which roles this network has and
   * what you are wearing says where you stand among them.
   */
  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    if (!contextMenu) return []

    const tokens = activeServerId ? isupport[activeServerId] || {} : {}
    const scheme = parsePrefix(tokens.PREFIX)
    const quiet = quietMode(tokens.CHANMODES, scheme)
    const target = contextMenu.user
    const me = users.find((u) => u.nick.toLowerCase() === myNick.toLowerCase())
    const isSelf = target.nick.toLowerCase() === myNick.toLowerCase()

    const offered = actionsFor({
      prefix: tokens.PREFIX,
      chanmodes: tokens.CHANMODES,
      mine: (me?.prefixes || []).join(''),
      theirs: (target.prefixes || []).join(''),
      isSelf,
      ignored: ignoresFor(ignores, activeServerId ?? '', target).length > 0
    })

    const mask = banMask(target)
    const weak = maskIsWeak(target)
    const modeOf = (letter: string | null | undefined): string => letter || 'o'

    const label: Partial<Record<MemberAction, string>> = {
      whois: 'User info (WHOIS)',
      message: 'Message',
      voice: 'Give voice',
      devoice: 'Take voice',
      halfop: 'Make half-operator',
      dehalfop: 'Remove half-operator',
      op: 'Make operator',
      deop: 'Remove operator',
      kick: 'Kick',
      // Says which mask it will use, because banning the nick is undone by
      // changing it and somebody should know that before pressing it.
      ban: weak ? `Ban ${mask} (nick only)` : `Ban ${mask}`,
      mute: weak ? `Mute ${mask} (nick only)` : `Mute ${mask}`,
      // What it will actually silence, since an ignore follows a host rather
      // than a nick wherever we know one.
      ignore: weak ? `Ignore ${target.nick}` : `Ignore ${mask}`,
      unignore: 'Stop ignoring'
    }

    const run: Partial<Record<MemberAction, () => void>> = {
      whois: () => handleWhois(target.nick),
      message: () => handleMessage(target.nick),
      voice: () => handleMode('+v', target.nick),
      devoice: () => handleMode('-v', target.nick),
      halfop: () => handleMode('+h', target.nick),
      dehalfop: () => handleMode('-h', target.nick),
      op: () => handleMode('+o', target.nick),
      deop: () => handleMode('-o', target.nick),
      kick: () => handleKick(target.nick),
      ban: () => handleMode('+b', mask),
      mute: () => handleMode(`+${modeOf(quiet)}`, mask),
      ignore: () => void handleIgnore(mask),
      unignore: () => void handleUnignore(target)
    }

    const items: ContextMenuItem[] = []
    let lastWasTalk = false
    for (const action of offered) {
      const isTalk = action === 'whois' || action === 'message'
      if (lastWasTalk && !isTalk) items.push({ label: '', onClick: () => {}, separator: true })
      lastWasTalk = isTalk
      items.push({
        label: label[action] || action,
        onClick: run[action] || (() => {}),
        danger: action === 'kick' || action === 'ban'
      })
    }
    return items
  }, [contextMenu, activeServerId, isupport, users, myNick, ignores, handleWhois, handleMessage, handleKick, handleMode, handleIgnore, handleUnignore])

  return (
    <div className="w-60 shrink-0 overflow-y-auto bg-gray-900 px-2 py-3 no-select">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400 first:mt-0">
            {group.label} — {group.users.length}
          </div>
          {group.users.map((user) => (
            <UserItem
              key={user.nick}
              user={user}
              onContextMenu={handleContextMenu}
              onClick={handleWhois}
            />
          ))}
        </div>
      ))}

      {users.length === 0 && (
        <div className="px-2 text-sm text-gray-500">No users</div>
      )}

      {/* User context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

function UserItem({
  user,
  onContextMenu,
  onClick
}: {
  user: ChannelUser
  onContextMenu: (e: React.MouseEvent, user: ChannelUser) => void
  onClick: (nick: string) => void
}) {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const userMetadata = useServerStore((s) => s.userMetadata)
  const metadata: UserMetadata = activeServerId
    ? userMetadata[`${activeServerId}:${user.nick.toLowerCase()}`] ?? {}
    : {}
  // An avatar is a string a stranger typed. Only https, and only a real host.
  const avatarUrl = safeAvatarUrl(metadata.avatar)
  const shownName = displayNameFor(user.nick, metadata)
  const nameColor = metadataColor(metadata.color)

  const tooltipParts = [shownName === user.nick ? user.nick : `${shownName} (${user.nick})`]
  if (metadata.pronouns) tooltipParts.push(metadata.pronouns)
  if (metadata.status) tooltipParts.push(metadata.status)
  if (metadata.homepage) tooltipParts.push(metadata.homepage)
  if (user.account) tooltipParts.push(`Account: ${user.account}`)
  if (user.away && user.awayMessage) tooltipParts.push(`Away: ${user.awayMessage}`)

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-gray-700/50"
      onClick={() => onClick(user.nick)}
      onContextMenu={(e) => onContextMenu(e, user)}
      title={tooltipParts.join('\n')}
    >
      {/* Avatar */}
      <UserAvatar nick={user.nick} avatarUrl={avatarUrl} away={user.away} />

      <div className="flex flex-1 items-center overflow-hidden">
        {/* Prefix */}
        {user.prefixes.length > 0 && (
          <span className="mr-0.5 text-xs text-gray-400">
            {user.prefixes[0]}
          </span>
        )}

        {/* Nick */}
        <span
          className={`truncate text-sm ${user.away ? 'text-gray-500' : 'text-gray-300'}`}
          style={nameColor && !user.away ? { color: nameColor } : undefined}
        >
          {shownName}
        </span>

        {/* Bot badge */}
        {user.isBot && (
          <span className="ml-1 rounded bg-indigo-500/20 px-1 py-0.5 text-[10px] font-semibold uppercase text-indigo-400">
            Bot
          </span>
        )}
      </div>
    </button>
  )
}

interface UserGroup {
  label: string
  rank: number
  users: ChannelUser[]
}

function groupUsersByPrefix(users: ChannelUser[]): UserGroup[] {
  const groupMap = new Map<string, ChannelUser[]>()

  for (const user of users) {
    const highestPrefix = user.prefixes.length > 0 ? user.prefixes[0] : ''
    const key = highestPrefix || 'none'
    if (!groupMap.has(key)) {
      groupMap.set(key, [])
    }
    groupMap.get(key)!.push(user)
  }

  const labels: Record<string, string> = {
    '~': 'Owners',
    '&': 'Admins',
    '@': 'Ops',
    '%': 'Half-Ops',
    '+': 'Voiced',
    none: 'Members'
  }

  const groups: UserGroup[] = []
  for (const [prefix, groupUsers] of groupMap) {
    // Sort users alphabetically within group
    groupUsers.sort((a, b) => a.nick.localeCompare(b.nick, undefined, { sensitivity: 'base' }))

    groups.push({
      label: labels[prefix] || 'Members',
      rank: PREFIX_RANKS[prefix] || 0,
      users: groupUsers
    })
  }

  // Sort groups by rank (highest first)
  groups.sort((a, b) => b.rank - a.rank)
  return groups
}

function UserAvatar({ nick, avatarUrl, away }: { nick: string; avatarUrl: string | null; away: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [avatarUrl])

  return (
    <div className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${avatarUrl && !failed ? 'bg-gray-600' : nickColor(nick)} text-xs font-bold text-white`}>
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt={nick}
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          className="h-8 w-8 rounded-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        nick.charAt(0).toUpperCase()
      )}
      {away && (
        <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-gray-800 bg-gray-500" />
      )}
    </div>
  )
}
