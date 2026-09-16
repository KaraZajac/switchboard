import { Plus, Users, X } from 'lucide-react'
import { ICON, IconButton } from '../common/IconButton'
import { useUserStore } from '../../stores/userStore'
import { useState, useRef, useEffect } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'
import { UserProfilePanel } from '../user/UserProfilePanel'
import { isChannelName, isServiceNick } from '@shared/constants'

interface DMEntry {
  serverId: string
  serverName: string
  nick: string
  unreadCount: number
  mentionCount: number
}

export function DMSidebar() {
  const servers = useServerStore((s) => s.servers)
  const friendsOpen = useUIStore((s) => s.friendsOpen)
  const monitoredNicks = useUserStore((s) => s.monitoredNicks)
  // The one number worth carrying here: whether anybody is about
  const friendsOnline = Object.values(monitoredNicks).reduce(
    (total, list) => total + list.filter((one) => one.online).length,
    0
  )
  const allChannels = useChannelStore((s) => s.channels)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )
  const [showInput, setShowInput] = useState(false)
  const [newNick, setNewNick] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus()
    }
  }, [showInput])

  // Collect all DMs across all servers (exclude services and server console)
  const dms: DMEntry[] = []
  for (const server of servers) {
    const channels = allChannels[server.id] || []
    for (const ch of channels) {
      if (!isChannelName(ch.name) && ch.name !== '*' && !isServiceNick(ch.name)) {
        dms.push({
          serverId: server.id,
          serverName: server.name,
          nick: ch.name,
          unreadCount: ch.unreadCount,
          mentionCount: ch.mentionCount
        })
      }
    }
  }

  // Unread first, then by name. The order used to be however the servers and
  // their channels happened to be walked, so a conversation waiting on an
  // answer sat wherever it sat, and the list reshuffled as channels came and
  // went. The phone answers this the same way.
  dms.sort((a, b) => {
    const waiting = Number(b.unreadCount > 0) - Number(a.unreadCount > 0)
    if (waiting !== 0) return waiting
    return a.nick.toLowerCase().localeCompare(b.nick.toLowerCase())
  })

  const handleDMClick = (serverId: string, nick: string) => {
    // Going to a conversation is what closes the friend list
    useUIStore.getState().setFriendsOpen(false)
    useServerStore.getState().setActiveServer(serverId)
    useChannelStore.getState().setActiveChannel(serverId, nick)
    useChannelStore.getState().clearUnread(serverId, nick)
    // So coming back to Messages lands here rather than on nothing
    useUIStore.getState().rememberDm(serverId, nick)
  }

  const handleClose = (serverId: string, nick: string) => {
    useChannelStore.getState().removeChannel(serverId, nick)
  }

  const handleNewDM = () => {
    const nick = newNick.trim()
    if (!nick || !activeServerId) return
    useChannelStore.getState().addChannel(activeServerId, nick)
    useChannelStore.getState().setActiveChannel(activeServerId, nick)
    useUIStore.getState().setDmMode(true)
    setNewNick('')
    setShowInput(false)
  }

  return (
    <div className="flex w-60 shrink-0 flex-col bg-gray-900 no-select">
      {/* Header */}
      <div className="flex h-12 items-center justify-between border-b border-gray-700 px-4 shadow-sm">
        <span className="font-semibold">Direct Messages</span>
        <IconButton size="sm" icon={Plus} label="New message" active={showInput} onClick={() => setShowInput(!showInput)} />
      </div>

      {/* New DM input */}
      {showInput && (
        <div className="border-b border-gray-700 px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={newNick}
            onChange={(e) => setNewNick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNewDM()
              if (e.key === 'Escape') { setShowInput(false); setNewNick('') }
            }}
            placeholder="Enter a nickname..."
            className="w-full rounded bg-gray-950 px-2 py-1.5 text-sm text-gray-100 placeholder-gray-500 outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      )}

      {/*
        Friends, above the conversations and outside them.

        Where Discord keeps it, and for the same reason: a friend is somebody
        you might talk to, a conversation is somebody you have. The list itself
        crosses networks — see `FriendsView`.
      */}
      <button
        onClick={() => useUIStore.getState().setFriendsOpen(true)}
        className={`mx-2 mt-2 flex items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
          friendsOpen
            ? 'bg-gray-700 text-white'
            : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
        }`}
      >
        <Users size={ICON.md} strokeWidth={2} className="shrink-0" aria-hidden="true" />
        <span className="flex-1 text-sm font-medium">Friends</span>
        {friendsOnline > 0 && (
          <span className="text-xs text-gray-500">{friendsOnline} online</span>
        )}
      </button>

      {/* DM list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {dms.length === 0 && !showInput && (
          <p className="px-2 py-4 text-center text-sm text-gray-500">
            No conversations yet. Click + to start one.
          </p>
        )}

        {dms.map((dm: DMEntry) => {
          const isActive =
            dm.serverId === activeServerId &&
            activeChannel?.toLowerCase() === dm.nick.toLowerCase()
          const hasUnread = dm.unreadCount > 0

          return (
            <div key={`${dm.serverId}:${dm.nick}`} className="group relative">
              <button
                onClick={() => handleDMClick(dm.serverId, dm.nick)}
                className={`mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors ${
                  isActive
                    ? 'bg-gray-700 text-white'
                    : hasUnread
                      ? 'text-gray-100 hover:bg-gray-700/50'
                      : 'text-gray-400 hover:bg-gray-700/50 hover:text-gray-200'
                }`}
              >
                {/* Avatar */}
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs font-bold text-gray-200">
                  {dm.nick.charAt(0).toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">
                  <span className={`truncate text-sm ${hasUnread && !isActive ? 'font-semibold' : ''}`}>
                    {dm.nick}
                  </span>
                  {servers.length > 1 && (
                    <div className="truncate text-xs text-gray-500">{dm.serverName}</div>
                  )}
                </div>

                {dm.mentionCount > 0 && (
                  <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {dm.mentionCount}
                  </span>
                )}
              </button>

              {/* Close button on hover */}
              <IconButton
                size="sm"
                icon={X}
                label="Close conversation"
                className="absolute right-1 top-1/2 hidden -translate-y-1/2 group-hover:inline-flex"
                onClick={(e) => {
                  e.stopPropagation()
                  handleClose(dm.serverId, dm.nick)
                }}
              />
            </div>
          )
        })}
      </div>

      {/* User profile */}
      <UserProfilePanel />
    </div>
  )
}
