import { useChannelStore } from './channelStore'
import { useServerStore } from './serverStore'

const SETTINGS_KEY = 'mutes'

interface PersistedMutes {
  /** serverId -> expiry timestamp (0 = permanent) */
  servers: Record<string, number>
  /** `serverId:channel` -> expiry timestamp (0 = permanent) */
  channels: Record<string, number>
}

/**
 * Load saved mutes into the stores and keep them saved as they change.
 *
 * Mutes live in the renderer stores, which start empty on every launch, so
 * without this a muted channel comes back shouting after a restart.
 * Call once at startup.
 */
export async function initMutePersistence(): Promise<void> {
  const api = window.switchboard
  if (!api) return

  const saved = (await api
    .invoke('settings:get', SETTINGS_KEY)
    .catch(() => null)) as PersistedMutes | null

  if (saved) {
    useServerStore.getState().setMutedServers(saved.servers || {})
    useChannelStore.getState().hydrateMutes(saved.channels || {})
  }

  const current = (): string =>
    JSON.stringify({
      servers: useServerStore.getState().mutedServers,
      channels: useChannelStore.getState().mutedChannels
    })

  // Both stores fire on every update, so only write when the mutes themselves
  // changed — each write flushes the whole SQLite file to disk.
  let lastSaved = current()
  const save = (): void => {
    const next = current()
    if (next === lastSaved) return
    lastSaved = next
    api.invoke('settings:set', SETTINGS_KEY, JSON.parse(next)).catch(() => {})
  }

  useServerStore.subscribe(save)
  useChannelStore.subscribe(save)
}
