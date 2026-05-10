import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface SopTemplate {
  id: string
  name: string
  icon: string | null
  description: string | null
  agent_type: 'programming' | 'general' | 'any'
  workflow_mode: 'lazy' | 'eager' | 'off'
  builtin: boolean
  created_at: number
  updated_at: number
}

interface SopTemplateState {
  templates: SopTemplate[]
  setTemplates: (templates: SopTemplate[]) => void
}

export const useSopTemplateStore = create<SopTemplateState>()(
  immer((set) => ({
    templates: [],

    setTemplates: (templates) => {
      set((s) => {
        s.templates = templates
      })
    },
  })),
)

export type { SopTemplate }
