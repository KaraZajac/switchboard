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
  | 'server-log'
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
  /**
   * Take the networks a bouncer holds and make them networks here.
   *
   * Offered rather than done, because it adds rows to somebody's server list
   * and the only person who knows whether they want all of them is them.
   */
  | { kind: 'adopt-bouncer'; label: string; serverId: string }

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
  /**
   * Which network the server log is for.
   *
   * Carried rather than read from whichever network happens to be active: the
   * menu this opens from is also reachable by right-clicking a network in the
   * rail, and a log that shows a different one than the menu you opened is
   * worse than no log.
   */
  serverLogId: string | null
  dmMode: boolean
  /**
   * Whether the window is showing every line that named you, across networks.
   *
   * A mode beside [dmMode] rather than a modal or a panel, because it is the
   * same kind of thing: a view of one sort of conversation that belongs to no
   * single network, and the rail is where you go to change which of those you
   * are looking at.
   */
  mentionsMode: boolean
  /**
   * Whether Messages is showing the friend list rather than a conversation.
   *
   * Inside Messages rather than beside it on the rail, the way Discord keeps
   * Friends behind its home button: both are lists of people rather than
   * lists of places, and they are read one after the other.
   */
  friendsOpen: boolean
  /**
   * A line to go to, rather than a room to open.
   *
   * Set by anything that names a particular message — a mention, a search
   * result, a reply quote — and cleared by the conversation once it has got
   * there. Carries a time as well as an id because that is what a jump is
   * aimed by: the id says which line, the time says where to fetch around.
   */
  jumpTo: { serverId: string; channel: string; msgid: string | null; timestamp: string } | null
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
  openAddServer: (prefill: {
    host: string
    port: number
    tls: boolean
    channel: string | null
  }) => void
  showAccount: (serverId: string) => void
  closeModal: () => void
  toggleUserList: () => void
  setDmMode: (dm: boolean) => void
  setMentionsMode: (on: boolean) => void
  setFriendsOpen: (on: boolean) => void
  setJumpTo: (
    to: { serverId: string; channel: string; msgid: string | null; timestamp: string } | null
  ) => void
  rememberDm: (serverId: string, nick: string) => void
  setCompactMode: (compact: boolean) => void
  setFontSize: (size: number) => void
  setTimeFormat: (format: TimeFormat) => void
  setNotificationsEnabled: (enabled: boolean) => void
  setNotificationSound: (enabled: boolean) => void
  setShowJoinsParts: (on: boolean) => void
  showWhois: (data: WhoisData) => void
  setEditServerId: (id: string | null) => void
  openServerLog: (id: string) => void
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

/**
 * How many may be on screen at once.
 *
 * They stack upwards from the bottom right, so the fifth is where the first
 * starts leaving the top of the window — dismiss button and all.
 */
const MOST_TOASTS = 4

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
  serverLogId: null,
  dmMode: false,
  mentionsMode: false,
  friendsOpen: false,
  jumpTo: null,
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
    set({
      activeModal: null,
      whoisData: null,
      editServerId: null,
      accountServerId: null,
      serverLogId: null
    }),

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
  openServerLog: (id) => set({ serverLogId: id, activeModal: 'server-log' }),
  /*
   * The two cross-network views are one choice, so each setter answers for
   * both: turning either on turns the other off, and turning either off means
   * "show me a network", which is neither of them.
   *
   * Six places already call `setDmMode(false)` to mean exactly that. Leaving
   * them to clear the second mode as well is the sort of line that gets
   * missed once and leaves a view showing over a channel somebody just
   * clicked.
   */
  setDmMode: (dm) => set({ dmMode: dm, mentionsMode: false, friendsOpen: false }),
  setMentionsMode: (on) => set({ mentionsMode: on, dmMode: false, friendsOpen: false }),
  // Only ever true inside Messages, so it turns that on with it
  setFriendsOpen: (on) =>
    set(on ? { friendsOpen: true, dmMode: true, mentionsMode: false } : { friendsOpen: false }),
  setJumpTo: (to) => set({ jumpTo: to }),
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
    set((state) => {
      // Deduplication above handles the same news twice. This handles a
      // server with a different complaint every second: distinct toasts stack
      // upwards, and past four of them the oldest are off the top of the
      // window with their dismiss buttons out of reach. The oldest go.
      const kept = [...state.toasts, { ...toast, id }]
      while (kept.length > MOST_TOASTS) {
        const dropped = kept.shift()
        if (dropped) {
          clearTimeout(dismissTimers.get(dropped.id))
          dismissTimers.delete(dropped.id)
        }
      }
      return { toasts: kept }
    })
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
