import { useEffect, useCallback, Component, type ErrorInfo, type ReactNode } from 'react'
import { AppLayout } from './components/layout/AppLayout'
import { ToastContainer } from './components/common/ToastContainer'
import { useIRCEvents } from './hooks/useIRC'
import { useUpdates } from './hooks/useUpdates'
import { useServerStore } from './stores/serverStore'
import { useChannelStore } from './stores/channelStore'
import type { UserMetadata } from '@shared/types/metadata'
import { initMutePersistence } from './stores/mutePersistence'
import { useUIStore } from './stores/uiStore'

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; componentStack: string | null }
> {
  state: { error: Error | null; componentStack: string | null } = {
    error: null,
    componentStack: null
  }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  // The JS stack of a render error points into React's own scheduler; the
  // component stack is the part that says which of our components did it.
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 40,
            color: '#ff6b6b',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            overflow: 'auto'
          }}
        >
          <h1>Render Error</h1>
          <pre>{this.state.error.message}</pre>
          {this.state.componentStack && (
            <pre style={{ color: '#ffb86b' }}>In components:{this.state.componentStack}</pre>
          )}
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

  // A new version, once there is one to restart into
  useUpdates()

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

      /*
       * How far each conversation was read, before anything is connected.
       *
       * Also loaded when a network connects, which is late: a bouncer replays
       * what you missed the moment it welcomes you, and a badge decides
       * whether a line is new by comparing it against a marker that has to be
       * there already. On the first connection after a launch it was not.
       */
      for (const server of servers) {
        window.switchboard
          .invoke('read-marker:get-all', server.id)
          .then((markers) => {
            if (markers && Object.keys(markers).length > 0) {
              useChannelStore.getState().setReadMarkers(server.id, markers)
            }
          })
          .catch(() => {})
      }

      if (servers.length > 0 && !useServerStore.getState().activeServerId) {
        useServerStore.getState().setActiveServer(servers[0].id)
      }
      // Seed avatar store from saved server configs
      for (const server of servers) {
        if (!server.nick) continue
        const saved = {
          ...(server.avatarUrl ? { avatar: server.avatarUrl } : {}),
          ...server.profile
        }
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
