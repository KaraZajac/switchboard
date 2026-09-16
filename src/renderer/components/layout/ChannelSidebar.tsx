import { BellOff, ChevronDown, Hash, Plus, Server, Shield } from 'lucide-react'
import { ICON } from '../common/IconButton'
import { SectionHeader } from '../common/SectionHeader'
import { useState, useCallback, useMemo } from 'react'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { ContextMenu } from '../common/ContextMenu'
import { ServerMenu } from '../server/ServerMenu'
import { ChannelBrowser } from '../channel/ChannelBrowser'
import { UserProfilePanel } from '../user/UserProfilePanel'
import { isChannelName, isServiceNick } from '@shared/constants'
import { rowLook, rowBadge, badgeLabel, badgeDiameter } from '@shared/unread'

const EMPTY_CHANNELS: { name: string; serverId: string; topic: string | null; topicSetBy: string | null; unreadCount: number; mentionCount: number; muted: boolean }[] = []

interface ChannelContextState {
  x: number
  y: number
  channelName: string
  muted: boolean
}

export function ChannelSidebar() {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const servers = useServerStore((s) => s.servers)
  const servicesSeen = useServerStore((s) => s.servicesSeen)
  const allChannels = useChannelStore((s) =>
    activeServerId ? s.channels[activeServerId] ?? EMPTY_CHANNELS : EMPTY_CHANNELS
  )
  const channels = useMemo(
    () => allChannels.filter((ch) => isChannelName(ch.name)),
    [allChannels]
  )
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )
  const connectionStatus = useServerStore((s) =>
    activeServerId ? s.connectionStatus[activeServerId] ?? 'disconnected' : 'disconnected'
  )

  const server = servers.find((s) => s.id === activeServerId)
  const [contextMenu, setContextMenu] = useState<ChannelContextState | null>(null)
  const [showBrowser, setShowBrowser] = useState(false)
  const [serverMenu, setServerMenu] = useState<{ x: number; y: number } | null>(null)
  const [channelsCollapsed, setChannelsCollapsed] = useState(false)

  const handleContextMenu = useCallback((e: React.MouseEvent, channelName: string, muted: boolean) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, channelName, muted })
  }, [])

  const handleLeaveChannel = useCallback((channelName: string) => {
    if (!activeServerId) return
    window.switchboard.invoke('channel:part', activeServerId, channelName)
    useChannelStore.getState().removeChannel(activeServerId, channelName)
  }, [activeServerId])

  // Every line, or only your name — see `notifyAll` in the channel store
  const handleToggleNotifyAll = useCallback((channelName: string) => {
    if (!activeServerId) return
    useChannelStore.getState().toggleNotifyAll(activeServerId, channelName)
  }, [activeServerId])

  const handleToggleMute = useCallback((channelName: string, durationMs?: number) => {
    if (!activeServerId) return
    useChannelStore.getState().toggleMute(activeServerId, channelName, durationMs)
  }, [activeServerId])

  const handleChannelClick = (name: string) => {
    if (!activeServerId) return
    // Ensure channel entry exists (needed for services like NickServ/ChanServ)
    useChannelStore.getState().addChannel(activeServerId, name)
    useChannelStore.getState().setActiveChannel(activeServerId, name)
    useChannelStore.getState().clearUnread(activeServerId, name)
  }

  return (
    <div className="flex w-60 shrink-0 flex-col bg-gray-900 no-select">
      {/* Server header — opens the server menu, like a Discord server dropdown */}
      <button
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setServerMenu(serverMenu ? null : { x: rect.left + 8, y: rect.bottom + 2 })
        }}
        className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-gray-700 px-4 text-left shadow-sm transition-colors hover:bg-gray-700/30"
        title="Server options"
      >
        <span className="truncate font-semibold text-gray-100">{server?.name || 'No Server'}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {connectionStatus !== 'connected' && (
            <span
              className={`h-2 w-2 rounded-full ${
                connectionStatus === 'disconnected' ? 'bg-gray-600' : 'bg-yellow-500'
              }`}
              title={
                connectionStatus === 'connecting'
                  ? 'Connecting'
                  : connectionStatus === 'reconnecting'
                    ? 'Not connected, trying again'
                    : 'Not connected'
              }
            />
          )}
          <ChevronDown
            size={ICON.sm}
            strokeWidth={2}
            aria-hidden="true"
            className={`text-gray-400 transition-transform ${serverMenu ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* Services — Server, NickServ, ChanServ */}
        {connectionStatus === 'connected' && (
          <ServiceItems
            activeChannel={activeChannel}
            allChannels={allChannels}
            seen={servicesSeen[activeServerId || ''] || []}
            onChannelClick={handleChannelClick}
          />
        )}

        {(channels.length > 0 || connectionStatus === 'connected') && (
          <SectionHeader
            label="Channels"
            collapsed={channelsCollapsed}
            onToggle={() => setChannelsCollapsed((c) => !c)}
            action={
              connectionStatus === 'connected'
                ? { icon: Plus, label: 'Browse channels', onClick: () => setShowBrowser(true) }
                : undefined
            }
          />
        )}

        {!channelsCollapsed &&
          channels.map((ch) => {
            const isActive = activeChannel?.toLowerCase() === ch.name.toLowerCase()
            // Shared with the phone: grey for quiet, white for something said,
            // a number only where somebody said your name — and that number
            // greys out rather than disappearing when the channel is muted.
            const look = rowLook({ unread: ch.unreadCount, muted: Boolean(ch.muted) }, isActive)
            const hasUnread = look === 'unread'
            const badge = rowBadge({ mentions: ch.mentionCount, muted: Boolean(ch.muted) })

            return (
              <div key={ch.name} className="relative">
                {/* Unread pill at the very edge of the sidebar */}
                {hasUnread && !isActive && (
                  <span className="absolute -left-2 top-1/2 h-2 w-1 -translate-y-1/2 rounded-r-full bg-gray-100" />
                )}
                <button
                  onClick={() => handleChannelClick(ch.name)}
                  onContextMenu={(e) => handleContextMenu(e, ch.name, ch.muted)}
                  className={`mb-0.5 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors ${
                    isActive
                      ? 'bg-gray-700 text-white'
                      : hasUnread
                        ? 'text-gray-100 hover:bg-gray-700/40'
                        : ch.muted
                          ? 'text-gray-500 hover:bg-gray-700/40 hover:text-gray-300'
                          : 'text-gray-400 hover:bg-gray-700/40 hover:text-gray-200'
                  }`}
                >
                  <Hash size={ICON.sm} strokeWidth={2} className="shrink-0 text-gray-500" aria-hidden="true" />
                  <span className={`flex-1 truncate ${hasUnread && !isActive ? 'font-semibold' : ''}`}>
                    {ch.name.replace(/^#/, '')}
                  </span>
                  {ch.muted && (
                    <BellOff size={ICON.sm} strokeWidth={2} className="shrink-0 text-gray-500" aria-hidden="true" />
                  )}
                  {badge && (
                    <span
                      style={{
                        width: badgeDiameter(badge.count),
                        height: badgeDiameter(badge.count),
                        fontSize: badgeDiameter(badge.count) > 22 ? 10 : 11
                      }}
                      className={`flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white ${
                        badge.muted ? 'bg-gray-600' : 'bg-red-500'
                      }`}
                    >
                      {badgeLabel(badge.count)}
                    </span>
                  )}
                </button>
              </div>
            )
          })}

        {channels.length === 0 && connectionStatus === 'connected' && !channelsCollapsed && (
          <p className="px-2 py-3 text-sm leading-relaxed text-gray-500">
            No channels yet — browse with the <span className="text-gray-400">+</span> above, or
            type <span className="font-mono text-gray-400">/join #channel</span>.
          </p>
        )}

        {connectionStatus === 'connecting' && (
          <p className="px-2 py-4 text-center text-sm text-gray-500">Connecting…</p>
        )}

        {/*
          The way back on, where the eye goes. "Not connected" on its own
          left the one thing to do behind a dropdown arrow most people never
          opened; the network was simply off, with nothing to press.
        */}
        {(connectionStatus === 'disconnected' || connectionStatus === 'reconnecting') && (
          <div className="flex flex-col items-center gap-2 px-2 py-4">
            <p className="text-sm text-gray-500">
              {connectionStatus === 'reconnecting'
                ? 'Not connected. Trying again…'
                : 'Not connected'}
            </p>
            <button
              onClick={() => {
                if (!activeServerId) return
                useServerStore.getState().setConnectionStatus(activeServerId, 'connecting')
                window.switchboard.invoke('server:connect', activeServerId)
              }}
              className="rounded-md bg-indigo-600 px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
            >
              {connectionStatus === 'reconnecting' ? 'Try now' : 'Connect'}
            </button>
          </div>
        )}

        {/*
          No friend list here any more. It was a section under whichever
          network you had open, which made "is anybody about?" a question you
          answered by clicking through the networks one at a time — and left
          somebody watched on a network you had not opened today off the screen
          entirely. It is one list across all of them now, in Messages beside
          the conversations: see `FriendsView`.
        */}
      </div>

      {/* User profile */}
      <UserProfilePanel />

      {/* Channel browser */}
      {showBrowser && <ChannelBrowser onClose={() => setShowBrowser(false)} />}

      {/* Server dropdown */}
      {serverMenu && activeServerId && (
        <ServerMenu
          serverId={activeServerId}
          x={serverMenu.x}
          y={serverMenu.y}
          onClose={() => setServerMenu(null)}
          extraItems={[
            { label: 'Browse Channels', onClick: () => setShowBrowser(true) },
            { label: '', onClick: () => {}, separator: true }
          ]}
        />
      )}

      {/* Channel context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={contextMenu.muted
            ? [
                {
                  label: 'Unmute Channel',
                  onClick: () => handleToggleMute(contextMenu.channelName)
                },
                { label: '', onClick: () => {}, separator: true },
                {
                  label: 'Leave Channel',
                  onClick: () => handleLeaveChannel(contextMenu.channelName),
                  danger: true
                }
              ]
            : [
                {
                  label:
                    activeServerId &&
                    useChannelStore.getState().notifiesAll(activeServerId, contextMenu.channelName)
                      ? 'Notify for mentions only'
                      : 'Notify for every message',
                  onClick: () => handleToggleNotifyAll(contextMenu.channelName)
                },
                { label: '', onClick: () => {}, separator: true },
                {
                  label: 'Mute for 15 minutes',
                  onClick: () => handleToggleMute(contextMenu.channelName, 15 * 60 * 1000)
                },
                {
                  label: 'Mute for 1 hour',
                  onClick: () => handleToggleMute(contextMenu.channelName, 60 * 60 * 1000)
                },
                {
                  label: 'Mute for 8 hours',
                  onClick: () => handleToggleMute(contextMenu.channelName, 8 * 60 * 60 * 1000)
                },
                {
                  label: 'Mute for 24 hours',
                  onClick: () => handleToggleMute(contextMenu.channelName, 24 * 60 * 60 * 1000)
                },
                {
                  label: 'Mute until turned back on',
                  onClick: () => handleToggleMute(contextMenu.channelName)
                },
                { label: '', onClick: () => {}, separator: true },
                {
                  label: 'Leave Channel',
                  onClick: () => handleLeaveChannel(contextMenu.channelName),
                  danger: true
                }
              ]
          }
        />
      )}
    </div>
  )
}

/**
 * What to list above the channels: the console, and whatever services this
 * network actually has.
 *
 * It used to be a fixed three — Server, NickServ, ChanServ — shown whenever
 * connected. That invents a NickServ on a network with no services at all,
 * and misses Undernet's `X` and QuakeNet's `Q`, which is exactly where
 * somebody would need the help.
 *
 * A bot is here because it has spoken to us or we have spoken to it, which is
 * the only honest signal IRC offers: there is no ISUPPORT token for "this
 * network has a NickServ". The phone detects them the same way.
 */
function serviceEntries(
  seen: string[]
): { name: string; label: string; icon: 'server' | 'service' }[] {
  const services = seen
    .filter((nick) => isServiceNick(nick))
    .map((nick) => ({ name: nick, label: nick, icon: 'service' as const }))

  return [{ name: '*', label: 'Server', icon: 'server' as const }, ...services]
}

function ServiceIcon({ type }: { type: 'server' | 'service' }) {
  const Icon = type === 'server' ? Server : Shield
  return <Icon size={ICON.sm} strokeWidth={2} className="shrink-0 text-gray-500" aria-hidden="true" />
}

interface ServiceItemsProps {
  activeChannel: string | null
  /** The services this network has actually shown us */
  seen: string[]
  allChannels: { name: string; unreadCount: number; mentionCount: number; muted?: boolean }[]
  onChannelClick: (name: string) => void
}

function ServiceItems({ activeChannel, allChannels, seen, onChannelClick }: ServiceItemsProps) {
  return (
    <div className="mb-1">
      {serviceEntries(seen).map((entry) => {
        const isActive = activeChannel === entry.name ||
          (entry.name !== '*' && activeChannel?.toLowerCase() === entry.name.toLowerCase())
        const chInfo = allChannels.find((ch) => ch.name.toLowerCase() === entry.name.toLowerCase())
        // The same three states as everywhere else, and the same circle
        const look = rowLook(
          { unread: chInfo?.unreadCount ?? 0, muted: Boolean(chInfo?.muted) },
          isActive
        )
        const badge = rowBadge({
          mentions: chInfo?.mentionCount ?? 0,
          muted: Boolean(chInfo?.muted)
        })

        return (
          <button
            key={entry.name}
            onClick={() => onChannelClick(entry.name)}
            className={`mb-0.5 flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors ${
              isActive
                ? 'bg-gray-700 text-white'
                : look === 'unread'
                  ? 'text-gray-100 hover:bg-gray-700/40'
                  : 'text-gray-400 hover:bg-gray-700/40 hover:text-gray-200'
            }`}
          >
            <ServiceIcon type={entry.icon} />
            <span className={`truncate ${look === 'unread' ? 'font-semibold' : ''}`}>
              {entry.label}
            </span>
            {badge && (
              <span
                style={{
                  width: badgeDiameter(badge.count),
                  height: badgeDiameter(badge.count),
                  fontSize: badgeDiameter(badge.count) > 22 ? 10 : 11
                }}
                className={`ml-auto flex shrink-0 items-center justify-center rounded-full font-bold leading-none text-white ${
                  badge.muted ? 'bg-gray-600' : 'bg-red-500'
                }`}
              >
                {badgeLabel(badge.count)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
