import { create } from 'zustand'

export type Theme =
  | 'catppuccin-mocha'
  | 'catppuccin-latte'
  | 'catppuccin-frappe'
  | 'catppuccin-macchiato'
  | 'dracula'
  | 'nord'
  | 'gruvbox'
  | 'one-dark'
  | 'rose-pine'
  | 'solarized-dark'
  | 'tokyo-night'
  | 'kanagawa'
  | 'discord'

type Modal = 'settings' | 'add-server' | 'edit-server' | 'whois' | 'search' | 'quick-switcher' | null

export interface WhoisData {
  nick: string
  user?: string
  host?: string
  realname?: string
  server?: string
  serverInfo?: string
  account?: string
  channels?: string
  idle?: string
  signon?: string
  isOperator?: boolean
  isBot?: boolean
  [key: string]: string | boolean | undefined
}

type TimeFormat = '12h' | '24h'

export interface Toast {
  id: string
  title: string
  body: string
  action?: { label: string; serverId: string; channel: string }
}

interface UIState {
  theme: Theme
  settingsOpen: boolean
  activeModal: Modal
  showUserList: boolean
  compactMode: boolean
  fontSize: number
  timeFormat: TimeFormat
  notificationsEnabled: boolean
  notificationSound: boolean
  whoisData: WhoisData | null
  editServerId: string | null
  dmMode: boolean
  /** Nick being fetched for the hover popup (suppresses modal) */
  popupWhoisNick: string | null
  popupWhoisData: WhoisData | null
  toasts: Toast[]

  // Actions
  setTheme: (theme: Theme) => void
  openModal: (modal: Modal) => void
  closeModal: () => void
  toggleUserList: () => void
  setDmMode: (dm: boolean) => void
  setCompactMode: (compact: boolean) => void
  setFontSize: (size: number) => void
  setTimeFormat: (format: TimeFormat) => void
  setNotificationsEnabled: (enabled: boolean) => void
  setNotificationSound: (enabled: boolean) => void
  showWhois: (data: WhoisData) => void
  setEditServerId: (id: string | null) => void
  setPopupWhoisNick: (nick: string | null) => void
  setPopupWhoisData: (data: WhoisData | null) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

const savedTheme = (localStorage.getItem('switchboard-theme') as Theme) || 'catppuccin-mocha'
const savedFontSize = parseInt(localStorage.getItem('switchboard-font-size') || '14', 10)
const savedTimeFormat = (localStorage.getItem('switchboard-time-format') || '12h') as TimeFormat
const savedCompactMode = localStorage.getItem('switchboard-compact-mode') === 'true'

function applyThemeToDocument(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/** Paint immediately from what this machine last used, so there is no flash */
applyThemeToDocument(savedTheme)
document.documentElement.style.setProperty('--chat-font-size', `${savedFontSize}px`)

export const useUIStore = create<UIState>((set) => ({
  theme: savedTheme,
  settingsOpen: false,
  activeModal: null,
  showUserList: true,
  compactMode: savedCompactMode,
  fontSize: savedFontSize,
  timeFormat: savedTimeFormat,
  notificationsEnabled: true,
  notificationSound: true,
  whoisData: null,
  editServerId: null,
  dmMode: false,
  popupWhoisNick: null,
  popupWhoisData: null,
  toasts: [],

  setTheme: (theme) => {
    applyThemeToDocument(theme)
    // Locally for the next paint, and in the shared settings so the phone
    // picks up the same choice — the two clients are one product, and a
    // different palette on each is the most visible way to look like two.
    localStorage.setItem('switchboard-theme', theme)
    void window.switchboard.invoke('settings:set', 'theme', theme)
    set({ theme })
  },

  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null, whoisData: null, editServerId: null }),
  toggleUserList: () => set((state) => ({ showUserList: !state.showUserList })),
  setCompactMode: (compact) => {
    localStorage.setItem('switchboard-compact-mode', String(compact))
    set({ compactMode: compact })
  },
  setFontSize: (size) => {
    document.documentElement.style.setProperty('--chat-font-size', `${size}px`)
    localStorage.setItem('switchboard-font-size', String(size))
    set({ fontSize: size })
  },
  setTimeFormat: (format) => {
    localStorage.setItem('switchboard-time-format', format)
    set({ timeFormat: format })
  },
  setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
  setNotificationSound: (enabled) => set({ notificationSound: enabled }),
  showWhois: (data) => set({ activeModal: 'whois', whoisData: data }),
  setEditServerId: (id) => set({ editServerId: id, activeModal: id ? 'edit-server' : null }),
  setDmMode: (dm) => set({ dmMode: dm }),
  setPopupWhoisNick: (nick) => set(nick ? { popupWhoisNick: nick, popupWhoisData: null } : { popupWhoisNick: null }),
  setPopupWhoisData: (data) => set({ popupWhoisData: data }),
  addToast: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      useUIStore.getState().removeToast(id)
    }, 8000)
  },
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}))

/**
 * Adopt a theme chosen on another device.
 *
 * The shared setting is the agreed answer; localStorage is only this machine's
 * cache of it, so it is read first for speed and corrected here.
 */
export async function syncThemeFromSettings(): Promise<void> {
  const shared = await window.switchboard.invoke('settings:get', 'theme')
  if (typeof shared !== 'string') {
    // Nothing shared yet — publish what this machine is using
    void window.switchboard.invoke('settings:set', 'theme', useUIStore.getState().theme)
    return
  }
  if (shared === useUIStore.getState().theme) return
  applyThemeToDocument(shared as Theme)
  localStorage.setItem('switchboard-theme', shared)
  useUIStore.setState({ theme: shared as Theme })
}
