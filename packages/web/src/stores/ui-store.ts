'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface UiState {
  sidebarCollapsed: boolean
  inspectorCollapsed: boolean
  showSettings: boolean
  isMobile: boolean
  mobileSidebarOpen: boolean
  mobileInspectorOpen: boolean
}

interface UiActions {
  toggleSidebar: () => void
  toggleInspector: () => void
  toggleSettings: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setMobile: (isMobile: boolean) => void
  toggleMobileSidebar: () => void
  setMobileSidebarOpen: (open: boolean) => void
  toggleMobileInspector: () => void
  setMobileInspectorOpen: (open: boolean) => void
}

export const useUiStore = create<UiState & UiActions>()(
  immer((set) => ({
    sidebarCollapsed: false,
    inspectorCollapsed: false,
    showSettings: false,
    isMobile: false,
    mobileSidebarOpen: false,
    mobileInspectorOpen: false,

    toggleSidebar: () => {
      set((s) => {
        s.sidebarCollapsed = !s.sidebarCollapsed
      })
    },

    toggleInspector: () => {
      set((s) => {
        s.inspectorCollapsed = !s.inspectorCollapsed
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

    setMobile: (isMobile) => {
      set((s) => {
        s.isMobile = isMobile
      })
    },

    toggleMobileSidebar: () => {
      set((s) => {
        s.mobileSidebarOpen = !s.mobileSidebarOpen
      })
    },

    setMobileSidebarOpen: (open) => {
      set((s) => {
        s.mobileSidebarOpen = open
      })
    },

    toggleMobileInspector: () => {
      set((s) => {
        s.mobileInspectorOpen = !s.mobileInspectorOpen
      })
    },

    setMobileInspectorOpen: (open) => {
      set((s) => {
        s.mobileInspectorOpen = open
      })
    },
  })),
)
