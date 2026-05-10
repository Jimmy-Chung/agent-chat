'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface UiState {
  sidebarCollapsed: boolean
  showSettings: boolean
}

interface UiActions {
  toggleSidebar: () => void
  toggleSettings: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
}

export const useUiStore = create<UiState & UiActions>()(
  immer((set) => ({
    sidebarCollapsed: false,
    showSettings: false,

    toggleSidebar: () => {
      set((s) => {
        s.sidebarCollapsed = !s.sidebarCollapsed
      })
    },

    toggleSettings: () => {
      set((s) => {
        s.showSettings = !s.showSettings
      })
    },

    setSidebarCollapsed: (collapsed) => {
      set((s) => {
        s.sidebarCollapsed = collapsed
      })
    },
  })),
)
