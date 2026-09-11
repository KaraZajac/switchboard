import { useState, useEffect, useMemo, useCallback } from 'react'
import { Modal } from '../common/Modal'
import { useUIStore } from '../../stores/uiStore'
import { useServerStore } from '../../stores/serverStore'
import { useChannelStore } from '../../stores/channelStore'
import { useUserStore } from '../../stores/userStore'
import { maskListsFor, maskToSet, type MaskEntry } from '@shared/masklists'
import { channelModesFor, modeChange, type ChannelMode } from '@shared/chanmodes'
import { canModerate } from '@shared/powers'

/**
 * A channel's settings, and the lists it keeps.
 *
 * We shipped the ability to ban somebody with nowhere to see who is banned —
 * so a ban could be set and never found again, and a mask that matched nothing
 * looked exactly like one that worked.
 *
 * Which lists exist is the network's answer, read off CHANMODES, so a server
 * without `+e` gets no empty tab for it and one with a mode nobody has heard
 * of still gets a place to look. Lifting an entry is offered only where you
 * could actually do it — the same rule the member menu uses, for the same
 * reason.
 */
export function ChannelLists() {
  const closeModal = useUIStore((s) => s.closeModal)
  const activeServerId = useServerStore((s) => s.activeServerId)
  const isupport = useServerStore((s) => s.isupport)
  const currentNicks = useServerStore((s) => s.currentNick)
  const activeChannels = useChannelStore((s) => s.activeChannel)
  const usersByChannel = useUserStore((s) => s.users)

  const serverId = activeServerId ?? ''
  const channel = serverId ? activeChannels[serverId] ?? '' : ''
  const tokens = serverId ? isupport[serverId] ?? {} : {}
  const myNick = serverId ? currentNicks[serverId] ?? '' : ''

  const lists = useMemo(
    () => maskListsFor(tokens.CHANMODES, tokens.PREFIX),
    [tokens.CHANMODES, tokens.PREFIX]
  )

  const [tab, setTab] = useState<'settings' | 'lists'>('settings')
  const [mode, setMode] = useState(() => lists[0]?.mode ?? 'b')
  const [entries, setEntries] = useState<MaskEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  /**
   * Whether you could change this list at all.
   *
   * Half-operator upwards on every network that has the rank — the same test
   * the member menu applies before offering a kick. Everyone can *look*: a ban
   * list is not a secret, and refusing to show it would be the old bug wearing
   * a different hat.
   */
  const canChange = useMemo(() => {
    const users = usersByChannel[`${serverId}:${channel.toLowerCase()}`] ?? []
    const me = users.find((u) => u.nick.toLowerCase() === myNick.toLowerCase())
    return canModerate(tokens.PREFIX, (me?.prefixes ?? []).join(''))
  }, [tokens.PREFIX, usersByChannel, serverId, channel, myNick])

  const list = lists.find((l) => l.mode === mode) ?? lists[0]

  const load = useCallback(
    async (which: string) => {
      if (!serverId || !channel) return
      setLoading(true)
      setError(null)
      const known = await window.switchboard.invoke('masklist:fetch', serverId, channel, which)
      setEntries(known)
      // The server answers a line at a time; `irc:masklist` finishes the job.
      setTimeout(() => setLoading(false), 1500)
    },
    [serverId, channel]
  )

  useEffect(() => {
    void load(mode)
  }, [mode, load])

  // The whole list arrives as one event when the server finishes sending it
  useEffect(() => {
    const off = window.switchboard.on('irc:masklist', (data) => {
      const reply = data as { serverId: string; channel: string; mode: string; entries: MaskEntry[] }
      if (reply.serverId !== serverId) return
      if (reply.channel.toLowerCase() !== channel.toLowerCase()) return
      if (reply.mode !== mode) return
      setEntries(reply.entries)
      setLoading(false)
    })
    return off
  }, [serverId, channel, mode])

  const change = useCallback(
    async (mask: string, adding: boolean) => {
      setError(null)
      try {
        await window.switchboard.invoke('masklist:set', serverId, channel, mode, mask, adding)
        if (adding) setTyped('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That did not work')
      }
    },
    [serverId, channel, mode]
  )

  if (!channel || lists.length === 0) {
    return (
      <Modal title="Channel lists" onClose={closeModal} width="max-w-xl">
        <div className="p-4 text-sm text-gray-400">
          {channel
            ? 'This network does not keep any channel lists.'
            : 'Open a channel to see the lists it keeps.'}
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={channel} onClose={closeModal} width="max-w-xl">
      <div className="space-y-3 p-4">
        <div className="flex gap-1 rounded bg-gray-800 p-0.5 text-xs">
          {(['settings', 'lists'] as const).map((which) => (
            <button
              key={which}
              onClick={() => setTab(which)}
              className={`flex-1 rounded px-2 py-1 font-medium capitalize transition-colors ${
                tab === which ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {which}
            </button>
          ))}
        </div>

        {tab === 'settings' && (
          <ChannelSettings serverId={serverId} channel={channel} canChange={canChange} />
        )}

        {tab === 'lists' && (
        <div className="space-y-3">
        {/* Only the lists this network actually keeps */}
        <div className="flex gap-1 rounded bg-gray-800 p-0.5 text-xs">
          {lists.map((one) => (
            <button
              key={one.mode}
              onClick={() => setMode(one.mode)}
              className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${
                mode === one.mode ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {one.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500">{list?.hint}</p>

        <div className="max-h-72 overflow-y-auto rounded ring-1 ring-gray-800">
          {entries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-gray-500">
              {loading ? 'Asking the server…' : `No ${list?.entry ?? 'entries'} here.`}
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.mask}
                className="flex items-center gap-2 border-b border-gray-800 px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm text-gray-100">{entry.mask}</div>
                  {(entry.setBy || entry.setAt) && (
                    <div className="truncate text-xs text-gray-500">
                      {entry.setBy ? `by ${entry.setBy.split('!')[0]}` : ''}
                      {entry.setBy && entry.setAt ? ' · ' : ''}
                      {entry.setAt ? new Date(entry.setAt * 1000).toLocaleString() : ''}
                    </div>
                  )}
                </div>
                {/* Offered only where it would work — see `actionsFor` */}
                {canChange && (
                  <button
                    onClick={() => void change(entry.mask, false)}
                    className="shrink-0 rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-red-300"
                  >
                    Lift
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {canChange ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed.trim()) void change(maskToSet(typed), true)
              }}
              placeholder={`Add a ${list?.entry ?? 'mask'} — a nick or a mask`}
              className="flex-1 rounded bg-gray-800 px-2.5 py-1.5 font-mono text-sm text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500"
            />
            <button
              onClick={() => typed.trim() && void change(maskToSet(typed), true)}
              disabled={!typed.trim()}
              className="rounded bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            You would need to be an operator here to change this.
          </p>
        )}

        {/* What a bare nick will actually become, before it is sent */}
        {canChange && typed.trim() && maskToSet(typed) !== typed.trim() && (
          <p className="font-mono text-xs text-gray-500">Will be sent as {maskToSet(typed)}</p>
        )}

        {error && (
          <div className="rounded bg-red-900/50 px-2 py-1.5 text-xs text-red-300">{error}</div>
        )}
        </div>
        )}
      </div>
    </Modal>
  )
}

/**
 * What this channel is set to.
 *
 * `CHANMODES` has been parsed since the beginning and there has never been
 * anywhere to see the answer, let alone change one — the only way to make a
 * channel invite-only was `/mode #channel +i`, which means knowing that `i` is
 * the letter.
 *
 * Read-only where you could not change it. A setting is not a secret, and
 * knowing that a channel is moderated explains why your message went nowhere.
 */
function ChannelSettings({
  serverId,
  channel,
  canChange
}: {
  serverId: string
  channel: string
  canChange: boolean
}) {
  const isupport = useServerStore((s) => s.isupport)
  const tokens = isupport[serverId] ?? {}

  /**
   * What the connection has tracked, rather than a copy kept here.
   *
   * The main process already applies every MODE line to the channel it names;
   * a second implementation in the renderer would be a second thing to get
   * wrong. Refetched whenever a MODE arrives, which includes the reply to the
   * query this fetch sends.
   */
  const [set, setSet] = useState<Record<string, string | true>>({})

  useEffect(() => {
    const load = () => {
      void window.switchboard.invoke('channel:modes', serverId, channel).then(setSet)
    }
    load()

    const off = window.switchboard.on('irc:mode', (data) => {
      const change = data as { serverId: string; channel: string }
      if (change.serverId !== serverId) return
      if (change.channel.toLowerCase() !== channel.toLowerCase()) return
      load()
    })
    return off
  }, [serverId, channel])

  const modes = useMemo(
    () => channelModesFor(tokens.CHANMODES, tokens.PREFIX),
    [tokens.CHANMODES, tokens.PREFIX]
  )
  // What is typed into a value box before it is applied, so a half-written
  // password is not sent a character at a time.
  const [typed, setTyped] = useState<Record<string, string>>({})

  const apply = (mode: ChannelMode, on: boolean, value?: string): void => {
    const args = modeChange(mode, on, value ?? typed[mode.letter] ?? String(set[mode.letter] ?? ''))
    if (!args) return
    void window.switchboard.invoke('channel:set-mode', serverId, channel, args)
  }

  if (modes.length === 0) {
    return <p className="p-2 text-sm text-gray-500">This network states no channel modes.</p>
  }

  return (
    <div className="space-y-1">
      {modes.map((mode) => {
        const current = set[mode.letter]
        const on = current !== undefined
        const value = typed[mode.letter] ?? (typeof current === 'string' ? current : '')

        return (
          <div key={mode.letter} className="rounded bg-gray-900/60 px-3 py-2 ring-1 ring-gray-800">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-100">
                  {mode.label} <span className="font-mono text-xs text-gray-500">+{mode.letter}</span>
                </div>
                <div className="text-xs text-gray-500">{mode.hint}</div>
              </div>
              <input
                type="checkbox"
                checked={on}
                // A mode that takes a value cannot be turned *on* by a
                // checkbox — there would be nothing to set it to — so the box
                // only turns those off, and the Set button turns them on.
                disabled={!canChange || (mode.kind !== 'flag' && !on)}
                onChange={(e) => apply(mode, e.target.checked)}
                className="h-4 w-4 shrink-0 accent-indigo-500 disabled:opacity-40"
              />
            </div>

            {/*
              Always, not only once it is set: a mode that takes a value can
              only be turned on by giving one, so hiding the box until it was
              already on made setting a limit impossible.
            */}
            {mode.kind !== 'flag' && (canChange || on) && (
              <div className="mt-1.5 flex gap-2">
                <input
                  type="text"
                  value={value}
                  disabled={!canChange}
                  onChange={(e) => setTyped((t) => ({ ...t, [mode.letter]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') apply(mode, true)
                  }}
                  placeholder={mode.placeholder}
                  className="flex-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-100 outline-none ring-1 ring-gray-700 focus:ring-indigo-500 disabled:opacity-50"
                />
                {canChange && (
                  <button
                    onClick={() => apply(mode, true)}
                    className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 hover:bg-gray-600"
                  >
                    Set
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {!canChange && (
        <p className="pt-1 text-xs text-gray-500">
          You would need to be an operator here to change these.
        </p>
      )}
    </div>
  )
}
