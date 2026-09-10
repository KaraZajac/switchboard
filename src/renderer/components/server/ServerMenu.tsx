import { useServerStore } from '../../stores/serverStore'
import { useUIStore } from '../../stores/uiStore'
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu'

interface ServerMenuProps {
  serverId: string
  x: number
  y: number
  onClose: () => void
  /** Extra entries shown above the connection actions (e.g. Browse Channels) */
  extraItems?: ContextMenuItem[]
}

/**
 * The actions for one server — shared by the rail's right-click menu and the
 * channel sidebar's header dropdown, so both offer the same things.
 */
export function ServerMenu({ serverId, x, y, onClose, extraItems = [] }: ServerMenuProps) {
  const store = useServerStore.getState()
  const isMuted = store.mutedServers[serverId] !== undefined
  const status = store.connectionStatus[serverId] || 'disconnected'

  const items: ContextMenuItem[] = [
    ...extraItems,
    status === 'connected'
      ? {
          label: 'Disconnect',
          onClick: () => window.switchboard.invoke('server:disconnect', serverId)
        }
      : {
          label: status === 'connecting' ? 'Reconnect' : 'Connect',
          onClick: () => {
            store.setConnectionStatus(serverId, 'connecting')
            window.switchboard.invoke('server:connect', serverId)
          }
        },
    {
      label: 'Account…',
      onClick: () => useUIStore.getState().showAccount(serverId)
    },
    { label: 'Server Settings', onClick: () => useUIStore.getState().setEditServerId(serverId) },
    { label: '', onClick: () => {}, separator: true },
    ...(isMuted
      ? [{ label: 'Unmute Server', onClick: () => store.unmuteServer(serverId) }]
      : [
          {
            label: 'Mute for 15 minutes',
            onClick: () => store.muteServer(serverId, 15 * 60 * 1000)
          },
          { label: 'Mute for 1 hour', onClick: () => store.muteServer(serverId, 60 * 60 * 1000) },
          {
            label: 'Mute for 8 hours',
            onClick: () => store.muteServer(serverId, 8 * 60 * 60 * 1000)
          },
          {
            label: 'Mute for 24 hours',
            onClick: () => store.muteServer(serverId, 24 * 60 * 60 * 1000)
          },
          { label: 'Mute until turned back on', onClick: () => store.muteServer(serverId) }
        ])
  ]

  return <ContextMenu x={x} y={y} onClose={onClose} items={items} />
}
