import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { IconButton } from '../common/IconButton'
import { useUserStore } from '../../stores/userStore'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'
import { nickStyle } from '../../utils/nickColor'
import { friendRoster, type Friend, type Watched } from '@shared/friends'

/**
 * Everyone you watch, on every network, as one list.
 *
 * Friends used to be a section under whichever network you happened to have
 * open, which made "is anyone about?" a question you answered by clicking
 * through the networks one at a time — and somebody watched on a network you
 * had not opened today was not on screen at all. Direct messages had already
 * stopped being per-network for exactly that reason, and this sits beside them
 * for the same one: both are lists of people rather than lists of places.
 *
 * `nick@network` because that is who somebody is. A nick without a network is
 * half a name on IRC, where the same one belongs to different people on
 * different networks — so the two are never merged, however alike they look.
 */
export function FriendsView() {
  const servers = useServerStore((s) => s.servers)
  const monitoredNicks = useUserStore((s) => s.monitoredNicks)
  const connectionStatus = useServerStore((s) => s.connectionStatus)

  const [adding, setAdding] = useState(false)
  const [newNick, setNewNick] = useState('')
  const [onServer, setOnServer] = useState('')

  const watched: Watched[] = servers.flatMap((server) =>
    (monitoredNicks[server.id] ?? []).map((one) => ({
      serverId: server.id,
      network: server.name,
      nick: one.nick,
      online: one.online
    }))
  )

  const roster = friendRoster(watched)
  const online = roster.filter((f) => f.online)
  const away = roster.filter((f) => !f.online)

  const open = (friend: Friend): void => {
    useServerStore.getState().setActiveServer(friend.serverId)
    useChannelStore.getState().addChannel(friend.serverId, friend.nick)
    useChannelStore.getState().setActiveChannel(friend.serverId, friend.nick)
    useChannelStore.getState().clearUnread(friend.serverId, friend.nick)
    // Stay in Messages: a conversation with a friend is a direct message, and
    // going somewhere is what closes this list
    useUIStore.getState().setFriendsOpen(false)
    useUIStore.getState().rememberDm(friend.serverId, friend.nick)
  }

  const remove = (friend: Friend): void => {
    void window.switchboard.invoke('monitor:remove', friend.serverId, [friend.nick])
    useUserStore.getState().removeMonitorNick(friend.serverId, friend.nick)
  }

  // Somewhere to put a new one. Connected first: a network that is not up
  // cannot be told to watch anybody, and the list is short enough to read.
  const reachable = servers.filter((s) => connectionStatus[s.id] === 'connected')
  const target = onServer || reachable[0]?.id || ''

  const add = (): void => {
    const nick = newNick.trim()
    if (!nick || !target) return
    void window.switchboard.invoke('monitor:add', target, [nick])
    useUserStore.getState().addMonitorNick(target, nick)
    setNewNick('')
    setAdding(false)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-800 px-4 py-2">
        <span className="text-sm text-gray-400">
          {online.length} of {roster.length} online
        </span>
        <IconButton
          size="sm"
          icon={UserPlus}
          label="Watch somebody"
          active={adding}
          onClick={() => setAdding((on) => !on)}
        />
      </div>

      {adding && (
        <form
          className="flex items-center gap-2 border-b border-gray-800 px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <input
            type="text"
            value={newNick}
            autoFocus
            onChange={(event) => setNewNick(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setAdding(false)
                setNewNick('')
              }
            }}
            placeholder="Nickname"
            className="min-w-0 flex-1 rounded bg-gray-950 px-2 py-1.5 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:ring-1 focus:ring-indigo-500"
          />
          {/* Which network, because a nick on its own is half a name */}
          <select
            value={target}
            onChange={(event) => setOnServer(event.target.value)}
            className="rounded bg-gray-950 px-2 py-1.5 text-sm text-gray-200 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {reachable.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!target}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 disabled:opacity-40"
          >
            Watch
          </button>
        </form>
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {roster.length === 0 && !adding && (
          <p className="px-2 py-8 text-center text-sm text-gray-500">
            Nobody yet. Add somebody here, or open a name in a channel and choose “Tell me when
            they are online”.
          </p>
        )}

        {online.length > 0 && <Heading text={`Online — ${online.length}`} />}
        {online.map((friend) => (
          <Row key={key(friend)} friend={friend} onOpen={open} onRemove={remove} />
        ))}

        {away.length > 0 && <Heading text={`Offline — ${away.length}`} />}
        {away.map((friend) => (
          <Row key={key(friend)} friend={friend} onOpen={open} onRemove={remove} />
        ))}
      </div>
    </div>
  )
}

const key = (friend: Friend): string => `${friend.serverId}:${friend.nick.toLowerCase()}`

function Heading({ text }: { text: string }) {
  return (
    <span className="mt-2 block px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      {text}
    </span>
  )
}

function Row({
  friend,
  onOpen,
  onRemove
}: {
  friend: Friend
  onOpen: (friend: Friend) => void
  onRemove: (friend: Friend) => void
}) {
  return (
    <div className="group relative">
      <button
        onClick={() => onOpen(friend)}
        className="mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-700/50"
      >
        <div className="relative shrink-0">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
              friend.online ? '' : 'opacity-40'
            }`}
            style={nickStyle(friend.nick)}
          >
            {friend.nick.charAt(0).toUpperCase()}
          </div>
          <div
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-gray-900 ${
              friend.online ? 'bg-green-500' : 'bg-gray-500'
            }`}
          />
        </div>

        <span className={`min-w-0 flex-1 truncate text-sm ${friend.online ? 'text-gray-100' : 'text-gray-400'}`}>
          {friend.nick}
          <span className="text-gray-500">@{friend.network}</span>
        </span>
      </button>

      <IconButton
        size="sm"
        icon={X}
        label="Stop watching"
        danger
        className="absolute right-1 top-1/2 hidden -translate-y-1/2 group-hover:inline-flex"
        onClick={(event) => {
          event.stopPropagation()
          onRemove(friend)
        }}
      />
    </div>
  )
}
