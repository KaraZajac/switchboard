import { useState, useCallback, useRef, useEffect } from 'react'
import { useServerStore } from '../../stores/serverStore'

/** Avatar image with fallback to letter initial on error */
function AvatarImg({ src, nick, size = 'h-8 w-8', textSize = 'text-sm' }: { src: string; nick: string; size?: string; textSize?: string }) {
  const [failed, setFailed] = useState(false)

  // Reset failed state when src changes
  useEffect(() => { setFailed(false) }, [src])

  if (failed) {
    return (
      <div className={`flex ${size} items-center justify-center rounded-full bg-indigo-500 ${textSize} font-medium text-white`}>
        {nick.charAt(0).toUpperCase()}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={nick}
      referrerPolicy="no-referrer"
      crossOrigin="anonymous"
      className={`${size} rounded-full object-cover`}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * User profile panel shown at the bottom of the channel sidebar.
 * Displays current nick/avatar and allows editing nick, username, realname.
 * Supports draft/metadata-2 for avatar URLs.
 */
export function UserProfilePanel() {
  // Read raw state slices with stable selectors to avoid infinite loops
  const activeServerId = useServerStore((s) => s.activeServerId)
  const servers = useServerStore((s) => s.servers)
  const currentNicks = useServerStore((s) => s.currentNick)
  const connectionStatuses = useServerStore((s) => s.connectionStatus)
  const userAvatars = useServerStore((s) => s.userAvatars)
  const allCapabilities = useServerStore((s) => s.capabilities)
  const awayMessages = useServerStore((s) => s.awayMessage)

  // Derive values in the component body
  const currentNick = activeServerId ? currentNicks[activeServerId] ?? null : null
  const server = servers.find((sv) => sv.id === activeServerId)
  const connectionStatus = activeServerId ? connectionStatuses[activeServerId] ?? 'disconnected' : 'disconnected'
  const avatarUrl = activeServerId && currentNick
    ? userAvatars[`${activeServerId}:${currentNick.toLowerCase()}`] ?? null
    : null
  const capabilities = activeServerId ? allCapabilities[activeServerId] ?? [] : []
  const awayMessage = activeServerId ? awayMessages[activeServerId] ?? null : null
  const isAway = awayMessage !== null

  const [showPopup, setShowPopup] = useState(false)
  const popupRef = useRef<HTMLDivElement>(null)

  // Close popup on outside click
  useEffect(() => {
    if (!showPopup) return
    const handleClick = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowPopup(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPopup])

  if (!activeServerId || connectionStatus !== 'connected' || !currentNick) {
    return null
  }

  const displayNick = currentNick
  const supportsSetname = capabilities.includes('setname')
  const supportsMetadata = capabilities.includes('draft/metadata-2')

  return (
    <div className="relative border-t border-gray-700">
      <button
        onClick={() => setShowPopup(!showPopup)}
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-700/50"
      >
        {/* Avatar */}
        {avatarUrl ? (
          <AvatarImg src={avatarUrl} nick={displayNick} />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-sm font-medium text-white">
            {displayNick.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Nick & status */}
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium text-gray-100">{displayNick}</div>
          <div className={`truncate text-xs ${isAway ? 'text-yellow-400' : 'text-gray-400'}`}>
            {isAway ? awayMessage : 'Online'}
          </div>
        </div>

        {/* Settings gear */}
        <svg
          className="h-4 w-4 shrink-0 text-gray-400 hover:text-gray-200"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
        </svg>
      </button>

      {/* Edit popup */}
      {showPopup && (
        <ProfileEditPopup
          serverId={activeServerId}
          nick={displayNick}
          username={server?.username ?? ''}
          realname={server?.realname ?? ''}
          avatarUrl={avatarUrl}
          awayMessage={awayMessage}
          supportsSetname={supportsSetname}
          supportsMetadata={supportsMetadata}
          onClose={() => setShowPopup(false)}
          popupRef={popupRef}
        />
      )}
    </div>
  )
}

interface ProfileEditPopupProps {
  serverId: string
  nick: string
  username: string
  realname: string
  avatarUrl: string | null
  awayMessage: string | null
  supportsSetname: boolean
  supportsMetadata: boolean
  onClose: () => void
  popupRef: React.RefObject<HTMLDivElement | null>
}

function ProfileEditPopup({
  serverId,
  nick,
  username,
  realname,
  avatarUrl,
  awayMessage,
  supportsSetname,
  supportsMetadata,
  onClose,
  popupRef
}: ProfileEditPopupProps) {
  const [editNick, setEditNick] = useState(nick)
  const [editRealname, setEditRealname] = useState(realname)
  const [editAvatarUrl, setEditAvatarUrl] = useState(avatarUrl ?? '')
  const [editAwayMessage, setEditAwayMessage] = useState(awayMessage ?? '')
  const [isAway, setIsAway] = useState(awayMessage !== null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)

    try {
      // Change nick if different
      if (editNick.trim() && editNick.trim() !== nick) {
        await window.switchboard.invoke('user:nick', serverId, editNick.trim())
      }

      // Change realname if different
      if (editRealname.trim() !== realname) {
        // Persist to server config for next connection
        await window.switchboard.invoke('server:update', serverId, { realname: editRealname.trim() })
        useServerStore.getState().updateServer(serverId, { realname: editRealname.trim() })

        // Apply immediately if server supports SETNAME
        if (supportsSetname) {
          await window.switchboard.invoke('user:setname', serverId, editRealname.trim())
        }
      }

      // Set avatar via metadata if supported
      if (supportsMetadata && editAvatarUrl.trim() !== (avatarUrl ?? '')) {
        const newUrl = editAvatarUrl.trim()
        // Update locally immediately for instant feedback
        useServerStore.getState().setUserAvatar(serverId, nick, newUrl)
        await window.switchboard.invoke('metadata:set', serverId, 'avatar', newUrl)
      }

      // Set/clear away status
      const wasAway = awayMessage !== null
      if (isAway && !wasAway) {
        await window.switchboard.invoke('user:away', serverId, editAwayMessage.trim() || 'Away')
      } else if (isAway && wasAway && editAwayMessage.trim() !== awayMessage) {
        await window.switchboard.invoke('user:away', serverId, editAwayMessage.trim() || 'Away')
      } else if (!isAway && wasAway) {
        await window.switchboard.invoke('user:away', serverId)
      }

      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [serverId, nick, editNick, realname, editRealname, avatarUrl, editAvatarUrl, awayMessage, isAway, editAwayMessage, supportsSetname, supportsMetadata, onClose])

  return (
    <div
      ref={popupRef}
      className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-lg bg-gray-900 p-4 shadow-xl ring-1 ring-gray-700"
    >
      <h3 className="mb-3 text-sm font-semibold text-gray-100">Edit Profile</h3>

      <div className="space-y-3">
        {/* Avatar preview */}
        <div className="flex items-center gap-3">
          {editAvatarUrl ? (
            <AvatarImg src={editAvatarUrl} nick={editNick || nick} size="h-12 w-12" textSize="text-lg" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500 text-lg font-medium text-white">
              {(editNick || nick).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-100">{editNick || nick}</div>
            <div className="text-xs text-gray-400">{username}</div>
          </div>
        </div>

        {/* Nickname */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">Nickname</label>
          <input
            type="text"
            value={editNick}
            onChange={(e) => setEditNick(e.target.value)}
            className="w-full rounded bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
          />
        </div>

        {/* Realname */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Real Name
            {!supportsSetname && (
              <span className="ml-1 text-gray-500">(change on reconnect)</span>
            )}
          </label>
          <input
            type="text"
            value={editRealname}
            onChange={(e) => setEditRealname(e.target.value)}
            className="w-full rounded bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
          />
        </div>

        {/* Avatar URL */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-400">
            Avatar URL
            {!supportsMetadata && (
              <span className="ml-1 text-gray-500">(not supported by server)</span>
            )}
          </label>
          <input
            type="text"
            value={editAvatarUrl}
            onChange={(e) => setEditAvatarUrl(e.target.value)}
            placeholder="https://example.com/avatar.png"
            disabled={!supportsMetadata}
            className="w-full rounded bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500 disabled:opacity-50"
          />
        </div>

        {/* Away status */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-gray-400">Status</label>
            <button
              onClick={() => setIsAway(!isAway)}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                isAway
                  ? 'bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30'
                  : 'bg-green-600/20 text-green-400 hover:bg-green-600/30'
              }`}
            >
              {isAway ? 'Away' : 'Online'}
            </button>
          </div>
          {isAway && (
            <input
              type="text"
              value={editAwayMessage}
              onChange={(e) => setEditAwayMessage(e.target.value)}
              placeholder="Away message (e.g. Be right back)"
              className="w-full rounded bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
            />
          )}
        </div>

        {error && (
          <div className="rounded bg-red-900/50 px-2 py-1.5 text-xs text-red-300">{error}</div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
