import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '../stores/ui-store'

describe('UiStore', () => {
  beforeEach(() => {
    useUiStore.setState({ sidebarCollapsed: false, showSettings: false })
  })

  it('should have correct initial state', () => {
    const state = useUiStore.getState()
    expect(state.sidebarCollapsed).toBe(false)
    expect(state.showSettings).toBe(false)
  })

  it('toggleSidebar flips sidebarCollapsed', () => {
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarCollapsed).toBe(true)
    useUiStore.getState().toggleSidebar()
    expect(useUiStore.getState().sidebarCollapsed).toBe(false)
  })

  it('setSidebarCollapsed sets value directly', () => {
    useUiStore.getState().setSidebarCollapsed(true)
    expect(useUiStore.getState().sidebarCollapsed).toBe(true)
    useUiStore.getState().setSidebarCollapsed(false)
    expect(useUiStore.getState().sidebarCollapsed).toBe(false)
  })

  it('toggleSettings flips showSettings', () => {
    useUiStore.getState().toggleSettings()
    expect(useUiStore.getState().showSettings).toBe(true)
    useUiStore.getState().toggleSettings()
    expect(useUiStore.getState().showSettings).toBe(false)
  })
})
