import { AtSign, Download, Hash, Search, Server, Settings, Shield, Users } from 'lucide-react'
import { ICON, IconButton } from '../common/IconButton'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUIStore } from '../../stores/uiStore'
import { isChannelName, isServiceNick } from '@shared/constants'
import { FormattedText } from '../chat/MessageContent'
import { stripFormatting } from '@shared/formatting'
import { maskListsFor } from '@shared/masklists'
import { HoldingPill } from '../common/HoldingPill'

const EMPTY_CHANNELS: { name: string; topic: string | null }[] = []

export function TitleBar() {
  const activeServerId = useServerStore((s) => s.activeServerId)
  const activeChannel = useChannelStore((s) =>
    activeServerId ? s.activeChannel[activeServerId] ?? null : null
  )
  const channels = useChannelStore((s) =>
    activeServerId ? s.channels[activeServerId] ?? EMPTY_CHANNELS : EMPTY_CHANNELS
  )
  const showUserList = useUIStore((s) => s.showUserList)
  const dmMode = useUIStore((s) => s.dmMode)
  const mentionsMode = useUIStore((s) => s.mentionsMode)

  const channelInfo = channels.find(
    (ch) => ch.name.toLowerCase() === activeChannel?.toLowerCase()
  )

  // The whole map, indexed here. A selector returning `?? {}` hands back a new
  // object on every call, which to zustand is a changed value — and a store
  // that changes on every render is a render loop.
  const allIsupport = useServerStore((s) => s.isupport)
  const tokens = activeServerId ? allIsupport[activeServerId] : undefined
  const keepsLists = maskListsFor(tokens?.CHANMODES, tokens?.PREFIX).length > 0

  const isServer = activeChannel === '*'
  const isService = activeChannel ? isServiceNick(activeChannel) : false
  const isDM = activeChannel ? !isChannelName(activeChannel) && !isServer && !isService : false

  // Looking at direct messages with a channel still selected underneath: the
  // body already says "Direct Messages", and a header still announcing #lounge
  // disagrees with it about what you are even looking at.
  const inDmList = dmMode && !isDM

  return (
    <div
      className="flex h-12 items-center justify-between border-b border-gray-700 px-4 shadow-sm"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {mentionsMode && (
          <>
            <AtSign size={ICON.md} strokeWidth={2} className="shrink-0 text-gray-400" aria-hidden="true" />
            <span className="shrink-0 font-semibold text-gray-100">Mentions</span>
          </>
        )}
        {!mentionsMode && inDmList && (
          <span className="shrink-0 font-semibold text-gray-100">Direct Messages</span>
        )}
        {!mentionsMode && !inDmList && activeChannel && isServer && (
          <>
            <Server size={ICON.md} strokeWidth={2} className="shrink-0 text-gray-400" aria-hidden="true" />
            <span className="shrink-0 font-semibold text-gray-100">Server</span>
          </>
        )}
        {!mentionsMode && !inDmList && activeChannel && isService && (
          <>
            <Shield size={ICON.md} strokeWidth={2} className="shrink-0 text-gray-400" aria-hidden="true" />
            <span className="shrink-0 font-semibold text-gray-100">{activeChannel}</span>
          </>
        )}
        {!mentionsMode && !inDmList && activeChannel && isDM && (
          <>
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-600 text-xs font-bold text-gray-200">
              {activeChannel.charAt(0).toUpperCase()}
            </div>
            <span className="shrink-0 font-semibold text-gray-100">
              {activeChannel}
            </span>
          </>
        )}
        {!mentionsMode && !inDmList && activeChannel && !isDM && !isServer && !isService && (
          <>
            <Hash size={ICON.md} strokeWidth={2} className="shrink-0 text-gray-500" aria-hidden="true" />
            <span className="shrink-0 font-semibold text-gray-100">
              {activeChannel.replace(/^#/, '')}
            </span>
            {channelInfo?.topic && (
              <>
                <span className="shrink-0 mx-2 text-gray-600">|</span>
                <span className="truncate text-sm text-gray-400" title={stripFormatting(channelInfo.topic)}>
                  <FormattedText text={channelInfo.topic} />
                </span>
              </>
            )}
          </>
        )}
      </div>

      {/* Which thing is holding the connections — see `@shared/holding`.
          Outside the drag region, or the hover explanation never appears. */}
      <span style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <HoldingPill />
      </span>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/*
          What this channel is keeping — bans and the rest. Shown only in a
          channel on a network that keeps any: a shield that opens an empty
          box is worse than no shield.
        */}
        {!mentionsMode && !inDmList && activeChannel && !isDM && !isServer && !isService && keepsLists && (
          <IconButton
            icon={Shield}
            label="Bans and other channel lists"
            onClick={() => useUIStore.getState().openModal('channel-lists')}
          />
        )}
        {/*
          Everything said is in the database and nothing could get it out. A
          history you cannot export is a history you cannot keep when you stop
          using the app.
        */}
        {!mentionsMode && !inDmList && activeChannel && !isServer && (
          <IconButton
            icon={Download}
            label="Save this conversation to a file"
            onClick={async () => {
              if (!activeServerId || !activeChannel) return
              const saved = await window.switchboard.invoke(
                'transcript:save',
                activeServerId,
                activeChannel
              )
              if (saved) {
                useUIStore.getState().addToast({
                  title: 'Conversation saved',
                  body: `${saved.messages} message${saved.messages === 1 ? '' : 's'} to ${saved.path}`
                })
              }
            }}
          />
        )}
        <IconButton
          icon={Search}
          label="Search messages (Ctrl+F)"
          onClick={() => useUIStore.getState().openModal('search')}
        />
        {/* Toggle user list — channels only; a DM has no roster, and neither
            does a list of mentions from everywhere */}
        {!dmMode && !mentionsMode && (
          <IconButton
            icon={Users}
            label="Toggle member list"
            active={showUserList}
            onClick={() => useUIStore.getState().toggleUserList()}
          />
        )}
        <IconButton
          icon={Settings}
          label="Settings"
          onClick={() => useUIStore.getState().openModal('settings')}
        />
      </div>
    </div>
  )
}
