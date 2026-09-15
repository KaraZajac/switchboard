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

type Modal =
  | 'settings'
  | 'add-server'
  | 'edit-server'
  | 'whois'
  | 'search'
  | 'quick-switcher'
  | 'account'
  | 'channel-lists'
  | null

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

/**
 * What a toast's button does.
 *
 * `join` is an invitation; `account` is a network asking you to log in — the
 * one thing NickServ says that is worth interrupting for, and the only way a
 * user who has never heard of NickServ finds out that they should.
 */
export type ToastAction =
  | { kind: 'join'; label: string; serverId: string; channel: string }
  | { kind: 'account'; label: string; serverId: string }
  /** Trust this one certificate and dial again — see `@shared/certificate` */
  | { kind: 'trust'; label: string; serverId: string; fingerprint: string }

export interface Toast {
  id: string
  title: string
  body: string
  action?: ToastAction
  /** A line under the body in a typeface it can be read from — a fingerprint, a code */
  detail?: string
  /**
   * Whether it goes away on its own.
   *
   * A refusal is about something you just tried and can be let go of. Being
   * asked to log in is about something still undone, and a message that
   * disappears after eight seconds is one the user will not have finished
   * reading, let alone acted on.
   */
  sticky?: boolean
}

interface UIState {
  theme: Theme
  settingsOpen: boolean
  activeModal: Modal
  /** Which network the account panel is about */
  accountServerId: string | null
  showUserList: boolean
  compactMode: boolean
  fontSize: number
  timeFormat: TimeFormat
  notificationsEnabled: boolean
  notificationSound: boolean
  /** Joins, parts and quits as lines in the conversation — a mirror of the shared setting */
  showJoinsParts: boolean
  whoisData: WhoisData | null
  editServerId: string | null
  dmMode: boolean
  /**
   * The conversation Messages was last left on.
   *
   * Switching to a network already reopens where you were on it — the active
   * channel is kept per server. Messages had no such memory, so coming back to
   * it landed on an empty pane however recently you had been reading there,
   * and flipping between a network and a conversation meant finding the
   * conversation again every time.
   */
  lastDm: { serverId: string; nick: string } | null
  /** Nick being fetched for the hover popup (suppresses modal) */
  popupWhoisNick: string | null
  popupWhoisData: WhoisData | null
  toasts: Toast[]

  // Actions
  setTheme: (theme: Theme) => void
  openModal: (modal: Modal) => void
  /** What an irc:// link said, for the add-network form to start from — see `@shared/ircurl` */
  addServerPrefill: { host: string; port: number; tls: boolean; channel: string | null } | null
  openAddServer: (prefill: { host: string; port: number; tls: boolean; channel: string | null }) => void
  showAccount: (serverId: string) => void
  closeModal: () => void
  toggleUserList: () => void
  setDmMode: (dm: boolean) => void
  rememberDm: (serverId: string, nick: string) => void
  setCompactMode: (compact: boolean) => void
  setFontSize: (size: number) => void
  setTimeFormat: (format: TimeFormat) => void
  setNotificationsEnabled: (enabled: boolean) => void
  setNotificationSound: (enabled: boolean) => void
  setShowJoinsParts: (on: boolean) => void
  showWhois: (data: WhoisData) => void
  setEditServerId: (id: string | null) => void
  setPopupWhoisNick: (nick: string | null) => void
  setPopupWhoisData: (data: WhoisData | null) => void
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToastsFor: (serverId: string) => void
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

/** Auto-dismiss timers by toast id, so a repeat can restart one. */
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()

function dismissLater(id: string): void {
  clearTimeout(dismissTimers.get(id))
  dismissTimers.set(
    id,
    setTimeout(() => useUIStore.getState().removeToast(id), 8000)
  )
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: savedTheme,
  settingsOpen: false,
  activeModal: null,
  accountServerId: null,
  showUserList: true,
  compactMode: savedCompactMode,
  fontSize: savedFontSize,
  timeFormat: savedTimeFormat,
  notificationsEnabled: true,
  notificationSound: true,
  showJoinsParts: false,
  whoisData: null,
  editServerId: null,
  dmMode: false,
  lastDm: null,
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

  openModal: (modal) => set({ activeModal: modal, addServerPrefill: null }),
  addServerPrefill: null,
  openAddServer: (prefill) => set({ activeModal: 'add-server', addServerPrefill: prefill }),
  closeModal: () =>
    set({ activeModal: null, whoisData: null, editServerId: null, accountServerId: null }),

  /** Open the account panel for one network */
  showAccount: (serverId) => set({ activeModal: 'account', accountServerId: serverId }),
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
  setShowJoinsParts: (on) => set({ showJoinsParts: on }),
  showWhois: (data) => set({ activeModal: 'whois', whoisData: data }),
  setEditServerId: (id) => set({ editServerId: id, activeModal: id ? 'edit-server' : null }),
  setDmMode: (dm) => set({ dmMode: dm }),
  rememberDm: (serverId, nick) => set({ lastDm: { serverId, nick } }),
  setPopupWhoisNick: (nick) =>
    set(nick ? { popupWhoisNick: nick, popupWhoisData: null } : { popupWhoisNick: null }),
  setPopupWhoisData: (data) => set({ popupWhoisData: data }),
  addToast: (toast) => {
    // The same news twice is one toast, not a stack. A server that refuses
    // every reconnect attempt says so every few seconds, and each refusal
    // used to add another copy until the corner of the window was nothing
    // but the one sentence. The copy already showing gets its time back
    // instead.
    const showing = get().toasts.find(
      (t) => t.title === toast.title && t.body === toast.body && t.sticky === toast.sticky
    )
    if (showing) {
      if (!showing.sticky) dismissLater(showing.id)
      return
    }

    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }))
    if (!toast.sticky) dismissLater(id)
  },
  removeToast: (id) => {
    clearTimeout(dismissTimers.get(id))
    dismissTimers.delete(id)
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  /**
   * Put away whatever this network was asking for.
   *
   * Logging in answers the question the sticky toast was asking, and a client
   * that goes on asking after you have done it is not paying attention.
   */
  removeToastsFor: (serverId) =>
    set((state) => ({
      toasts: state.toasts.filter(
        (t) => !(t.action?.kind === 'account' && t.action.serverId === serverId)
      )
    }))
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
