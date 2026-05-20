'use client'

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

export type ToastTone = 'info' | 'warning' | 'error' | 'success'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: string
  tone: ToastTone
  title: string
  description?: string
  action?: ToastAction
  dismissible?: boolean
  durationMs?: number
}

interface ToastState {
  toasts: ToastItem[]
}

interface ToastActions {
  pushToast: (toast: Omit<ToastItem, 'id'> & { id?: string }) => string
  dismissToast: (id: string) => void
  clearToasts: () => void
}

const MAX_TOASTS = 5

function createToastId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useToastStore = create<ToastState & ToastActions>()(
  immer((set) => ({
    toasts: [],

    pushToast: (toast) => {
      const id = toast.id ?? createToastId()
      set((state) => {
        const nextToast: ToastItem = {
          ...toast,
          id,
          dismissible: toast.dismissible ?? true,
        }
        state.toasts = [nextToast, ...state.toasts.filter((item) => item.id !== id)].slice(0, MAX_TOASTS)
      })
      return id
    },

    dismissToast: (id) => {
      set((state) => {
        state.toasts = state.toasts.filter((toast) => toast.id !== id)
      })
    },

    clearToasts: () => {
      set((state) => {
        state.toasts = []
      })
    },
  })),
)
