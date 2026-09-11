import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { resolveProfile, hasOverride, overrideFrom } from '@shared/profile'
import { hasMetadata } from '@shared/metadata'
import { useServerStore } from '../../stores/serverStore'
import {
  METADATA_FIELDS,
  METADATA_KEYS,
  displayNameFor,
  metadataColor,
  type UserMetadata
} from '@shared/types/metadata'

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
  const userMetadata = useServerStore((s) => s.userMetadata)
  const allCapabilities = useServerStore((s) => s.capabilities)
  const awayMessages = useServerStore((s) => s.awayMessage)

  // Derive values in the component body
  const currentNick = activeServerId ? currentNicks[activeServerId] ?? null : null
  const server = servers.find((sv) => sv.id === activeServerId)
  const connectionStatus = activeServerId ? connectionStatuses[activeServerId] ?? 'disconnected' : 'disconnected'
  const myMetadata: UserMetadata =
    activeServerId && currentNick
      ? userMetadata[`${activeServerId}:${currentNick.toLowerCase()}`] ?? {}
      : {}
  const avatarUrl = myMetadata.avatar ?? null
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

  const displayNick = displayNameFor(currentNick, myMetadata)
  const supportsSetname = capabilities.includes('setname')
  const supportsMetadata = hasMetadata(capabilities)

  return (
    <div className="relative bg-gray-950">
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
            {isAway ? awayMessage : myMetadata.status || 'Online'}
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
          nick={currentNick}
          displayNick={displayNick}
          username={server?.username ?? ''}
          realname={server?.realname ?? ''}
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
  /** The real one, which is what a NICK changes and what metadata is keyed by */
  nick: string
  /** What the person is called here, for the header */
  displayNick: string
  username: string
  realname: string
  awayMessage: string | null
  supportsSetname: boolean
  supportsMetadata: boolean
  onClose: () => void
  popupRef: React.RefObject<HTMLDivElement | null>
}

function ProfileEditPopup({
  serverId,
  nick,
  displayNick,
  username,
  realname,
  awayMessage,
  supportsSetname,
  supportsMetadata,
  onClose,
  popupRef
}: ProfileEditPopupProps) {
  const servers = useServerStore((s) => s.servers)
  const serverName = servers.find((sv) => sv.id === serverId)?.name ?? ''
  const serverProfile = servers.find((sv) => sv.id === serverId)?.profile
  const globalProfile = useServerStore((s) => s.globalProfile)
  const overridden = hasOverride(serverProfile)

  /**
   * Which profile the fields below are showing.
   *
   * Starts on whichever one this network is actually using, so opening the
   * editor on a network you have given something different does not look like
   * your profile has changed.
   */
  const [profileScope, setProfileScope] = useState<'global' | 'server'>(
    overridden ? 'server' : 'global'
  )

  const [editNick, setEditNick] = useState(nick)
  const [editRealname, setEditRealname] = useState(realname)
  const [editMetadata, setEditMetadata] = useState<UserMetadata>(
    overridden ? resolveProfile(globalProfile, serverProfile) : globalProfile
  )

  // Swapping between them shows what that one actually says
  const baseline = useMemo(
    () =>
      profileScope === 'global' ? globalProfile : resolveProfile(globalProfile, serverProfile),
    [profileScope, globalProfile, serverProfile]
  )
  useEffect(() => {
    setEditMetadata(baseline)
  }, [baseline])
  const [editAwayMessage, setEditAwayMessage] = useState(awayMessage ?? '')
  const [isAway, setIsAway] = useState(awayMessage !== null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * What this will call you once it is saved.
   *
   * A display name if you have one, otherwise the nick. The header used to
   * show `editNick`, which is the nick — so the field labelled "Display name"
   * changed nothing you could see until the server echoed it back.
   */
  const preview =
    (editMetadata['display-name'] ?? '').trim() || editNick.trim() || displayNick || nick

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

      // Whichever keys changed against the profile being edited — not against
      // what the server echoed. Editing the global from a network that has one
      // of its own is comparing two different profiles, which showed up as
      // saving fields nobody touched and skipping ones they did.
      const changed = METADATA_KEYS.filter(
        (key) => (editMetadata[key] ?? '').trim() !== (baseline[key] ?? '').trim()
      )

      // Saved whatever the network can carry: a profile is a thing about you,
      // and a server without `draft/metadata-2` is a reason nobody here sees
      // it, not a reason to throw it away.
      //
      // `global` is the one you carry; a serverId is this network only.
      const scope = profileScope === 'global' ? 'global' : serverId
      for (const key of changed) {
        const value = (editMetadata[key] ?? '').trim()
        // Only echo it into this network's view when it is what this network
        // is now saying — editing the global changes nothing here if this
        // network has been given something of its own for that field.
        if (profileScope === 'server' || (serverProfile?.[key] ?? '') === '') {
          useServerStore.getState().setUserMetadata(serverId, nick, key, value)
        }
        await window.switchboard.invoke('metadata:set', scope, key, value)
      }

      // The store's copy, so the editor is not comparing the next edit against
      // what the profile said before this one.
      if (changed.length > 0) {
        if (profileScope === 'global') {
          const next: UserMetadata = { ...globalProfile }
          for (const key of changed) {
            const value = (editMetadata[key] ?? '').trim()
            if (value) next[key] = value
            else delete next[key]
          }
          useServerStore.getState().setGlobalProfile(next)
        } else {
          const typed: UserMetadata = { ...resolveProfile(globalProfile, serverProfile) }
          for (const key of changed) typed[key] = (editMetadata[key] ?? '').trim()
          useServerStore
            .getState()
            .updateServer(serverId, { profile: overrideFrom(globalProfile, typed) ?? {} })
        }
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
  }, [serverId, profileScope, baseline, globalProfile, serverProfile, nick, editNick, realname, editRealname, editMetadata, awayMessage, isAway, editAwayMessage, supportsSetname, onClose])

  return (
    <div
      ref={popupRef}
      className="absolute bottom-full left-0 right-0 z-50 mb-1 rounded-lg bg-gray-900 p-4 shadow-xl ring-1 ring-gray-700"
    >
      <h3 className="mb-3 text-sm font-semibold text-gray-100">Edit Profile</h3>

      <div className="space-y-3">
        {/* Avatar preview, showing what you are typing rather than what is saved */}
        <div className="flex items-center gap-3">
          {editMetadata.avatar ? (
            <AvatarImg src={editMetadata.avatar} nick={preview} size="h-12 w-12" textSize="text-lg" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500 text-lg font-medium text-white">
              {preview.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-gray-100">{preview}</div>
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

        {/* draft/metadata-2 profile */}
        <div className="space-y-2 border-t border-gray-800 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Profile
            </span>
            {/*
              Saved either way. The fields used to be disabled here, which
              meant a network without metadata could not be used to edit the
              profile you carry everywhere — and that profile is not this
              network's business.
            */}
            {!supportsMetadata && (
              <span className="text-xs text-gray-500">nobody on this network will see it</span>
            )}
          </div>

          {/*
            Which profile is being edited. IRC has no global anything — every
            network is told separately — so "everywhere" is this client's own
            idea, kept with your config and published to each network as you
            connect. A network only stops following it where you say so here.
          */}
          <div className="flex gap-1 rounded bg-gray-800 p-0.5 text-xs">
            {(['global', 'server'] as const).map((which) => (
              <button
                key={which}
                onClick={() => setProfileScope(which)}
                className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${
                  profileScope === which
                    ? 'bg-gray-600 text-white'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                {which === 'global' ? 'Everywhere' : `On ${serverName || 'this network'}`}
              </button>
            ))}
          </div>

          <p className="text-xs text-gray-500">
            {profileScope === 'global'
              ? 'Who you are on every network that has not been given something different.'
              : overridden
                ? `Only on ${serverName || 'this network'}. Anything left blank here is cleared on this network rather than falling back.`
                : `This network follows your profile. Change something here and only this network changes.`}
          </p>

          {/*
            The way out of having a profile of your own here. Without it the
            only way back is typing your global values in field by field until
            the difference disappears, which is not something anyone would
            guess and gets a field wrong every time.
          */}
          {profileScope === 'server' && overridden && (
            <button
              onClick={async () => {
                await window.switchboard.invoke('metadata:reset', serverId)
                useServerStore.getState().updateServer(serverId, { profile: {} })
                setProfileScope('global')
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300"
            >
              Use my profile here instead
            </button>
          )}

          {METADATA_FIELDS.map((field) => (
            <div key={field.key}>
              <label className="mb-1 flex items-baseline gap-2 text-xs font-medium text-gray-400">
                {field.label}
                {field.hint && <span className="text-gray-500">{field.hint}</span>}
              </label>
              <div className="flex items-center gap-2">
                {field.key === 'color' && metadataColor(editMetadata.color) && (
                  <span
                    className="h-4 w-4 shrink-0 rounded-full ring-1 ring-gray-700"
                    style={{ backgroundColor: metadataColor(editMetadata.color) as string }}
                  />
                )}
                <input
                  type="text"
                  value={editMetadata[field.key] ?? ''}
                  onChange={(e) =>
                    setEditMetadata((current) => ({ ...current, [field.key]: e.target.value }))
                  }
                  placeholder={field.placeholder}
                  className="w-full rounded bg-gray-800 px-2.5 py-1.5 text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Away status */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-gray-400">Availability</label>
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
