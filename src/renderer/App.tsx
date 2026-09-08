import { useEffect, useCallback, Component, type ReactNode } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ToastContainer } from './components/common/ToastContainer'
import { useIRCEvents } from './hooks/useIRC'
import { useServerStore } from './stores/serverStore'
import { initMutePersistence } from './stores/mutePersistence'
import { useUIStore } from './stores/uiStore'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#ff6b6b', fontFamily: 'monospace' }}>
          <h1>Render Error</h1>
          <pre>{this.state.error.message}</pre>
          <pre>{this.state.error.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

function AppInner() {
  // Set up all IPC event listeners
  useIRCEvents()

  // Load servers on mount
  useEffect(() => {
    if (!window.switchboard) {
      console.error('window.switchboard is not defined — preload script may have failed')
      return
    }
    window.switchboard.invoke('server:list').then((servers) => {
      useServerStore.getState().setServers(servers)
      if (servers.length > 0 && !useServerStore.getState().activeServerId) {
        useServerStore.getState().setActiveServer(servers[0].id)
      }
      // Seed avatar store from saved server configs
      for (const server of servers) {
        if (!server.nick) continue
        const saved = { ...(server.avatarUrl ? { avatar: server.avatarUrl } : {}), ...server.profile }
        for (const [key, value] of Object.entries(saved)) {
          if (value) useServerStore.getState().setUserMetadata(server.id, server.nick, key, value)
        }
      }
    }).catch((err) => {
      console.error('Failed to load servers:', err)
    })

    initMutePersistence().catch((err) => {
      console.error('Failed to restore mutes:', err)
    })
  }, [])

  // Global keyboard shortcuts
  const handleGlobalKeyDown = useCallback((e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey

    if (isMod && e.key === 'k') {
      e.preventDefault()
      useUIStore.getState().openModal('quick-switcher')
    } else if (isMod && e.key === 'f') {
      e.preventDefault()
      useUIStore.getState().openModal('search')
    } else if (isMod && e.key === ',') {
      e.preventDefault()
      useUIStore.getState().openModal('settings')
    } else if (isMod && e.key === 'n') {
      e.preventDefault()
      useUIStore.getState().openModal('add-server')
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleGlobalKeyDown])

  return (
    <>
      <AppLayout />
      <ToastContainer />
    </>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}
