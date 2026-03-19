import { create } from 'zustand'

type Theme = 'dark' | 'light'
type Modal = 'settings' | 'add-server' | null

interface UIState {
  theme: Theme
  settingsOpen: boolean
  activeModal: Modal
  showUserList: boolean
  compactMode: boolean

  // Actions
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  openModal: (modal: Modal) => void
  closeModal: () => void
  toggleUserList: () => void
  setCompactMode: (compact: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  settingsOpen: false,
  activeModal: null,
  showUserList: true,
  compactMode: false,

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
  closeModal: () => set({ activeModal: null }),
  toggleUserList: () => set((state) => ({ showUserList: !state.showUserList })),
  setCompactMode: (compact) => set({ compactMode: compact })
}))
