import { useEffect } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { useIRCEvents } from './hooks/useIRC'
import { useServerStore } from './stores/serverStore'

export function App() {
  // Set up all IPC event listeners
  useIRCEvents()

  // Load servers on mount
  useEffect(() => {
    window.switchboard.invoke('server:list').then((servers) => {
      useServerStore.getState().setServers(servers)
      if (servers.length > 0 && !useServerStore.getState().activeServerId) {
        useServerStore.getState().setActiveServer(servers[0].id)
      }
    })
  }, [])

  return <AppLayout />
}
