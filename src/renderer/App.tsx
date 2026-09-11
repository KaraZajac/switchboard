import { useEffect, useCallback, Component, type ReactNode } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ToastContainer } from './components/common/ToastContainer'
import { useIRCEvents } from './hooks/useIRC'
import { useServerStore } from './stores/serverStore'
import type { UserMetadata } from '@shared/types/metadata'
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

  /**
   * Read the stored servers into the window.
   *
   * On mount, and again whenever they change somewhere else — a paired phone
   * editing them, or an adopted vault replacing the list. Re-reading rather
   * than applying a diff keeps one description of the servers, and it is the
   * stored one.
   */
  const loadServers = useCallback(() => {
    return window.switchboard.invoke('server:list').then((servers) => {
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
    })
  }, [])

  // Load servers on mount
  useEffect(() => {
    if (!window.switchboard) {
      console.error('window.switchboard is not defined — preload script may have failed')
      return
    }
    loadServers().catch((err) => {
      console.error('Failed to load servers:', err)
    })

    // The profile you carry everywhere, which each network follows unless it
    // has been given something different.
    window.switchboard
      .invoke('settings:get', 'profile')
      .then((value) => {
        if (value && typeof value === 'object') {
          useServerStore.getState().setGlobalProfile(value as UserMetadata)
        }
      })
      .catch((err) => console.error('Failed to load your profile:', err))

    // Words that ring the same bell your nick does
    window.switchboard
      .invoke('settings:get', 'highlights')
      .then((value) => {
        if (Array.isArray(value)) useServerStore.getState().setHighlightWords(value as string[])
      })
      .catch((err) => console.error('Failed to load your highlight words:', err))

    const off = window.switchboard.on('servers:changed', () => {
      loadServers().catch((err) => {
        console.error('Failed to reload servers:', err)
      })
    })

    initMutePersistence().catch((err) => {
      console.error('Failed to restore mutes:', err)
    })

    return off
  }, [loadServers])

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
