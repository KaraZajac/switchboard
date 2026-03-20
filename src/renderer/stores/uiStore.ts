import { create } from 'zustand'

type Theme = 'dark' | 'light'
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

  // Actions
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
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
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  settingsOpen: false,
  activeModal: null,
  showUserList: true,
  compactMode: false,
  fontSize: 14,
  timeFormat: '12h' as TimeFormat,
  notificationsEnabled: true,
  notificationSound: true,
  whoisData: null,
  editServerId: null,
  dmMode: false,
  popupWhoisNick: null,
  popupWhoisData: null,

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    set({ theme })
  },

  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark'
      document.documentElement.setAttribute('data-theme', next)
      return { theme: next }
    }),

  openModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null, whoisData: null, editServerId: null }),
  toggleUserList: () => set((state) => ({ showUserList: !state.showUserList })),
  setCompactMode: (compact) => set({ compactMode: compact }),
  setFontSize: (size) => {
    document.documentElement.style.setProperty('--chat-font-size', `${size}px`)
    set({ fontSize: size })
  },
  setTimeFormat: (format) => set({ timeFormat: format }),
  setNotificationsEnabled: (enabled) => set({ notificationsEnabled: enabled }),
  setNotificationSound: (enabled) => set({ notificationSound: enabled }),
  showWhois: (data) => set({ activeModal: 'whois', whoisData: data }),
  setEditServerId: (id) => set({ editServerId: id, activeModal: id ? 'edit-server' : null }),
  setDmMode: (dm) => set({ dmMode: dm }),
  setPopupWhoisNick: (nick) => set(nick ? { popupWhoisNick: nick, popupWhoisData: null } : { popupWhoisNick: null }),
  setPopupWhoisData: (data) => set({ popupWhoisData: data })
}))
