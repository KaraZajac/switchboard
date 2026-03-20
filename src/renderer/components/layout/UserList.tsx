import { useState, useCallback, useEffect } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUserStore } from '../../stores/userStore'
import { useUIStore } from '../../stores/uiStore'
import { nickColor } from '../../utils/nickColor'
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu'
import type { ChannelUser } from '@shared/types/channel'
import { PREFIX_RANKS } from '@shared/types/channel'

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

  const contextMenuItems: ContextMenuItem[] = contextMenu ? [
    { label: 'User Info (WHOIS)', onClick: () => handleWhois(contextMenu.user.nick) },
    { label: 'Message', onClick: () => handleMessage(contextMenu.user.nick) },
    { label: '', onClick: () => {}, separator: true },
    { label: 'Kick', onClick: () => handleKick(contextMenu.user.nick), danger: true }
  ] : []

  return (
    <div className="w-60 shrink-0 overflow-y-auto bg-gray-800 px-2 py-4 no-select">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="mb-1 mt-4 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400 first:mt-0">
            {group.label} — {group.users.length}
          </div>
          {group.users.map((user) => (
            <UserItem key={user.nick} user={user} onContextMenu={handleContextMenu} />
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

function UserItem({ user, onContextMenu }: { user: ChannelUser; onContextMenu: (e: React.MouseEvent, user: ChannelUser) => void }) {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const userAvatars = useServerStore((s) => s.userAvatars)
  const avatarUrl = activeServerId
    ? userAvatars[`${activeServerId}:${user.nick.toLowerCase()}`] ?? null
    : null

  const tooltipParts = [user.nick]
  if (user.account) tooltipParts.push(`Account: ${user.account}`)
  if (user.away && user.awayMessage) tooltipParts.push(`Away: ${user.awayMessage}`)

  return (
    <div
      className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-gray-700/50"
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
          className={`truncate text-sm ${
            user.away ? 'text-gray-500' : 'text-gray-300'
          }`}
        >
          {user.nick}
        </span>

        {/* Bot badge */}
        {user.isBot && (
          <span className="ml-1 rounded bg-indigo-500/20 px-1 py-0.5 text-[10px] font-semibold uppercase text-indigo-400">
            Bot
          </span>
        )}
      </div>
    </div>
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
